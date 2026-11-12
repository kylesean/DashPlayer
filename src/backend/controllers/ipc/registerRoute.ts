import { z } from 'zod';

import type { ApiDefinitions, ApiMap } from '@/common/api/api-def';
import { isUserCancellation } from '@/common/utils/cancellation';
import container from '@/backend/ioc/inversify.config';
import TYPES from '@/backend/ioc/types';
import { getMainLogger, resolveTraceId, runWithTrace } from '@/backend/infrastructure/logger';
import type RendererEvents from '@/backend/services/gateways/renderer/RendererEvents';
import type { TraceCarrier } from '@/common/log/simple-types';
import { registerIpcRoute } from './routeRegistry';

const logger = getMainLogger('ipc');

/**
 * 高频/敏感路径的日志策略：降为 debug，并按需跳过 param/result，避免噪音与密钥落盘。
 *
 * 导出供 routeContract 契约测试校验：这里出现的每个键都必须是真实注册的路由，
 * 键名拼写漂移会让静默策略失效、敏感数据重新落日志。
 */
export const QUIET_PATH_POLICIES: Partial<Record<string, { logParam: boolean; logResult: boolean }>> = {
    'watch-history/progress/update': { logParam: false, logResult: false },
    // 录音二进制走 IPC，param 里是整段音频字节，落日志只有噪音
    // 跟读评分同样携带整段音频字节
    'practice/score-shadowing': { logParam: false, logResult: true },
    'chat/transcribe-audio': { logParam: false, logResult: true },
    // 高频轮询状态路径降为 debug，避免刷屏同步落盘阻塞主线程
    'video-learning/clip-queue-status': { logParam: false, logResult: false },
    'video-learning/detect-clip-status': { logParam: false, logResult: false },
    'dp-task/detail': { logParam: true, logResult: false },
    // 返回值里带手机访问令牌（lanUrls 的 ?t= 与裸 token），落日志等于把长期凭据写进磁盘
    'settings/mobile-access/detail': { logParam: true, logResult: false },
    'settings/mobile-access/regenerate-token': { logParam: true, logResult: false },
    // 返回值是解密后的云端凭据（OpenAI key、腾讯 secretId/secretKey）
    'settings/service-credentials/detail': { logParam: true, logResult: false },
};

/**
 * 无参 IPC 路由注册选项。
 */
export interface RegisterVoidRouteOptions<K extends keyof ApiMap> {
    /** 可选入参校验架构。 */
    schema?: z.ZodType<ApiDefinitions[K]['params']>;
}

/**
 * 有参 IPC 路由注册选项；强制要求提供与路由契约匹配的 Zod 校验架构。
 */
export interface RegisterParameterizedRouteOptions<K extends keyof ApiMap> {
    /** 跨进程边界的入参 Zod 校验架构；校验失败时直接抛出显式错误。 */
    schema: z.ZodType<ApiDefinitions[K]['params']>;
}

/**
 * 使用可选 Zod 架构校验 IPC 入参。
 *
 * 契约外顶层字段直接报错而非依赖 zod 默认的 strip 行为：schema 漏写可选
 * 字段时，渲染端多传的内容会被静默丢弃，契约漂移无从察觉，与「尽早失败」
 * 约定相悖。顶层键比对即可覆盖该场景；嵌套对象的深漂移仍由各自 schema 约束。
 *
 * @param path API 路径，用于构建可读错误上下文。
 * @param param 渲染端传入的原始参数。
 * @param schema 入参 Zod 校验架构；无参路由允许省略。
 * @returns 校验通过后的强类型入参。
 */
