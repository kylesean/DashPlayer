import type { RegisterRendererApi } from '@/fronted/infrastructure/electron/rendererApiRegistry';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import useChatPanel from '@/fronted/features/chat/chatStore';
import { receiveChatChunk } from '@/fronted/features/chat/chatTransport';

const logger = getRendererLogger('ChatEvents');

/**
 * 注册 AI 聊天与分析相关的 main 进程回调通道。
 *
 * @param register 接口注册函数。
 */
export function registerChatRendererApis(register: RegisterRendererApi): void {
    register('chat/stream', async (params) => {
        // 标准消息流只记录生命周期片段，文本增量不落日志。
        if (params.chunk.type !== 'text-delta') {
            logger.debug('Chat stream event', {
                sessionId: params.sessionId,
                event: params.chunk.type,
            });
        }
        receiveChatChunk(params.sessionId, params.chunk);
    });

    register('chat/analysis/stream', async (params) => {
        if (params.chunk.type !== 'data-analysis') {
            logger.debug('Analysis stream event', {
                sessionId: params.sessionId,
                messageId: params.messageId,
                event: params.chunk.type,
            });
        }
        useChatPanel.getState().receiveAnalysisStream(params);
    });
}
