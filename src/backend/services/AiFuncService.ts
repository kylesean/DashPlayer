import type LocalTtsService from '@/backend/services/LocalTtsService';
import type DpTaskService from '@/backend/services/DpTaskService';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import UrlUtil from '@/common/utils/UrlUtil';
import { inject, injectable } from 'inversify';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type ParakeetModelService from '@/backend/services/ParakeetModelService';
import type WhisperCppModelService from '@/backend/services/WhisperCppModelService';

/**
 * AiFuncService 的业务契约。
 */
export default interface AiFuncService {
    tts(text: string): Promise<string>;

}

/**
 * 编排 AI 功能（文本切分与语音合成）。
 */
@injectable()
export class AiFuncServiceImpl implements AiFuncService {
    private logger = getMainLogger('AiFuncService');

    /**
     * 构造 AI 功能编排服务。
     *
     * @param dpTaskService 后台任务管理服务。
     * @param chatService 结构化对话任务服务。
     * @param localTtsService 本地语音合成服务。
     */
    constructor(
        @inject(TYPES.LocalTtsService) private readonly localTtsService: LocalTtsService,
    ) {}

    public async tts(text: string): Promise<string> {
        return UrlUtil.toUrl(await this.localTtsService.synthesize(text));
    }
}
