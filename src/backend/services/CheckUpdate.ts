import { getMainLogger } from '@/backend/infrastructure/logger';
import { compareVersions } from 'compare-versions';
import type Release from '@/common/types/release';
import type { UpdateCheckResult } from '@/common/types/update-check';
import { isDevelopmentMode } from '@/backend/utils/runtimeEnv';

const UPDATE_CACHE_TTL_MS = 5 * 60 * 1000;
/** 限流失败缓存时长：GitHub 匿名限流窗口较长，失败后延长缓存避免在窗口内反复触发。 */
const RATE_LIMIT_FAILURE_CACHE_MS = 10 * 60 * 1000;
/** 更新检查请求超时（毫秒）。 */
const UPDATE_REQUEST_TIMEOUT_MS = 15_000;
const RELEASES_BASE_URL = 'https://api.github.com/repos/solidSpoon/DashPlayer/releases';

let cache: UpdateCheckResult = { status: 'ok', releases: [] };
/** 缓存过期时间（绝对时间戳）：到期前直接返回缓存，避免重复请求。 */
let cacheExpireAt = 0;
/** 进行中的更新检查请求：并发调用共享同一请求，避免缓存过期瞬间多个调用同时打 GitHub。 */
let inflightRequest: Promise<UpdateCheckResult> | null = null;

/**
 * 最近一次完整成功检查的快照。
 *
 * etag 与结果绑定：携带 If-None-Match 请求 /latest 时，若 GitHub 返回 304，
 * 说明线上数据与快照时完全一致，可直接复用快照结果。304 响应不计入速率限额，
 * 是匿名限额（60 次/小时/IP）下最有效的省额手段。
 */
let lastSuccess: { etag: string | null; result: UpdateCheckResult } | null = null;

const normalizeVersion = (version: string) => version.trim().replace(/^v/i, '');

const isNewerVersion = (version: string, currentVersion: string) => {
    try {
        return compareVersions(normalizeVersion(version), normalizeVersion(currentVersion)) > 0;
    } catch {
        return false;
    }
};

const sortByVersionDesc = (a: Release, b: Release) => {
    try {
        return compareVersions(normalizeVersion(b.version), normalizeVersion(a.version));
    } catch {
        return 0;
    }
};

const toRelease = (release: { html_url: string; tag_name: string; body: string }): Release => ({
    url: release.html_url,
    version: release.tag_name,
    content: release.body,
});

const isStableRelease = (release: { draft?: boolean; prerelease?: boolean }) => {
    return !release.draft && !release.prerelease;
};

/**
 * 检查 GitHub 是否有新版本。
 *
 * 行为说明：
 * - 缓存期内直接返回缓存，避免重复请求；
 * - 并发调用共享同一个进行中的请求，过期瞬间多个调用不会同时发起网络请求；
 * - 网络请求失败（含限流）会写入失败缓存：限流失败（403/429）缓存 10 分钟，其余失败缓存 5 分钟；
 * - 解析等意外异常会直接抛出、不写缓存，避免用错误数据掩盖问题。
 *
 * @param currentVersion 当前应用版本号。
 * @returns 更新检查结果（含版本列表或错误码）。
 */
export const checkUpdate = (currentVersion: string): Promise<UpdateCheckResult> => {
    if (Date.now() < cacheExpireAt) {
        return Promise.resolve(cache);
    }
    if (!inflightRequest) {
        inflightRequest = doCheckUpdate(currentVersion).finally(() => {
            inflightRequest = null;
        });
    }
    return inflightRequest;
};

/**
 * 执行实际的更新检查请求并写入缓存；由 checkUpdate 保证同一时间只有一个实例在跑。
 *
 * 行为说明：
 * - 开发模式下直接返回“无更新”，避免版本配置落后于线上时误报；
 * - /latest 携带最近成功快照的 etag，命中 304 时复用快照结果，不消耗速率限额；
 * - /latest 请求失败（含 403 限流）直接返回失败缓存，不再请求列表接口；
 * - 列表接口失败时回退为仅返回 /latest 的单个版本（该降级结果不写入快照，
 *   保证 304 复用的永远是完整成功的结果）；
 * - 所有正常与预期失败分支都会设置 cacheExpireAt，失败态同样缓存避免反复请求。
 *
 * @param currentVersion 当前应用版本号。
 * @returns 更新检查结果。
 */
