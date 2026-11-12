import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Stats } from 'node:fs';

import type { MobileRecentItem, MobileWatchDetail } from '@/common/contracts/mobile-web';
import { MOBILE_CONTENT_SECURITY_POLICY } from '@/common/constants/mobile-content-security-policy';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import { getMainLogger } from '@/backend/infrastructure/logger';

/**
 * 手机页 HTTP 服务需要的数据来源。
 *
 * 服务只负责协议与静态资源，业务数据全部由外部提供，避免把媒体库、
 * 字幕解析和查词逻辑塞进 HTTP 层。
 */
export interface MobileWebDataSource {
    /** 读取最近播放列表。 */
    listRecent(): Promise<MobileRecentItem[]>;
    /** 读取一条播放详情（含字幕）。 */
    getWatchDetail(id: string): Promise<MobileWatchDetail>;
    /** 解析观看记录对应的视频文件绝对路径。 */
    resolveVideoFile(id: string): Promise<string>;
    /** 生成或读取观看记录的大图，返回图片文件的绝对路径。 */
    getThumbnail(id: string): Promise<string>;
    /** 保存播放进度。 */
    saveProgress(id: string, position: number): Promise<void>;
    /** 查询单词释义。 */
    lookupWord(word: string): Promise<OpenAIDictionaryResult | null>;
    /** 批量翻译字幕行，返回与入参顺序一致的结果。 */
    translateTexts(texts: string[]): Promise<string[]>;
}

/**
 * 创建手机页 HTTP 服务的参数。
 */
export interface MobileWebServerOptions {
    /** 存放 index.html / app.css / app.js 的目录。 */
    staticDirectory: string;
    /** 业务数据来源。 */
    source: MobileWebDataSource;
    /**
     * 访问令牌。
     *
     * 手机页服务监听在局域网可达的地址上，没有令牌的话同一网络里的任何设备
     * 都能拉走字幕与视频、写入播放进度，甚至驱动用户的付费翻译接口。
     */
    token: string;
}

/**
 * 访问令牌的传递方式，按校验优先级排列：
 * 1. Cookie `dp_mobile_token`：浏览器拿到令牌后自动携带，代表「当前浏览器仍然有效」；
 * 2. 请求头 `X-DashPlayer-Token`：用于原生客户端（iOS）逐次携带；
 * 3. 查询参数 `?t=`：用于「把带令牌的地址粘贴到手机浏览器」这一首次访问。
 *
 * Cookie 优先于查询参数：地址里的令牌可能来自轮换前的旧书签或旧主屏快捷方式，
 * 若让它压过仍然有效的 Cookie，用户会表现为「明明刚连上又进不去」。
 * 三者中任意一个有效即放行，不会因为前一个失效而拒绝后面的有效值。
 */
const TOKEN_QUERY_KEY = 't';
const TOKEN_HEADER_NAME = 'x-dashplayer-token';
const TOKEN_COOKIE_NAME = 'dp_mobile_token';

/**
 * 访问令牌 Cookie 的有效期（秒）。
 *
 * 没有有效期时是会话 Cookie，浏览器重启或主屏 Web App 被系统回收后就会丢，
 * 手机页再打开直接 401，只能回电脑重新复制地址。令牌本身长期稳定，这里给一年。
 */
// Cookie 用 7 天滑动窗口而不是一年长期凭据：明文 HTTP 下令牌一旦被嗅探，
// 一年有效期会把泄露窗口放大到不可接受；每次授权请求都静默续发 Cookie，
// 活跃用户无感知，不活跃 7 天后需要重新输入令牌（令牌本身仍然有效）。
const TOKEN_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * 常量时间比较两个字符串，避免通过响应时间逐字节猜测令牌。
 *
 * 长度不同直接判否：timingSafeEqual 要求等长输入。
 *
 * @param provided 调用方提供的值。
 * @param expected 期望值。
 * @returns 相等时为 true。
 */
