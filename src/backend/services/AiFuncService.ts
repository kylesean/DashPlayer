import type LocalTtsService from '@/backend/services/LocalTtsService';
import type DpTaskService from '@/backend/services/DpTaskService';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import UrlUtil from '@/common/utils/UrlUtil';
import { inject, injectable } from 'inversify';
import type ChatService from '@/backend/services/ChatService';
import { AiFuncFormatSplitPrompt } from '@/common/types/aiRes/AiFuncFormatSplit';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type ParakeetModelService from '@/backend/services/ParakeetModelService';
import type WhisperCppModelService from '@/backend/services/WhisperCppModelService';

/**
 * AiFuncService 的业务契约。
 */
export default interface AiFuncService {
    formatSplit(text: string): Promise<number>;

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
     * @param dpTaskService 后台任务管理服务。
     * @param chatService 结构化对话任务服务。
     * @param localTtsService 本地语音合成服务。
     */
    constructor(
        @inject(TYPES.DpTaskService) private readonly dpTaskService: DpTaskService,
        @inject(TYPES.ChatService) private readonly chatService: ChatService,
        @inject(TYPES.LocalTtsService) private readonly localTtsService: LocalTtsService,
    ) {}

    public async formatSplit(text: string): Promise<number> {
        const taskId = await this.dpTaskService.create();
        // 走结构化输出：AI 直接返回 schema 校验后的 { formatedText } 对象。
        // 旧实现用纯文本 chat 把 AI 全文套进 { str: ... } 再 JSON 序列化，
        // 前端把整个双重编码字符串当章节文本解析，导致切分预览连环报错。
        this.chatService
            .run(taskId, AiFuncFormatSplitPrompt.schema, AiFuncFormatSplitPrompt.promptFunc(text))
            .catch((error) => {
                // run 内部已捕获流异常并落任务失败；这里只兜住限流等待超时等在进入 run 前抛出的异常。
                this.dpTaskService.fail(taskId, {
                    progress: error instanceof Error ? error.message : String(error),
                });
            });
        return taskId;
    }

    public async tts(text: string): Promise<string> {
        return UrlUtil.toUrl(await this.localTtsService.synthesize(text));
    }
}