const doCheckUpdate = async (currentVersion: string): Promise<UpdateCheckResult> => {
    const logger = getMainLogger('CheckUpdate');

    // 开发模式下本地版本可能落后于线上 Release，跳过避免误报。
    if (isDevelopmentMode()) {
        logger.debug('skip update check in development mode');
        cache = { status: 'ok', releases: [] };
        cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
        return cache;
    }

    const latestRequestStart = Date.now();
    // 仅在持有成功快照时才发送条件请求：没有快照时 304 无结果可复用。
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
    };
    if (lastSuccess?.etag) {
        headers['If-None-Match'] = lastSuccess.etag;
    }

    let latestResponse: Response;
    try {
        latestResponse = await fetch(`${RELEASES_BASE_URL}/latest`, {
            headers,
            signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS),
        });
    } catch (err: unknown) {
        logger.warn('failed to fetch latest release', {
            url: `${RELEASES_BASE_URL}/latest`,
            costMs: Date.now() - latestRequestStart,
            error: err instanceof Error ? err.message : String(err),
        });
        cache = { status: 'error', releases: [], error: 'network' };
        cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
        return cache;
    }

    // 304 说明线上数据与上次快照完全一致，直接复用快照结果且不消耗速率限额。
    if (latestResponse.status === 304 && lastSuccess) {
        await latestResponse.body?.cancel();
        logger.debug('latest release unchanged (304), reuse snapshot', {
            costMs: Date.now() - latestRequestStart,
        });
        cache = lastSuccess.result;
        cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
        return cache;
    }

    if (!latestResponse.ok) {
        await latestResponse.body?.cancel();
        const status = latestResponse.status;
        const rateLimited = status === 403 || status === 429;
        // 限流或异常 HTTP 状态码均属于可恢复的预期失败，记 warn 并带上 status 便于排障。
        logger.warn(rateLimited ? 'github latest release rate limited' : 'failed to fetch latest release', {
            status,
            url: `${RELEASES_BASE_URL}/latest`,
            costMs: Date.now() - latestRequestStart,
        });
        cache = {
            status: 'error',
            releases: [],
            error: rateLimited ? 'rate_limited' : 'network',
        };
        cacheExpireAt = Date.now() + (rateLimited ? RATE_LIMIT_FAILURE_CACHE_MS : UPDATE_CACHE_TTL_MS);
        return cache;
    }

    if (latestResponse.status !== 200) {
        await latestResponse.body?.cancel();
        cache = { status: 'error', releases: [], error: 'payload' };
        cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
        return cache;
    }

    const latestRelease = (await latestResponse.json()) as {
        html_url: string;
        tag_name: string;
        body: string;
        draft?: boolean;
        prerelease?: boolean;
    };

    // 显式校验关键字段，避免异常载荷被静默当作“无更新”缓存。
    if (!latestRelease || typeof latestRelease.tag_name !== 'string' || latestRelease.tag_name.length === 0) {
        logger.error('unexpected latest release payload', { status: latestResponse.status, url: `${RELEASES_BASE_URL}/latest` });
        cache = { status: 'error', releases: [], error: 'payload' };
        cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
        return cache;
    }

    const latestEtag = latestResponse.headers.get('etag');

    // /latest 本身只返回非 draft 非 prerelease 的稳定版，无需再做稳定版判断。
    if (!isNewerVersion(latestRelease.tag_name, currentVersion)) {
        logger.debug('no new release available', {
            currentVersion,
            latestVersion: latestRelease.tag_name,
            costMs: Date.now() - latestRequestStart,
        });
        cache = { status: 'ok', releases: [] };
        cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
        lastSuccess = { etag: latestEtag, result: cache };
        return cache;
    }

    const listRequestStart = Date.now();
    const listResponse = await fetch(`${RELEASES_BASE_URL}?per_page=20`, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS),
    }).catch((err: unknown) => {
        logger.warn('failed to fetch releases', {
            url: `${RELEASES_BASE_URL}?per_page=20`,
            costMs: Date.now() - listRequestStart,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    });

    if (!listResponse || listResponse.status !== 200) {
        await listResponse?.body?.cancel();
        if (listResponse && listResponse.status !== 200) {
            logger.warn('failed to fetch releases', {
                status: listResponse.status,
                url: `${RELEASES_BASE_URL}?per_page=20`,
                costMs: Date.now() - listRequestStart,
            });
        }
        const fallback = toRelease(latestRelease);
        cache = { status: 'ok', releases: [fallback] };
        cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
        // 降级结果不写入快照：304 复用必须是完整成功的结果，避免降级态被长期固化。
        return cache;
    }

    const releaseList = (await listResponse.json()) as Array<{
        html_url: string;
        tag_name: string;
        body: string;
        draft?: boolean;
        prerelease?: boolean;
    }>;

    const releases: Release[] = releaseList
        .filter(isStableRelease)
        .map((release) => toRelease(release))
        .filter((release: Release) => isNewerVersion(release.version, currentVersion))
        .sort(sortByVersionDesc);

    logger.info('fetched releases from github', { count: releases.length, costMs: Date.now() - latestRequestStart });
    cache = { status: 'ok', releases };
    cacheExpireAt = Date.now() + UPDATE_CACHE_TTL_MS;
    lastSuccess = { etag: latestEtag, result: cache };
    return cache;
};
