/**
 * 句子生词的本地选词结果。
 *
 * 说明：整份数据由本地词典产出，不调用模型、不访问网络，因此可以在打开学习页时立即使用。
 */
export type SentenceWordEntry = {
    /** 词典词条原形（小写）。 */
    word: string;
    /** 音标。 */
    phonetic: string;
    /** 中文释义（词典释义的前若干条）。 */
    meaning: string;
    /** 命中的考试档位标签（zk/gk/cet4/cet6/ky/toefl/ielts/gre）；空数组表示不在任何考纲内。 */
    tags: string[];
    /**
     * 该词在句中实际出现的词形（小写）；同一个词的多种变形会合并进同一条词条。
     * 界面用它把卡片对应的词在主舞台字幕上高亮出来。
     */
    surfaces: string[];
    /** 来自个人记忆库的优先级标签（到期复习 / 学习中 / 多次查词 / 陌生词）。 */
    memoryTag?: 'due' | 'learning' | 'lookup' | 'new';
    /** 当前掌握度（0~1），未入库词缺省。 */
    mastery?: number;
};

/** 供精读首卡与对话提示词使用的轻量记忆信号。 */
export type SentenceMemoryHints = {
    /** 建议优先讲解的词（到期/在学/刚查过的重点词）。 */
    focusWords: string[];
    /** 学习者已熟练掌握（known / mastery >= 0.8）、无需占焦点位的词。 */
    masteredWords: string[];
};

export type SentenceVocabularyVO = {
    /**
     * 值得重点认识的词，**按其在句中出现的顺序排列**。
     *
     * 选词规则：到期词 / 在学词 / 高频查词 / 本地词典中高价值非常见词（按记忆权重过滤已熟词）。
     */
    picks: SentenceWordEntry[];
    /** 句内每个词形的释义映射，键为句中实际出现的词形（小写），供悬停取词同步命中。 */
    details: Record<string, SentenceWordEntry>;
    /** 精简记忆画像信号（注入 AI 首卡提示词用）。 */
    memoryHints?: SentenceMemoryHints;
};
