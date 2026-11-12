import type { SentenceStudyCard } from '@/common/types/aiRes/AiUnifiedAnalysisRes';
import type {
    PersistedChatMessage,
    SentenceStudyNoteSaveParams,
    SentenceStudyRecordVO,
} from '@/common/types/chat';

/**
 * 整句学习笔记、首卡缓存与历史对话仓储。
 */
export default interface SentenceStudyNoteRepository {
    /**
     * 按 `(fileHash, sentenceIndex)` 读取本句缓存记录；无记录返回 null。
     */
    findByLocation(fileHash: string, sentenceIndex: number): Promise<SentenceStudyRecordVO | null>;

    /**
     * 按稳定 `sentenceKey` 读取记录；无记录返回 null。
     */
    findByKey(sentenceKey: string): Promise<SentenceStudyRecordVO | null>;

    /**
     * 幂等创建或局部更新本句学习记录（缺省字段保持现有数据库值不变）。
     */
    upsert(params: SentenceStudyNoteSaveParams): Promise<SentenceStudyRecordVO>;

    /**
     * 仅更新首卡缓存，不影响已有的手写笔记与对话轮次。
     */
    saveStudyCard(params: {
        sentenceKey: string;
        videoId: string;
        fileHash: string;
        sentenceIndex: number;
        originalText: string;
        studyCard: SentenceStudyCard;
        presetId?: string | null;
    }): Promise<SentenceStudyRecordVO>;

    /**
     * 追加或替换持久化对话历史与最近预设 ID。
     */
    saveMessages(params: {
        sentenceKey: string;
        videoId: string;
        fileHash: string;
        sentenceIndex: number;
        originalText: string;
        messages: PersistedChatMessage[];
        presetId?: string | null;
    }): Promise<SentenceStudyRecordVO>;
}
