import { z } from 'zod';

/**
 * 句中值得聚焦拆解的高价值词/短语/地道表达（结合学习者记忆筛选，允许 0 条）。
 */
export const FocalPointSchema = z.object({
    expression: z.string().describe('Focus word, phrasal verb, idiom, or nuanced expression in the line.'),
    kind: z.enum(['word', 'phrase', 'slang', 'nuance']).describe('Category of the focal point.'),
    coreImage: z.string().describe('Physical scene or embodied image schema in 1-2 plain Chinese sentences.'),
    meaningInContext: z.string().describe('How the physical image maps to this specific line plus concise Chinese meaning.'),
    tag: z.string().optional().describe('Short label such as 熟词僻义 / 地道搭配 / 习惯表达.'),
});

export type FocalPoint = z.infer<typeof FocalPointSchema>;

/**
 * 影响“听懂”的真实语音切分、连读或语调现象（清晰慢速句允许 0 条）。
 */
export const ListeningCueSchema = z.object({
    span: z.string().describe('Spoken words or segment with notable phonetic reduction or stress.'),
    phenomenon: z.string().describe('Phenomenon such as 连读 / 弱读 / 失爆 / 语调重音.'),
    tip: z.string().describe('Short practical listening hint in Chinese.'),
});

export type ListeningCue = z.infer<typeof ListeningCueSchema>;

/**
 * 整句学习统一首卡（精读卡）结构化契约。
 *
 * 将原本拆分的“补全翻译”和“结构/短语解析”合并为一次上下文感知输出，
 * 覆盖台词还原、意群切分、认知语言学物理意象焦点、听感难点与语用点睛。
 */
export const SentenceStudyCardSchema = z.object({
    sentence: z.object({
        completeText: z.string().describe('Complete English sentence reconstructed across broken subtitle lines if needed.'),
        contextualTranslation: z.string().describe('Natural Chinese translation aligned with plot tone.'),
        chunks: z.array(z.string()).describe('2-5 natural thought chunks matching completeText order.'),
    }),
    focalPoints: z.array(FocalPointSchema).max(3).describe('0-3 high-value words/phrases tailored to learner memory; empty if trivial.'),
    listeningLens: z.array(ListeningCueSchema).max(2).describe('0-2 real listening traps; empty array if spoken clearly.'),
    sentenceLens: z.object({
        structureInsight: z.string().describe('1 concise Chinese takeaway explaining speaker framing/syntax choice without textbook jargon.'),
        subtext: z.string().describe('1 concise Chinese note on speaker attitude, sarcasm, or situational subtext.'),
    }),
});

export type SentenceStudyCard = z.infer<typeof SentenceStudyCardSchema>;

/** 兼容旧引用的结构化契约别名。 */
export const AiUnifiedAnalysisSchema = SentenceStudyCardSchema;

/** 兼容旧引用的结构化响应类型别名。 */
export type AiUnifiedAnalysisRes = SentenceStudyCard;