const safeTokenEquals = (provided: string, expected: string): boolean => {
    const providedBuffer = Buffer.from(provided, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (providedBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return timingSafeEqual(providedBuffer, expectedBuffer);
};

/**
 * 从 Cookie 头里取出指定名字的 Cookie 值。
 *
 * @param cookieHeader Cookie 头。
 * @param name Cookie 名。
 * @returns Cookie 值；不存在时返回 null。
 */
const readCookie = (cookieHeader: string | undefined, name: string): string | null => {
    if (!cookieHeader) {
        return null;
    }
    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) {
            continue;
        }
        if (part.slice(0, separator).trim() === name) {
            try {
                return decodeURIComponent(part.slice(separator + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
};

/** 静态构建产物的扩展名到 Content-Type 映射。 */
const STATIC_CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
};

/**
 * 把静态文件扩展名转换为 Content-Type。
 *
 * @param filePath 文件路径。
 * @returns Content-Type；未知扩展名返回 application/octet-stream。
 */
const staticContentType = (filePath: string): string => {
    return STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
};

/** 媒体扩展名到 Content-Type 的映射；未知类型交给浏览器按八位流处理。 */
const MEDIA_CONTENT_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.ts': 'video/mp2t',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
};

/** 进度请求体允许的最大字节数。 */
const MAX_JSON_BODY_BYTES = 16 * 1024;

/**
 * 允许写回的最大播放位置（秒），24 小时。
 *
 * 本地媒体单文件超过 24 小时基本不存在，这个上限只用于拦住「拿到令牌的客户端
 * 把续播位置写成任意大数」的污染；真实时长校验需要额外的 ffprobe 调用，
 * 不适合放在每 5 秒一次的进度写回路径上。
 */
const MAX_PROGRESS_SECONDS = 24 * 60 * 60;

/**
 * 付费接口（查词、字幕翻译）的限流窗口长度。
 *
 * 这两个接口在缓存未命中时会调用用户配置的付费模型，服务又监听在局域网可达地址上，
 * 必须给一个按来源计数的上限，避免令牌泄露或同网段设备无限制消耗额度。
 */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 单个来源在每个窗口内允许的付费接口请求数。
 *
 * 查词与翻译共用一个计数桶：正常观看时每 20 句才批量翻译一次，手动查词也远低于
 * 这个量级；取 60 是为了给「快速拖动进度条连续触发翻译窗口」和密集查词留余量，
 * 避免正常使用被误伤。真正的防滥用仍然是访问令牌。
 */
const RATE_LIMIT_MAX_REQUESTS = 60;

/** 限流表最多保留的来源数量，超过时清理窗口已过期的条目。 */
const RATE_LIMIT_MAX_TRACKED_SOURCES = 128;

/**
 * 单次翻译请求的文本总字节上限。
 *
 * 必须与 {@link MAX_JSON_BODY_BYTES} 同一口径（UTF-8 字节），且留出 JSON 外壳的余量，
 * 否则「按字符数达标」的请求会先被请求体上限拒绝，提示与实际原因对不上。
 */
const MAX_TRANSLATE_TEXT_BYTES = 10 * 1024;

/**
 * 把文件扩展名转换为浏览器可识别的 Content-Type。
 *
 * @param filePath 媒体文件路径。
 * @returns Content-Type；未知扩展名返回 application/octet-stream。
 */
const mediaContentType = (filePath: string): string => {
    return MEDIA_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
};

/**
 * 解析 Range 请求头。
 *
 * 只支持单段范围（浏览器播放视频时实际只发单段）。返回值中的 end 已根据文件大小收敛，
 * 无法解析或范围越界时返回 null，由调用方回 416。
 *
 * @param header Range 请求头原文。
 * @param size 文件总字节数。
 * @returns 起始与结束字节（闭区间）；不合法时为 null。
 */
const parseRange = (header: string, size: number): { start: number; end: number } | null => {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
    if (!match) {
        return null;
    }
    if (size <= 0) {
        return null;
    }

    const startText = match[1];
    const endText = match[2];
    if (startText === '' && endText === '') {
        return null;
    }

    let start: number;
    let end: number;
    if (startText === '') {
        // bytes=-N 表示最后 N 个字节
        const suffixLength = Number.parseInt(endText, 10);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            return null;
        }
        start = Math.max(0, size - suffixLength);
        end = size - 1;
    } else {
        start = Number.parseInt(startText, 10);
        end = endText === '' ? size - 1 : Number.parseInt(endText, 10);
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
        return null;
    }
    return { start, end: Math.min(end, size - 1) };
};

/**
 * 客户端请求错误：请求体过大、格式非法等。
 *
 * 与「服务端内部错误」区分开，才能回 4xx 而不是把用户输入问题记成 500。
 * 手机页据此显示可操作的提示，日志也不会被误判成服务端故障。
 */
export class ClientRequestError extends Error {
    /** 对应的 HTTP 状态码。 */
    public readonly status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.name = 'ClientRequestError';
        this.status = status;
    }
}

/**
 * 读取 JSON 请求体。
 *
 * @param request HTTP 请求。
 * @param response HTTP 响应；请求体超限时用于声明连接关闭。
 * @returns 解析后的对象。
 * @throws {ClientRequestError} 请求体过大（413）或不是合法 JSON（400）时抛出。
 */
const readJsonBody = (
    request: IncomingMessage,
    response: ServerResponse,
): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;

        const fail = (error: Error): void => {
            if (settled) {
                return;
            }
            settled = true;
            reject(error);
        };

        request.on('data', (chunk: Buffer) => {
            if (settled) {
                return;
            }
            total += chunk.length;
            if (total > MAX_JSON_BODY_BYTES) {
                // 不立刻 destroy 连接：让调用方能正常回一个 JSON 错误，浏览器也拿得到原因。
                // 但要把剩余请求体快速排干并声明 Connection: close，否则攻击者以
                // 每秒一字节滴注就能把每条连接挂满 Node 默认 300 秒 requestTimeout。
                settled = true;
                request.removeAllListeners('data');
                request.resume();
                response.setHeader('Connection', 'close');
                fail(new ClientRequestError('请求体过大', 413));
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (settled) {
                return;
            }
            settled = true;
            const text = Buffer.concat(chunks).toString('utf8');
            if (text.trim() === '') {
                resolve({});
                return;
            }
            try {
                const parsed: unknown = JSON.parse(text);
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    reject(new ClientRequestError('请求体必须是 JSON 对象'));
                    return;
                }
                resolve(parsed as Record<string, unknown>);
            } catch {
                reject(new ClientRequestError('请求体不是合法 JSON'));
            }
        });
        request.on('error', (error) => fail(error));
    });
};

