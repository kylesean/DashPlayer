import type { WordSource, WordStatus } from '@/common/types/vocabulary';

/**
 * 一个词的「你与它的历史」快照。
 *
 * 纯只读投影：词卡打开时读取一次，不写事件、不改掌握度。它回答的是
 * 「上次在哪里见过、上次复习是什么时候、现在处于什么状态」，而不是只给
 * 一个孤立的状态标签。
 */
export interface WordMemoryVO {
    /** canonical lemma。 */
    word: string;
    /** 当前学习状态；未入词表时为 null。 */
    status: WordStatus | null;
    /** 状态来源；未入词表时为 null。 */
    source: WordSource | null;
    /** 掌握概率 0-1。 */
    mastery: number;
    /** 掌握估计的置信度 0-1。 */
    confidence: number;
    /** 最近一次在字幕里遇见的时间。 */
    lastSeenAt: string | null;
    /** 最近一次复习的时间。 */
    lastReviewedAt: string | null;
    /** 下次复习到期时间。 */
    dueAt: string | null;
    /** 已经复习过的次数。 */
    reviewCount: number;
    /** 遗忘（评 Again）的次数。 */
    lapseCount: number;
    /** 最近一次带字幕原句的遭遇；没有时为 null。 */
    lastContext: WordMemoryContextVO | null;
}

/**
 * 最近一次带字幕原句的遭遇。
 */
export interface WordMemoryContextVO {
    /** 字幕原句。 */
    text: string;
    /** 视频路径；未知时为 null。 */
    videoId: string | null;
    /** 视频文件名；未知时为 null。 */
    videoFileName: string | null;
    /** 句在字幕中的序号。 */
    sentenceIndex: number | null;
    /** 遭遇时间。 */
    at: string;
}
