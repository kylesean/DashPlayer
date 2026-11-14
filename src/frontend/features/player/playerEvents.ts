import type { RegisterRendererApi } from '@/frontend/infrastructure/electron/rendererApiRegistry';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import useDictionaryStream from '@/frontend/features/player/dictionaryStore';
import useTranslation from '@/frontend/features/player/translationStore';

const logger = getRendererLogger('PlayerEvents');

/**
 * 注册播放器相关的翻译与查词 main 进程回调通道。
 *
 * @param register 接口注册函数。
 */
export function registerPlayerRendererApis(register: RegisterRendererApi): void {
    register('translation/batch-result', async (params) => {
        useTranslation.getState().updateTranslations(params.translations);
    });

    register('dictionary/openai-update', async ({ requestId, word, data, isComplete = false }) => {
        logger.debug('Received OpenAI dictionary update', {
            requestId,
            word,
            isComplete,
            hasDefinitions: data.definitions.length,
        });

        useDictionaryStream.getState().receiveUpdate(requestId, word, data, isComplete);
    });
}
