/**
 * 语境工坊（Context Studio）共享领域契约。
 *
 * 统一管理「生词」与「收藏金句」的轻量元数据与语境引用，
 * 彻底摆脱对物理切片文件的依赖，直接通过时间戳引用原视频。
 */

/** 收藏金句的分类标签。 */
export type SavedSentenceTag = 'expression' | 'pronunciation' | 'grammar' | 'general';

export const SAVED_SENTENCE_TAGS: readonly SavedSentenceTag[] = [
    'expression',
    'pronunciation',
    'grammar',
    'general',
] as const;

/** 收藏金句视图对象。 */
export interface SavedSentenceVO {
    id: number;
    sentenceKey: string;
    videoId: string;
    videoTitle: string;
    videoPath?: string;
    fileHash: string;
    sentenceIndex: number;
    startTime: number;
    endTime: number;
    text: string;
    textZh: string;
    note: string;
    tag: SavedSentenceTag;
    createdAt: string;
    updatedAt: string;
}

/** 收藏或更新金句的入参。 */
export interface SaveSentenceInput {
    sentenceKey: string;
    videoId: string;
    videoTitle?: string;
    fileHash: string;
    sentenceIndex: number;
    startTime: number;
    endTime: number;
    text: string;
    textZh?: string;
    note?: string;
    tag?: SavedSentenceTag;
}

/** 更新金句笔记或标签的入参。 */
export interface UpdateSavedSentenceInput {
    sentenceKey: string;
    note?: string;
    tag?: SavedSentenceTag;
}

/** 单词或金句关联的视频语境出处。 */
export interface WordContextOccurrence {
    id: string;
    videoId: string;
    videoTitle: string;
    videoPath?: string;
    fileHash?: string;
    sentenceIndex?: number;
    startTime?: number;
    endTime?: number;
    context: string;
    contextZh?: string;
    createdAt: string;
    source: 'encounter' | 'clip';
}

/** 精读文稿文档摘要。 */
export interface ReaderDocumentSummary {
    videoId: string;
    title: string;
    srtFile: string;
    videoPath: string;
    updatedAt: string;
}
