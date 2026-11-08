import type { RegisterRendererApi } from '@/fronted/infrastructure/electron/rendererApiRegistry';
import type { RendererApiDefinitions } from '@/common/api/renderer-api-def';

/**
 * 生词视频裁切状态更新事件负载。
 */
export type ClipStatusUpdateEvent = RendererApiDefinitions['video-learning/clip-status-update']['params'];

type ClipStatusListener = (event: ClipStatusUpdateEvent) => void;

const listeners = new Set<ClipStatusListener>();

/**
 * 订阅视频学习生词视频裁切状态更新事件。
 *
 * @param listener 状态更新回调。
 * @returns 取消订阅函数。
 */
export function subscribeClipStatusUpdate(listener: ClipStatusListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * 注册视频学习相关的 main 进程回调通道。
 *
 * @param register 接口注册函数。
 */
export function registerVideoLearningRendererApis(register: RegisterRendererApi): void {
    register('video-learning/clip-status-update', async (params) => {
        listeners.forEach((listener) => {
            try {
                listener(params);
            } catch {
                // 忽略单个监听器的异常
            }
        });
    });
}