function parseRouteParam<K extends keyof ApiMap>(
    path: K,
    param: unknown,
    schema: z.ZodType<ApiDefinitions[K]['params']> | undefined,
): ApiDefinitions[K]['params'] {
    if (!schema) {
        return undefined as ApiDefinitions[K]['params'];
    }
    const parsed = schema.safeParse(param);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
            .join('; ');
        throw new Error(`IPC 请求参数校验失败 (${String(path)}): ${detail}`);
    }
    if (param && typeof param === 'object' && !Array.isArray(param)) {
        const unknownKeys = Object.keys(param as Record<string, unknown>)
            .filter((key) => !(key in (parsed.data as Record<string, unknown>)));
        if (unknownKeys.length > 0) {
            throw new Error(
                `IPC 请求参数包含未声明字段 (${String(path)}): ${unknownKeys.join(', ')}`
                + '（schema 漏写或渲染端多传，请核对契约）',
            );
        }
    }
    return parsed.data;
}

/**
 * 注册无参 IPC 路由并统一记录调用日志。
 *
 * @param path API 路径。
 * @param func 与路径匹配的无参处理函数。
 * @param options 可选路由配置。
 */
export default function registerRoute<K extends keyof ApiMap>(
    path: K,
    func: [ApiDefinitions[K]['params']] extends [void] ? () => Promise<ApiDefinitions[K]['return']> : never,
    options?: RegisterVoidRouteOptions<K>,
): void;
/**
 * 注册有参 IPC 路由，并在进入业务处理器前执行 Zod 运行时校验。
 *
 * 行为说明：
 * - renderer 提供合法 trace ID 时沿用，否则在 main 边界生成；
 * - 有参路由必须提供 schema，校验失败直接在 IPC 边界抛错，不静默回退；
 * - 普通路径在 info 级记录 param/result，统一日志出口负责脱敏与裁剪；
 * - 命中 QUIET_PATH_POLICIES 的高频/敏感路径降为 debug，并按策略跳过 param/result，避免噪音与密钥落盘；
 * - 异常统一记 error，并转发给渲染端事件总线。
 *
 * @param path API 路径。
 * @param func 与路径匹配的处理函数。
 * @param options 包含入参校验 schema 的路由配置。
 */
export default function registerRoute<K extends keyof ApiMap>(
    path: K,
    func: (params: ApiDefinitions[K]['params']) => Promise<ApiDefinitions[K]['return']>,
    options: RegisterParameterizedRouteOptions<K>,
): void;
export default function registerRoute<K extends keyof ApiMap>(
    path: K,
    func: (params: ApiDefinitions[K]['params']) => Promise<ApiDefinitions[K]['return']>,
    options?: { schema?: z.ZodType<ApiDefinitions[K]['params']> },
): void {
    registerIpcRoute(path, Boolean(options?.schema), async (_event, param: unknown, traceCarrier?: TraceCarrier) => {
        const traceId = resolveTraceId(traceCarrier?.traceId);
        return runWithTrace(traceId, async () => {
            const start = Date.now();
            const policy = QUIET_PATH_POLICIES[path];
            const requestData = policy?.logParam === false
                ? { path: String(path) }
                : { path: String(path), param };

            if (policy) {
                logger.debug('ipc request started', requestData);
            } else {
                logger.info('ipc request started', requestData);
            }

            try {
                const validatedParam = parseRouteParam(path, param, options?.schema);
                const result = await func(validatedParam);
                const responseData = policy?.logResult === false
                    ? { path: String(path), durationMs: Date.now() - start }
                    : { path: String(path), durationMs: Date.now() - start, result };
                if (policy) {
                    logger.debug('ipc request completed', responseData);
                } else {
                    logger.info('ipc request completed', responseData);
                }
                return result;
            } catch (error) {
                const errorData = {
                    path: String(path),
                    durationMs: Date.now() - start,
                    error,
                };
                if (isUserCancellation(error)) {
                    logger.warn('ipc request cancelled', errorData);
                } else {
                    logger.error('ipc request failed', errorData);
                    container
                        .get<RendererEvents>(TYPES.RendererEvents)
                        .error(error instanceof Error ? error : new Error(String(error)));
                }
                throw error;
            }
        });
    });
}
