import type { RegisterRendererApi } from '@/fronted/infrastructure/electron/rendererApiRegistry';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import useDictionaryStream from '@/fronted/features/player/dictionaryStore';
import useTranslation from '@/fronted/features/player/translationStore';

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