/**
 * 手机版页面的 HTTP 服务。
 *
 * 对外只提供五个只读/轻量写接口：最近播放、播放详情、视频流、进度写回和查词。
 * 视频流按 Range 响应，满足 iOS Safari 的拖动与分段加载要求。
 */
export default class MobileWebServer {
    private readonly logger = getMainLogger('MobileWebServer');
    private readonly staticDirectory: string;
    private readonly source: MobileWebDataSource;
    /** 当前访问令牌；用户重新生成后由 setToken 热更新，无需重启服务。 */
    private token: string;
    private server: http.Server | null = null;
    /** 付费接口的固定窗口计数，键为请求来源地址。 */
    private readonly paidRequestWindows = new Map<string, { windowStart: number; count: number }>();
    /** 未授权请求的日志节流表：来源 -> 上次记 warn 的时间戳。 */
    private readonly unauthorizedLogAt = new Map<string, number>();

    /**
     * 创建服务实例；此时还没有开始监听。
     *
     * @param options 静态目录、业务数据来源与访问令牌。
     */
    public constructor(options: MobileWebServerOptions) {
        this.staticDirectory = options.staticDirectory;
        this.source = options.source;
        this.token = options.token;
    }

    /**
     * 热更新访问令牌。
     *
     * 用户在设置页点「重新生成令牌」后调用：旧地址立刻失效，
     * 正在运行的服务不需要重启。
     *
     * @param token 新令牌。
     */
    public setToken(token: string): void {
        this.token = token;
        this.logger.info('mobile web server token rotated');
    }

