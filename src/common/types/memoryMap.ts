import type { WordStatus } from '@/common/types/vocabulary';

/** 图谱查询参数。 */
export interface MemoryMapParams {
    /** 最多返回多少个主题簇。 */
    limit?: number;
}

/** 图谱中的一个主题簇。 */
export interface MemoryMapTopicVO {
    /** 稳定主题键；来自视频记录 ID，缺失时为字幕哈希。 */
    key: string;
    /** 展示用主题名；来自视频文件名，无标题时为 null。 */
    label: string | null;
    /** 该主题下出现的词数。 */
    wordCount: number;
    /** 该主题下每个记忆阶段的词数。 */
    counts: Record<WordStatus, number>;
    /** 该主题下最值得复习的词，最多 8 个。 */
    words: MemoryMapWordVO[];
}

/** 图谱中的一个词。 */
export interface MemoryMapWordVO {
    word: string;
    translate: string | null;
    status: WordStatus;
    mastery: number;
    /** 该词在本主题下被遇见/练习的次数。 */
    encounters: number;
    /** 是否已到期。 */
    due: boolean;
    /** 最近一次在该主题出现的时间。 */
    lastSeenAt: string;
    /** 一句真实上下文，供回忆；没有时为 null。 */
    context: string | null;
}

/** 记忆图谱快照。 */
export interface MemoryMapVO {
    generatedAt: string;
    /** 用户词表中的总词数（不含默认词表）。 */
    totalWords: number;
    /** 已进入复习/学习状态的词数。 */
    activeWords: number;
    /** 按最近活跃时间排序的主题簇。 */
    topics: MemoryMapTopicVO[];
    /** 没有视频上下文的词单独成簇；没有时为 null。 */
    looseWords: MemoryMapTopicVO | null;
}
