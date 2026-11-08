import type { RendererApiDefinitions, RendererApiMap } from '@/common/api/renderer-api-def';
import { registerRendererApi, type RegisterRendererApi } from '@/fronted/infrastructure/electron/rendererApiRegistry';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { showNotification } from '@/fronted/components/shared/toasts/notification';
import { registerSettingsRendererApis } from '@/fronted/features/settings/settingsEvents';
import { registerTranscriptRendererApis } from '@/fronted/features/transcript/transcriptEvents';
import { registerPlayerRendererApis } from '@/fronted/features/player/playerEvents';
import { registerChatRendererApis } from '@/fronted/features/chat/chatEvents';
import { registerVideoLearningRendererApis } from '@/fronted/features/video-learning/videoLearningEvents';

/**
 * 注册 main 进程可调用的 renderer 接口。
 *
 * @returns 注销本次全部 renderer 接口的函数。
 */
export function initRendererApis(): () => void {
    const logger = getRendererLogger('RendererApis');
    const unregisters: Array<() => void> = [];

    /**
     * 统一注册入口：只负责执行与错误兜底，日志粒度由各 handler 自行决定。
     */
    const register: RegisterRendererApi = (path, handler) => {
        const wrappedHandler = async (params: RendererApiDefinitions[typeof path]['params']) => {
            try {
                return await handler(params);
            } catch (error) {
                logger.error('renderer api call failed', {
                    path,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        };

        const unregister = registerRendererApi(path, wrappedHandler as RendererApiMap[typeof path]);
        unregisters.push(unregister);
        return unregister;
    };

    // 全局通知提示：直接调用 notification helper，不再派发 DOM CustomEvent
    register('ui/show-toast', async (params) => {
        logger.debug('Show toast', { params });
        showNotification(params);
    });

    // 委派给各业务域的注册器，保持启动层职责单一清晰
    registerSettingsRendererApis(register);
    registerTranscriptRendererApis(register);
    registerPlayerRendererApis(register);
    registerChatRendererApis(register);
    registerVideoLearningRendererApis(register);

    logger.info('renderer apis registered', { count: unregisters.length });

    return () => {
        unregisters.forEach((unregister) => unregister());
        logger.info('renderer apis unregistered');
    };
}
