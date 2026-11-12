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
    /**
     * 由该主题真实字幕推导出的关键词，最多 3 个。
     *
     * 用途是给「未命名内容」一个可解释的临时名字：主题名优先取视频文件名，
     * 没有文件名时用关键词说明这组词为什么被放在一起。关键词不是模型生成的
     * 主题标题，只是本主题高频且能区别于其它主题的词。
     */
    keywords?: string[];
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
    /**
     * 与本词在同一句字幕里共现过的其他词（按共现次数降序，最多 3 个）。
     *
     * 共现边是「这两个词一起出现在真实语境里」的证据，比主题分组更细：
     * 同一视频里两个从没同句出现过的词，不该被当成一组来复习。
     */
    neighbors?: MemoryMapNeighborVO[];
}

/** 一条共现边。 */
export interface MemoryMapNeighborVO {
    word: string;
    /** 共同出现的句子数。 */
    weight: number;
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