    /**
     * 在指定端口启动监听。
     *
     * 不指定 host，由 Node 按双栈监听所有网卡，同时覆盖局域网直连和
     * IPv4/IPv6 回环，方便配合异地组网工具使用。
     *
     * @param port 监听端口，调用方需提前校验范围。
     */
    public async start(port: number): Promise<void> {
        if (this.server !== null) {
            throw new Error('手机访问服务已经在运行');
        }

        const server = http.createServer((request, response) => {
            void this.handle(request, response);
        });
        server.keepAliveTimeout = 5_000;
        server.on('clientError', (_error, socket) => {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        });

        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error): void => {
                server.off('listening', onListening);
                reject(error);
            };
            const onListening = (): void => {
                server.off('error', onError);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(port);
        });

        this.server = server;
        this.logger.info('mobile web server started', { port });
    }

    /**
     * 停止监听并断开所有连接。
     *
     * 视频流是长连接，必须主动 closeAllConnections，否则关闭端口时旧连接会拖着服务不退出。
     */
    public async stop(): Promise<void> {
        const server = this.server;
        if (server === null) {
            return;
        }
        this.server = null;

        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
        });
        this.logger.info('mobile web server stopped');
    }

    /**
     * 判断服务当前是否正在监听。
     *
     * @returns 已启动时为 true。
     */
    public isRunning(): boolean {
        return this.server !== null;
    }

    /**
     * 读取实际监听的端口。
     *
     * 监听 0 号端口时由系统分配空闲端口，此时拿到的才是真实端口。
     *
     * @returns 监听端口；未启动时为 null。
     */
    public boundPort(): number | null {
        if (this.server === null) {
            return null;
        }
        const address = this.server.address();
        return typeof address === 'object' && address !== null ? address.port : null;
    }

    /**
     * 校验访问令牌。
     *
     * 服务监听在局域网可达的地址上，缺令牌等于把用户的媒体库、字幕和付费额度
     * 暴露给同一网络里的任何人。令牌可以三种方式携带：
     * - `dp_mobile_token` Cookie：浏览器首次访问后由服务端下发，后续请求自动带上；
     * - `X-DashPlayer-Token` 请求头：原生客户端逐次携带；
     * - `?t=` 查询参数：用户把设置页展示的完整地址粘到手机浏览器时用。
     *
     * 依次尝试三种来源，任意一个与当前令牌一致即放行。Cookie 排在最前，避免
     * 旧书签里残留的过期 `?t=` 把仍然有效的 Cookie 顶掉；反过来，Cookie 失效
     * 但地址里是新令牌时也会正常放行，并顺带刷新 Cookie。
     *
     * @param request HTTP 请求。
     * @param url 解析后的请求地址。
     * @param response HTTP 响应。
     * @returns 通过时为 true；不通过时已经写过 401 响应。
     */
    private authorize(request: IncomingMessage, url: URL, response: ServerResponse): string | null {
        const expected = this.token;
        const headerValue = typeof request.headers[TOKEN_HEADER_NAME] === 'string'
            ? request.headers[TOKEN_HEADER_NAME] as string
            : null;
        const queryValue = url.searchParams.get(TOKEN_QUERY_KEY);
        const cookieValue = readCookie(request.headers.cookie, TOKEN_COOKIE_NAME);

        const candidates = [cookieValue, headerValue, queryValue];
        const accepted = candidates.find((value) => value !== null && safeTokenEquals(value, expected)) ?? null;
        if (accepted === null) {
            this.warnUnauthorizedThrottled(request.socket.remoteAddress ?? 'unknown', url.pathname);
            this.sendUnauthorized(request, response);
            return null;
        }

        // 每次授权请求都（重新）下发 Cookie：首次带令牌进入时完成落盘，
        // 其余请求滑动续期——活跃用户不会在 7 天窗口边界被登出。
        this.setTokenCookie(response, expected);
        return accepted;
    }

    /**
     * 下发访问令牌 Cookie。
     *
     * @param response HTTP 响应。
     * @param token 访问令牌。
     */
    private setTokenCookie(response: ServerResponse, token: string): void {
        response.setHeader(
            'Set-Cookie',
            `${TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`
                + `; Max-Age=${TOKEN_COOKIE_MAX_AGE_SECONDS}`,
        );
    }

    /**
     * 检查付费接口的调用配额，超限时直接回 429。
     *
     * @param request HTTP 请求。
     * @param response HTTP 响应。
     * @param accessToken 已通过鉴权的访问令牌。
     * @returns 未超限时为 true。
     */
    private ensurePaidRequestAllowed(request: IncomingMessage, response: ServerResponse, accessToken: string): boolean {
        if (this.acquirePaidRequest(accessToken)) {
            return true;
        }
        this.logger.warn('mobile web paid request rate limited', {
            pathname: (request.url ?? '').split('?')[0],
        });
        response.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
        this.sendJson(response, 429, { error: '请求过于频繁，请稍后再试' });
        return false;
    }

    /**
     * 按访问令牌做固定窗口计数。
     *
     * 令牌才是配额真正的主体：按来源地址计数在启用了 IPv6 隐私扩展的局域网里
     * 可以靠轮换源地址无限开新桶，反过来 NAT 热点下多设备共享一个地址又会
     * 互相烧光配额。窗口滑动不精确也无所谓，目标只是把「无限调用付费模型」
     * 收成「每分钟有限次」。
     *
     * @param accessToken 已通过鉴权的访问令牌。
     * @returns 本窗口内仍有配额时为 true。
     */
    private acquirePaidRequest(accessToken: string): boolean {
        const source = accessToken;
        const now = Date.now();
        const current = this.paidRequestWindows.get(source);
        if (current === undefined || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
            this.paidRequestWindows.set(source, { windowStart: now, count: 1 });
            this.prunePaidRequestWindows(now);
            return true;
        }
        if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
            return false;
        }
        current.count += 1;
        return true;
    }

    /**
     * 清理窗口已过期且数量超出上限的来源记录，避免限流表无限增长。
     *
     * @param now 当前时间戳。
     */
    private prunePaidRequestWindows(now: number): void {
        if (this.paidRequestWindows.size <= RATE_LIMIT_MAX_TRACKED_SOURCES) {
            return;
        }
        for (const [source, window] of this.paidRequestWindows) {
            if (now - window.windowStart >= RATE_LIMIT_WINDOW_MS) {
                this.paidRequestWindows.delete(source);
            }
        }
    }

    /**
     * 记录未授权请求的 warn 日志；同一来源一分钟内只记一条。
     *
     * 限流在鉴权之后，匿名设备高频探测不会触发 429——无节流的 warn 会让
     * 同网段任何设备都能把日志文件刷满。
     *
     * @param source 请求来源地址。
     * @param pathname 请求路径。
     */
    private warnUnauthorizedThrottled(source: string, pathname: string): void {
        const now = Date.now();
        const last = this.unauthorizedLogAt.get(source);
        if (last !== undefined && now - last < RATE_LIMIT_WINDOW_MS) {
            return;
        }
        this.unauthorizedLogAt.set(source, now);
        if (this.unauthorizedLogAt.size > RATE_LIMIT_MAX_TRACKED_SOURCES) {
            for (const [key, at] of this.unauthorizedLogAt) {
                if (now - at >= RATE_LIMIT_WINDOW_MS) {
                    this.unauthorizedLogAt.delete(key);
                }
            }
        }
        this.logger.warn('mobile web request rejected: invalid access token', {
            pathname,
        });
    }

    /**
     * 返回 401。
     *
     * 浏览器直接打开页面时回一个可读的 HTML 提示页，接口请求才回 JSON，
     * 免得用户在地址栏里看到一坨原始 JSON 不知道发生了什么。
     *
     * @param request HTTP 请求。
     * @param response HTTP 响应。
     */
    private sendUnauthorized(request: IncomingMessage, response: ServerResponse): void {
        const accept = typeof request.headers.accept === 'string' ? request.headers.accept : '';
        if (accept.includes('text/html')) {
            const body = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />'
                + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
                + '<title>需要访问令牌</title></head><body style="font-family:system-ui;padding:2rem;line-height:1.6">'
                + '<h1 style="font-size:1.25rem">需要访问令牌</h1>'
                + '<p>这个地址缺少有效的访问令牌，或者令牌已经被重新生成。</p>'
                + '<p>请回到电脑上的 Refrain「设置 → 手机访问」，重新复制一条访问地址到手机浏览器打开。</p>'
                + '</body></html>';
            response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(body);
            return;
        }
        this.sendJson(response, 401, {
            error: '访问令牌无效或缺失，请在桌面端重新复制访问地址',
        });
    }

    /**
     * 处理单个 HTTP 请求。
     *
     * @param request HTTP 请求。
     * @param response HTTP 响应。
     */
    private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        // 手机页跑在局域网可达的地址上，这几道响应头把「能不能被套进别的页面、
        // 能不能被嗅探出访问来源」一并关掉。
        response.setHeader('X-Frame-Options', 'DENY');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', MOBILE_CONTENT_SECURITY_POLICY);

        try {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            let pathname: string;
            try {
                pathname = decodeURIComponent(url.pathname);
            } catch {
                this.sendJson(response, 400, { error: '请求路径编码无效' });
                return;
            }

            // 鉴权放在最前面：连静态资源也要令牌，否则未授权设备至少能拿到页面骨架。
            const accessToken = this.authorize(request, url, response);
            if (accessToken === null) {
                return;
            }

            if (pathname === '/favicon.ico') {
                // 手机页的图标由 index.html 里的 <link rel="icon"> 指定为 /favicon-32.png；
                // 这里只是兜住仍然按老规矩探测根路径的浏览器，回 204 而不是 404，免得刷错误日志。
                response.writeHead(204);
                response.end();
                return;
            }

            if (pathname === '/api/recent') {
                if (request.method !== 'GET') {
                    this.sendJson(response, 405, { error: '只支持 GET' });
                    return;
                }
                const items = await this.source.listRecent();
                this.sendJson(response, 200, { items });
                return;
            }

            if (pathname === '/api/dictionary') {
                if (request.method !== 'GET') {
                    this.sendJson(response, 405, { error: '只支持 GET' });
                    return;
                }
                if (!this.ensurePaidRequestAllowed(request, response, accessToken)) {
                    return;
                }
                const word = (url.searchParams.get('word') ?? '').trim();
                if (word === '' || word.length > 64) {
                    this.sendJson(response, 400, { error: '缺少合法的查询单词' });
                    return;
                }
                const result = await this.source.lookupWord(word);
                this.sendJson(response, 200, { result });
                return;
            }

            if (pathname === '/api/translate') {
                if (request.method !== 'POST') {
                    this.sendJson(response, 405, { error: '只支持 POST' });
                    return;
                }
                if (!this.ensurePaidRequestAllowed(request, response, accessToken)) {
                    return;
                }
                const body = await readJsonBody(request, response);
                if (!Array.isArray(body.texts) || body.texts.length === 0 || body.texts.length > 50) {
                    this.sendJson(response, 400, { error: '一次最多翻译 50 行' });
                    return;
                }
                if (!body.texts.every((text) => typeof text === 'string')) {
                    this.sendJson(response, 400, { error: '待翻译内容必须是字符串' });
                    return;
                }
                const texts = body.texts as string[];
                // 用 UTF-8 字节数而不是 UTF-16 字符数：请求体上限是按字节算的，
                // 用字符数会让「符合上限的请求」先被 readJsonBody 的字节上限拒掉。
                const totalBytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
                if (totalBytes > MAX_TRANSLATE_TEXT_BYTES) {
                    this.sendJson(response, 400, { error: '待翻译内容过长' });
                    return;
                }
                const translations = await this.source.translateTexts(texts);
                this.sendJson(response, 200, { translations });
                return;
            }

            const videoMatch = /^\/api\/videos\/([^/]+)(\/stream|\/progress|\/thumb)?$/.exec(pathname);
            if (videoMatch !== null) {
                const id = videoMatch[1];
                const action = videoMatch[2];
                if (action === '/stream') {
                    if (request.method !== 'GET' && request.method !== 'HEAD') {
                        this.sendJson(response, 405, { error: '只支持 GET' });
                        return;
                    }
                    await this.serveVideo(request, response, id);
                    return;
                }
                if (action === '/thumb') {
                    if (request.method !== 'GET' && request.method !== 'HEAD') {
                        this.sendJson(response, 405, { error: '只支持 GET' });
                        return;
                    }
                    await this.serveThumbnail(request, response, id);
                    return;
                }
                if (action === '/progress') {
                    if (request.method !== 'POST') {
                        this.sendJson(response, 405, { error: '只支持 POST' });
                        return;
                    }
                    // 进度是唯一无上限的写路径：每次请求都带 DB 读、多次 fs stat 与
                    // SQLite 写，与付费接口共用同一把令牌窗口，正常播放节奏（约 12 次/分）
                    // 远够用，无限刷会放大磁盘 I/O 并搅乱「最近播放」排序。
                    if (!this.ensurePaidRequestAllowed(request, response, accessToken)) {
                        return;
                    }
                    const body = await readJsonBody(request, response);
                    const position = body.position;
                    // 只接受 JSON 数字：Number('120') / Number([120]) 都会过旧校验，
                    // 相当于让字符串和数组绕过类型约定写进观看历史。
                    if (typeof position !== 'number' || !Number.isFinite(position)
                        || position < 0 || position > MAX_PROGRESS_SECONDS) {
                        this.sendJson(response, 400, { error: '播放位置无效' });
                        return;
                    }
                    await this.source.saveProgress(id, position);
                    this.sendJson(response, 200, { ok: true });
                    return;
                }
                if (request.method !== 'GET') {
                    this.sendJson(response, 405, { error: '只支持 GET' });
                    return;
                }
                const video = await this.source.getWatchDetail(id);
                this.sendJson(response, 200, video);
                return;
            }

            if (request.method === 'GET' || request.method === 'HEAD') {
                await this.serveStatic(response, pathname, request.method === 'HEAD');
                return;
            }

            this.sendJson(response, 404, { error: '页面不存在' });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // 客户端输入问题（非法 JSON、请求体过大）回 4xx 并原样说明原因，
            // 不要伪装成 500：手机页会据此提示用户，日志也不该被当成服务端故障。
            const status = error instanceof ClientRequestError ? error.status : 500;
            const isClientError = error instanceof ClientRequestError;
            this.logger.warn('mobile web request failed', {
                method: request.method,
                path: (request.url ?? '').split('?')[0],
                status,
                error: message,
            });
            if (!response.headersSent && !response.destroyed) {
                try {
                    this.sendJson(response, status, {
                        error: isClientError ? message : '服务器内部错误',
                    });
                    return;
                } catch {
                    // 连接已断时继续走 destroy，避免抛回上层变成未处理异常。
                }
            }
            response.destroy();
        }
    }

    /**
     * 返回 React 构建产物的静态文件。
     *
     * 只允许读取静态目录内部的普通文件，拒绝 `..`、绝对路径和目录穿越。
     * 缓存分三档：带内容哈希的 assets 长期不可变；index.html 每次重新校验；
     * 其余非哈希文件（favicon-16/32.png、apple-touch-icon.png）短缓存，改图标后不用等一年。
     *
     * @param response HTTP 响应。
     * @param pathname 请求路径。
     * @param headOnly 是否为 HEAD 请求（只回头不回包体）。
     */
    private async serveStatic(
        response: ServerResponse,
        pathname: string,
        headOnly: boolean,
    ): Promise<void> {
        const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const normalized = path.normalize(relativePath);
        if (normalized === '' || normalized === '.' || normalized.startsWith('..')
            || path.isAbsolute(normalized) || normalized.includes('\0')) {
            this.sendJson(response, 404, { error: '页面不存在' });
            return;
        }

        const root = path.resolve(this.staticDirectory);
        const filePath = path.resolve(root, normalized);
        if (filePath !== root && !filePath.startsWith(root + path.sep)) {
            this.sendJson(response, 404, { error: '页面不存在' });
            return;
        }

        let stat: Stats;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            this.sendJson(response, 404, { error: '页面不存在' });
            return;
        }
        if (!stat.isFile()) {
            this.sendJson(response, 404, { error: '页面不存在' });
            return;
        }

        const content = await fs.promises.readFile(filePath);
        // Vite 的构建产物都落在 assets/ 下且文件名带内容哈希，可以放心 immutable；
        // normalized 在 Windows 上是反斜杠分隔，比较时沿用 path.sep。
        const hasHashedName = normalized.startsWith(`assets${path.sep}`);
        const isIndex = normalized === 'index.html';
        response.writeHead(200, {
            'Content-Type': staticContentType(filePath),
            'Content-Length': content.byteLength,
            'Cache-Control': isIndex
                ? 'no-cache'
                : hasHashedName
                    ? 'public, max-age=31536000, immutable'
                    : 'public, max-age=3600',
        });
        response.end(headOnly ? undefined : content);
    }

    /**
     * 输出最近播放列表的大图。
     *
     * @param request HTTP 请求。
     * @param response HTTP 响应。
     * @param id 观看记录 ID。
     */
    private async serveThumbnail(
        request: IncomingMessage,
        response: ServerResponse,
        id: string,
    ): Promise<void> {
        const filePath = await this.source.getThumbnail(id);
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) {
            this.sendJson(response, 404, { error: '缩略图不存在' });
            return;
        }

        response.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=3600',
        });
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        this.pipeFile(response, filePath, undefined, undefined);
    }

    /**
     * 输出视频文件，支持 Range 请求。
     *
     * @param request HTTP 请求。
     * @param response HTTP 响应。
     * @param id 观看记录 ID。
     */
    private async serveVideo(
        request: IncomingMessage,
        response: ServerResponse,
        id: string,
    ): Promise<void> {
        const filePath = await this.source.resolveVideoFile(id);
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) {
            this.sendJson(response, 404, { error: '视频文件不存在' });
            return;
        }

        const size = stat.size;
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Content-Type', mediaContentType(filePath));
        response.setHeader('Cache-Control', 'no-store');

        const rangeHeader = request.headers.range;
        if (rangeHeader === undefined) {
            response.writeHead(200, { 'Content-Length': size });
            if (request.method === 'HEAD') {
                response.end();
                return;
            }
            this.pipeFile(response, filePath, undefined, undefined);
            return;
        }

        const range = parseRange(rangeHeader, size);
        if (range === null) {
            response.writeHead(416, { 'Content-Range': `bytes */${size}` });
            response.end();
            return;
        }

        response.writeHead(206, {
            'Content-Length': range.end - range.start + 1,
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        });
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        this.pipeFile(response, filePath, range.start, range.end);
    }

    /**
     * 把文件片段写入响应，并在连接提前断开时释放读流。
     *
     * @param response HTTP 响应。
     * @param filePath 视频文件路径。
     * @param start 起始字节；未提供时从头读。
     * @param end 结束字节（含）；未提供时读到文件尾。
     */
    private pipeFile(
        response: ServerResponse,
        filePath: string,
        start: number | undefined,
        end: number | undefined,
    ): void {
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', (error) => {
            this.logger.warn('video stream failed', { error });
            response.destroy(error);
        });
        response.on('close', () => {
            stream.destroy();
        });
        stream.pipe(response);
    }

    /**
     * 输出 JSON 响应。
     *
     * @param response HTTP 响应。
     * @param status HTTP 状态码。
     * @param payload 可序列化对象。
     */
    private sendJson(response: ServerResponse, status: number, payload: unknown): void {
        const body = Buffer.from(JSON.stringify(payload), 'utf8');
        response.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': body.byteLength,
            'Cache-Control': 'no-store',
        });
        response.end(body);
    }
}
