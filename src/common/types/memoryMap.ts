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
    /** 关联视频记录 ID（当主题来自视频时）。 */
    videoId?: string | null;
    /** 关联视频本地路径，用于前端按需获取封面缩略图。 */
    videoPath?: string | null;
    /** 展示用主题名；来自视频文件名，无标题时为 null。 */
    label: string | null;
    /** 该主题下出现的词数。 */
    wordCount: number;
    /** 该主题下每个记忆阶段的词数。 */
    counts: Record<WordStatus, number>;
    /** 该主题下最值得复习的词，最多 8 个。 */
    words: MemoryMapWordVO[];
    /** 该主题下当前到期的词数。 */
    dueCount?: number;
    /** 主题记忆健康度（0–100）。 */
    healthScore?: number;
    /** 主题内已复习词的平均记忆稳定度（天）。 */
    avgStabilityDays?: number | null;
    /** 供“专题复习启动器”使用的有序词列表（按遗忘紧急度优先，最多 25 个）。 */
    reviewWords?: string[];
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
    /** FSRS 记忆稳定度（天）。 */
    stability?: number;
    /** 累计遗忘次数。 */
    lapses?: number;
    /** 下次到期时间（ISO 8601）。 */
    dueAt?: string | null;
    /** 当前估算回忆概率（0–1）；未首刷时为 null。 */
    retrievability?: number | null;
    /**
     * 与本词在同一句字幕里共现过的其他词（按共现次数降序，最多 3 个）。
     *
     * 共现边是「这两个词一起出现在真实语境里」的证据，比主题分组更细：
     * 同一视频里两个从没同句出现过的词，不该被当成一组来复习。
     */
    neighbors?: MemoryMapNeighborVO[];
}

/** 未来单日复习负荷预测。 */
export interface MemoryForecastDayVO {
    /** 0 = 今日（含已逾期），1..13 = 未来第 N 天。 */
    dayOffset: number;
    /** MM-DD 展示标签，今日为 "today"。 */
    dateLabel: string;
    /** 当日到期需要巩固的词数。 */
    dueCount: number;
}

/** 全局遗忘曲线与记忆健康全景。 */
export interface MemoryHealthOverviewVO {
    retrievabilityBuckets: {
        /** 已到期或 R < 0.60。 */
        danger: number;
        /** 0.60 <= R < 0.85。 */
        fading: number;
        /** R >= 0.85。 */
        stable: number;
        /** 新词尚未进入正式复习。 */
        unreviewed: number;
    };
    /** 累计遗忘 >= 4 次的顽固难词数。 */
    leechCount: number;
    /** 已进入复习卡且有稳定度记录的词平均稳定度（天）。 */
    avgStabilityDays: number | null;
    /** 未来 14 天每日复习负荷。 */
    forecastDays: MemoryForecastDayVO[];
    /** 基于平均稳定度的 FSRS 遗忘衰减曲线参考点（0–30 天）。 */
    decayCurve: Array<{ day: number; retention: number }>;
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
    /** 全局遗忘曲线与记忆健康统计。 */
    memoryHealth?: MemoryHealthOverviewVO;
}
