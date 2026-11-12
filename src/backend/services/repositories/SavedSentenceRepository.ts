import type {
    SavedSentenceVO,
    SaveSentenceInput,
    UpdateSavedSentenceInput,
} from '@/common/types/contextStudio';

/**
 * 收藏金句持久化仓储契约。
 */
export default interface SavedSentenceRepository {
    /** 查询所有已收藏金句，按创建时间倒序。 */
    findAll(): Promise<SavedSentenceVO[]>;

    /** 按 sentenceKey 查找收藏金句；不存在返回 null。 */
    findByKey(sentenceKey: string): Promise<SavedSentenceVO | null>;

    /** 按 videoId 查找该视频下已收藏的 sentenceKey 列表。 */
    findKeysByVideoId(videoId: string): Promise<string[]>;

    /** 幂等收藏或更新金句。 */
    upsert(input: SaveSentenceInput): Promise<SavedSentenceVO>;

    /** 局部更新金句的笔记或分类标签。 */
    updateNoteOrTag(input: UpdateSavedSentenceInput): Promise<SavedSentenceVO | null>;

    /** 取消收藏指定金句。 */
    deleteByKey(sentenceKey: string): Promise<boolean>;
}
