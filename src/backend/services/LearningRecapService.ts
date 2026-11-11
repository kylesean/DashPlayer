import { generateObject, type LanguageModel } from 'ai';
import { inject, injectable } from 'inversify';
import { z } from 'zod';

import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import { ObjUtil } from '@/backend/utils/ObjUtil';
import { concurrency } from '@/backend/utils/concurrency';
import { analyzeWords } from '@/backend/utils/language/VocabularyMatcher';
import type AiProviderService from '@/backend/services/AiProviderService';
import type CacheService from '@/backend/services/CacheService';
import type LearningDataService from '@/backend/services/LearningDataService';
import { LEARNING_SESSION_ACTIONS } from '@/backend/services/LearningDataService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import { isContentLemma } from '@/common/learning/contentWords';
import { parseMaybeJson } from '@/common/utils/ai/parseMaybeJson';
import type {
    LearningRecapParams,
    LearningRecapVO,
    LearningRecapWordVO,
    RetellEvaluationParams,
    RetellEvaluationVO,
    RetellLevel,
} from '@/common/types/learningRecap';
import type {
    LearningSessionSummaryVO,
    LearningSessionWordVO,
} from '@/common/types/learningSession';

/** 提示词或输出契约变化时递增，使旧缓存自然失效。 */
const PROMPT_VERSION = 'learning-recap-v1';
const RECAP_CACHE_TTL_MS = 60 * 60 * 1000;
const RETELL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOUD_TIMEOUT_MS = 30_000;
const LOCAL_TIMEOUT_MS = 60_000;
const MAX_CONTEXTS = 6;
const MAX_RECAP_WORDS = 3;
const MAX_CONTEXT_CHARS = 400;
const MAX_RESPONSE_CHARS = 2_000;
const MAX_EXPRESSION_WORDS = 6;

/** 复盘中的一条真实字幕语境。 */
export interface RecapContext {
    /** 字幕原文。 */
    text: string;
    /** 该句关联的会话词 lemma。 */
    lemmas: string[];
    /** 最近一次在该句发生学习动作的时间。 */
    lastSeenAt: string;
}

/**
 * AI 复盘的结构化输出契约。
 */
const recapSchema = z.object({
    headline: z.string().min(1).max(160),
    words: z.array(z.object({
        word: z.string().min(1).max(80),
        note: z.string().min(1).max(160),
    })).min(1).max(MAX_RECAP_WORDS),
    sentence: z.object({
        text: z.string().min(1).max(MAX_CONTEXT_CHARS),
        note: z.string().min(1).max(200),
    }),
    expression: z.object({
        text: z.string().min(1).max(120),
        meaning: z.string().min(1).max(160),
    }).optional(),
    speakingTask: z.string().min(1).max(200),
});

/**
 * AI 复述点评的结构化输出契约。
 */
const retellSchema = z.object({
    level: z.enum(['great', 'good', 'retry']),
    feedback: z.string().min(1).max(300),
    improved: z.string().max(300).optional(),
});

/**
 * 本次学习复盘与复述反馈服务契约。
 */
export default interface LearningRecapService {
    /**
     * 生成一次播放会话的学习复盘。
     *
     * AI 不可用或输出越出会话事实时回退本地确定性摘要，不阻塞入口。
     */
    buildRecap(params: LearningRecapParams): Promise<LearningRecapVO>;

    /**
     * 检查用户对原句的复述。
     *
     * 关键词覆盖率始终由本地计算；AI 只在同等事实基础上补充点评与改写。
     */
    evaluateRetell(params: RetellEvaluationParams): Promise<RetellEvaluationVO>;
}

/**
 * 学习复盘实现。
 *
 * 会话词、真实字幕句与计数是唯一事实来源；模型不得引入不在会话里的词或句子。
 */
@injectable()
export class LearningRecapServiceImpl implements LearningRecapService {
    private readonly logger = getMainLogger('LearningRecapService');
    private readonly recapInFlight = new Map<string, Promise<LearningRecapVO>>();
    private readonly retellInFlight = new Map<string, Promise<RetellEvaluationVO>>();

    constructor(
        @inject(TYPES.LearningDataService) private readonly learningDataService: LearningDataService,
        @inject(TYPES.LearningDataRepository) private readonly learningDataRepository: LearningDataRepository,
        @inject(TYPES.AiProviderService) private readonly aiProviderService: AiProviderService,
        @inject(TYPES.LocalAiService) private readonly localAiService: LocalAiService,
        @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    ) {}

    public async buildRecap(params: LearningRecapParams): Promise<LearningRecapVO> {
        const since = this.parseSince(params.since);
        if (!params.videoId && !params.fileHash) {
            throw new Error('videoId 或 fileHash 至少提供一个');
        }

        const [summary, events] = await Promise.all([
            this.learningDataService.getSessionSummary({
                videoId: params.videoId,
                fileHash: params.fileHash,
                since: since.toISOString(),
                limit: 8,
            }),
            this.learningDataRepository.listSessionEvents({
                since: since.toISOString(),
                videoId: params.videoId,
                fileHash: params.fileHash,
                actions: LEARNING_SESSION_ACTIONS,
                limit: 500,
            }),
        ]);
        const contexts = this.buildContexts(events);
        const localRecap = this.buildLocalRecap(summary, contexts, since.toISOString());

        // 没有目标词或没有真实字幕句时，AI 没有可靠 grounding，直接用本地摘要。
        if (summary.words.length === 0 || contexts.length === 0) {
            return localRecap;
        }

        const cloudModel = this.resolveCloudModel();
        const localModelId = await this.resolveLocalModelId();
        if (!cloudModel && !localModelId) {
            return localRecap;
        }

        const cacheKey = this.buildRecapCacheKey({
            params,
            since: since.toISOString(),
            summary,
            contexts,
            cloudModelId: this.modelIdOf(cloudModel),
            localModelId: localModelId ?? '',
        });
        if (!params.forceRefresh) {
            const cached = this.cacheService.get('cache:learning-recap', cacheKey);
            if (cached) {
                return { ...cached, cached: true };
            }
        }

        const existing = this.recapInFlight.get(cacheKey);
        if (existing) {
            return existing;
        }

        const task = this.generateRecap({
            params,
            summary,
            contexts,
            localRecap,
            cacheKey,
            cloudModel,
            localModelId,
        }).finally(() => {
            this.recapInFlight.delete(cacheKey);
        });
        this.recapInFlight.set(cacheKey, task);
        return task;
    }

    public async evaluateRetell(params: RetellEvaluationParams): Promise<RetellEvaluationVO> {
        const original = params.original?.trim().slice(0, MAX_CONTEXT_CHARS) ?? '';
        const response = params.response?.trim().slice(0, MAX_RESPONSE_CHARS) ?? '';
        if (!original) {
            throw new Error('原句不能为空');
        }
        if (!response) {
            throw new Error('复述内容不能为空');
        }

        const localResult = this.buildLocalRetell(original, response);
        const cloudModel = this.resolveCloudModel();
        const localModelId = await this.resolveLocalModelId();
        if (!cloudModel && !localModelId) {
            return localResult;
        }

        const cacheKey = this.buildRetellCacheKey({
            params,
            original,
            response,
            cloudModelId: this.modelIdOf(cloudModel),
            localModelId: localModelId ?? '',
        });
        if (!params.forceRefresh) {
            const cached = this.cacheService.get('cache:retell-feedback', cacheKey);
            if (cached) {
                return { ...cached, cached: true };
            }
        }

        const existing = this.retellInFlight.get(cacheKey);
        if (existing) {
            return existing;
        }

        const task = this.generateRetell({
            params,
            original,
            response,
            localResult,
            cacheKey,
            cloudModel,
            localModelId,
        }).finally(() => {
            this.retellInFlight.delete(cacheKey);
        });
        this.retellInFlight.set(cacheKey, task);
        return task;
    }

    /**
     * 从会话事件中提取去重后的真实字幕语境，按关联词数与最近时间排序。
     */
    private buildContexts(events: Awaited<ReturnType<LearningDataRepository['listSessionEvents']>>): RecapContext[] {
        const contexts = new Map<string, { text: string; lemmas: Set<string>; lastSeenAt: string }>();
        for (const event of events) {
            const text = event.context?.trim().slice(0, MAX_CONTEXT_CHARS) ?? '';
            if (!text) {
                continue;
            }
            const key = this.normalizeForMatch(text);
            const entry = contexts.get(key) ?? {
                text,
                lemmas: new Set<string>(),
                lastSeenAt: event.created_at,
            };
            entry.lemmas.add(event.lemma.toLowerCase());
            if (event.created_at > entry.lastSeenAt) {
                entry.lastSeenAt = event.created_at;
            }
            contexts.set(key, entry);
        }
        return Array.from(contexts.values())
            .sort((left, right) => {
                if (left.lemmas.size !== right.lemmas.size) {
                    return right.lemmas.size - left.lemmas.size;
                }
                return right.lastSeenAt.localeCompare(left.lastSeenAt);
            })
            .slice(0, MAX_CONTEXTS)
            .map((entry) => ({
                text: entry.text,
                lemmas: Array.from(entry.lemmas),
                lastSeenAt: entry.lastSeenAt,
            }));
    }

    /**
     * 本地确定性复盘：即使模型不可用，也给出稳定的词、句与计数回顾。
     */
    private buildLocalRecap(
        summary: LearningSessionSummaryVO,
        contexts: RecapContext[],
        since: string,
    ): LearningRecapVO {
        const selectedWords = summary.words
            .slice()
            .sort((left, right) => this.wordPriority(left) - this.wordPriority(right))
            .slice(0, MAX_RECAP_WORDS);
        const words = selectedWords.map((word) => ({
            word: word.word,
            translate: word.translate,
            note: null,
        }));
        // 本地句子优先与本次最值得记的词同句，避免「词是 journey、句子却讲 resilient」。
        const lemmaWeight = new Map(
            selectedWords.map((word, index) => [word.word.toLowerCase(), selectedWords.length - index]),
        );
        const contextScore = (context: RecapContext) =>
            context.lemmas.reduce((sum, lemma) => sum + (lemmaWeight.get(lemma) ?? 0), 0);
        const sentenceContext = contexts
            .slice()
            .sort((left, right) => {
                const scoreDiff = contextScore(right) - contextScore(left);
                if (scoreDiff !== 0) {
                    return scoreDiff;
                }
                if (left.lemmas.length !== right.lemmas.length) {
                    return right.lemmas.length - left.lemmas.length;
                }
                return right.lastSeenAt.localeCompare(left.lastSeenAt);
            })[0];
        const sentence = sentenceContext
            ? { text: sentenceContext.text, note: null }
            : null;
        return {
            since,
            source: 'local',
            cached: false,
            headline: '',
            words,
            sentence,
            expression: null,
            speakingTask: '',
            counts: summary.counts,
        };
    }

    /**
     * 依次尝试云端与本地模型；两者都失败时保留本地确定性复盘。
     */
    private async generateRecap(args: {
        params: LearningRecapParams;
        summary: LearningSessionSummaryVO;
        contexts: RecapContext[];
        localRecap: LearningRecapVO;
        cacheKey: string;
        cloudModel: LanguageModel | null;
        localModelId: string | null;
    }): Promise<LearningRecapVO> {
        const prompt = buildLearningRecapPrompt({
            summary: args.summary,
            contexts: args.contexts,
            locale: this.resolveLocale(args.params.locale),
        });
        const failures: string[] = [];

        if (args.cloudModel) {
            const startedAt = Date.now();
            try {
                const result = await concurrency.withRateLimit('gpt', () => generateObject({
                    model: args.cloudModel!,
                    schema: recapSchema,
                    prompt,
                    maxRetries: 0,
                    abortSignal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
                }));
                const recap = this.groundRecap(result.object, args.summary, args.contexts, args.localRecap, 'ai');
                this.cacheService.set('cache:learning-recap', args.cacheKey, recap, RECAP_CACHE_TTL_MS);
                this.logger.info('learning recap ready', {
                    source: 'ai',
                    durationMs: Date.now() - startedAt,
                    words: recap.words.length,
                });
                return recap;
            } catch (error) {
                failures.push(`cloud: ${this.errorMessage(error)}`);
                this.logger.warn('learning recap cloud failed, trying local model', {
                    durationMs: Date.now() - startedAt,
                    error: this.errorMessage(error),
                });
            }
        }

        if (args.localModelId) {
            const startedAt = Date.now();
            try {
                const output = await this.localAiService.generate(
                    prompt,
                    z.toJSONSchema(recapSchema),
                    args.localModelId,
                    AbortSignal.timeout(LOCAL_TIMEOUT_MS),
                );
                const parsed = recapSchema.safeParse(parseMaybeJson(output));
                if (!parsed.success) {
                    this.logger.error('learning recap local output invalid', {
                        issues: parsed.error.issues,
                        rawText: JSON.stringify(output)?.slice(0, 500),
                    });
                    throw new Error('本地模型复盘输出不符合契约');
                }
                const recap = this.groundRecap(parsed.data, args.summary, args.contexts, args.localRecap, 'local');
                this.cacheService.set('cache:learning-recap', args.cacheKey, recap, RECAP_CACHE_TTL_MS);
                this.logger.info('learning recap ready', {
                    source: 'local-model',
                    durationMs: Date.now() - startedAt,
                    words: recap.words.length,
                });
                return recap;
            } catch (error) {
                failures.push(`local: ${this.errorMessage(error)}`);
                this.logger.error('learning recap local model failed', {
                    durationMs: Date.now() - startedAt,
                    error: this.errorMessage(error),
                });
            }
        }

        this.logger.warn('learning recap fell back to deterministic summary', {
            failures: failures.join('; '),
        });
        return args.localRecap;
    }

    /**
     * 校验 AI 复盘是否只使用会话事实；越界词句回退本地选择，避免编造。
     */
    private groundRecap(
        raw: z.infer<typeof recapSchema>,
        summary: LearningSessionSummaryVO,
        contexts: RecapContext[],
        localRecap: LearningRecapVO,
        source: 'ai' | 'local',
    ): LearningRecapVO {
        const wordMap = new Map(summary.words.map((word) => [word.word.toLowerCase(), word]));
        const usedWords = new Set<string>();
        const words: LearningRecapWordVO[] = [];
        for (const item of raw.words) {
            const normalized = item.word.trim().toLowerCase();
            const matched = wordMap.get(normalized);
            if (!matched || usedWords.has(normalized)) {
                continue;
            }
            usedWords.add(normalized);
            words.push({
                word: matched.word,
                translate: matched.translate,
                note: item.note.trim(),
            });
        }
        for (const fallback of localRecap.words) {
            if (words.length >= MAX_RECAP_WORDS) {
                break;
            }
            if (usedWords.has(fallback.word.toLowerCase())) {
                continue;
            }
            words.push(fallback);
        }
        if (words.length === 0) {
            throw new Error('AI 复盘没有使用任何会话词');
        }

        const matchedSentence = contexts.find(
            (context) => this.normalizeForMatch(context.text) === this.normalizeForMatch(raw.sentence.text),
        );
        const sentence = matchedSentence
            ? { text: matchedSentence.text, note: raw.sentence.note.trim() }
            : localRecap.sentence;
        if (!sentence) {
            throw new Error('AI 复盘没有可用的真实字幕句');
        }

        let expression: LearningRecapVO['expression'] = null;
        if (raw.expression) {
            const text = raw.expression.text.trim();
            const appearsInSession = contexts.some(
                (context) => this.normalizeForMatch(context.text).includes(this.normalizeForMatch(text)),
            );
            if (appearsInSession && text.split(/\s+/u).length <= MAX_EXPRESSION_WORDS) {
                expression = {
                    text,
                    meaning: raw.expression.meaning.trim(),
                };
            }
        }

        return {
            since: localRecap.since,
            source,
            cached: false,
            headline: raw.headline.trim(),
            words,
            sentence,
            expression,
            speakingTask: raw.speakingTask.trim(),
            counts: summary.counts,
        };
    }

    /**
     * 本地复述检查：以原句内容词覆盖率为可解释信号，不假装理解语义。
     */
    private buildLocalRetell(original: string, response: string): RetellEvaluationVO {
        const contentWords = new Map<string, string>();
        for (const token of analyzeWords(original)) {
            const lemma = token.lemma.toLowerCase();
            if (token.type === 'word' && isContentLemma(lemma) && !contentWords.has(lemma)) {
                contentWords.set(lemma, token.text);
            }
        }
        const responseTokens = analyzeWords(response);
        const responseLemmas = new Set(
            responseTokens
                .filter((token) => token.type === 'word')
                .map((token) => token.lemma.toLowerCase()),
        );
        const missingWords: string[] = [];
        let matchedKeywords = 0;
        for (const [lemma, text] of contentWords) {
            if (responseLemmas.has(lemma)) {
                matchedKeywords += 1;
            } else {
                missingWords.push(text);
            }
        }
        const totalKeywords = contentWords.size;
        const coverage = totalKeywords === 0 ? 0 : matchedKeywords / totalKeywords;
        const responseWordCount = responseTokens.filter((token) => token.type === 'word').length;
        let level: RetellLevel = totalKeywords === 0
            ? (responseWordCount >= 2 ? 'good' : 'retry')
            : coverage >= 0.6
                ? 'great'
                : coverage >= 0.3
                    ? 'good'
                    : 'retry';
        if (level === 'great' && responseWordCount < 4) {
            level = 'good';
        }
        return {
            level,
            feedback: '',
            improved: '',
            coverage,
            matchedKeywords,
            totalKeywords,
            missingWords: missingWords.slice(0, 5),
            source: 'local',
            cached: false,
        };
    }

    /**
     * 依次尝试云端与本地模型；两者都失败时保留本地关键词反馈。
     */
    private async generateRetell(args: {
        params: RetellEvaluationParams;
        original: string;
        response: string;
        localResult: RetellEvaluationVO;
        cacheKey: string;
        cloudModel: LanguageModel | null;
        localModelId: string | null;
    }): Promise<RetellEvaluationVO> {
        const prompt = buildRetellPrompt({
            original: args.original,
            response: args.response,
            coverage: args.localResult.coverage,
            missingWords: args.localResult.missingWords,
            locale: this.resolveLocale(args.params.locale),
        });

        if (args.cloudModel) {
            try {
                const result = await concurrency.withRateLimit('gpt', () => generateObject({
                    model: args.cloudModel!,
                    schema: retellSchema,
                    prompt,
                    maxRetries: 0,
                    abortSignal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
                }));
                return this.finishRetell(result.object, args.localResult, args.cacheKey, 'ai', args.original);
            } catch (error) {
                this.logger.warn('retell feedback cloud failed, trying local model', {
                    error: this.errorMessage(error),
                });
            }
        }

        if (args.localModelId) {
            try {
                const output = await this.localAiService.generate(
                    prompt,
                    z.toJSONSchema(retellSchema),
                    args.localModelId,
                    AbortSignal.timeout(LOCAL_TIMEOUT_MS),
                );
                const parsed = retellSchema.safeParse(parseMaybeJson(output));
                if (!parsed.success) {
                    this.logger.error('retell feedback local output invalid', {
                        issues: parsed.error.issues,
                        rawText: JSON.stringify(output)?.slice(0, 500),
                    });
                    throw new Error('本地模型复述反馈输出不符合契约');
                }
                return this.finishRetell(parsed.data, args.localResult, args.cacheKey, 'local', args.original);
            } catch (error) {
                this.logger.error('retell feedback local model failed', {
                    error: this.errorMessage(error),
                });
            }
        }

        return args.localResult;
    }

    /**
     * 归一化 AI 复述点评并合并本地关键词信号。
     */
    private finishRetell(
        raw: z.infer<typeof retellSchema>,
        localResult: RetellEvaluationVO,
        cacheKey: string,
        source: 'ai' | 'local',
        original: string,
    ): RetellEvaluationVO {
        const feedback = raw.feedback.trim();
        if (!feedback) {
            throw new Error('模型未返回有效的复述点评');
        }
        const improved = raw.improved?.trim().slice(0, 300) ?? '';
        const normalizedImproved = improved
            && this.normalizeForMatch(improved) !== this.normalizeForMatch(original)
            ? improved
            : '';
        const result: RetellEvaluationVO = {
            level: raw.level,
            feedback,
            improved: normalizedImproved,
            coverage: localResult.coverage,
            matchedKeywords: localResult.matchedKeywords,
            totalKeywords: localResult.totalKeywords,
            missingWords: localResult.missingWords,
            source,
            cached: false,
        };
        this.cacheService.set('cache:retell-feedback', cacheKey, result, RETELL_CACHE_TTL_MS);
        return result;
    }

    /**
     * 复盘缓存键：会话定位、词句事实、模型与提示词版本任一变化都重新生成。
     */
    private buildRecapCacheKey(args: {
        params: LearningRecapParams;
        since: string;
        summary: LearningSessionSummaryVO;
        contexts: RecapContext[];
        cloudModelId: string;
        localModelId: string;
    }): string {
        return ObjUtil.hash({
            mode: 'learning-recap',
            version: PROMPT_VERSION,
            videoId: args.params.videoId ?? '',
            fileHash: args.params.fileHash ?? '',
            since: args.since,
            locale: this.resolveLocale(args.params.locale),
            words: args.summary.words.map((word) => word.word).sort(),
            contexts: args.contexts.map((context) => context.text).sort(),
            cloudModelId: args.cloudModelId,
            localModelId: args.localModelId,
        });
    }

    /**
     * 复述缓存键：原句、用户答案、语言与模型任一变化都重新检查。
     */
    private buildRetellCacheKey(args: {
        params: RetellEvaluationParams;
        original: string;
        response: string;
        cloudModelId: string;
        localModelId: string;
    }): string {
        return ObjUtil.hash({
            mode: 'retell-feedback',
            version: PROMPT_VERSION,
            original: this.normalizeForMatch(args.original),
            response: args.response.trim(),
            locale: this.resolveLocale(args.params.locale),
            cloudModelId: args.cloudModelId,
            localModelId: args.localModelId,
        });
    }

    /**
     * 目标词优先级：先复习到期，再正在学习、收藏与已掌握。
     */
    private wordPriority(word: LearningSessionWordVO): number {
        if (word.dueAt) return 0;
        if (word.status === 'learning') return 1;
        if (word.actions.includes('save')) return 2;
        if (word.status === 'known') return 3;
        return 4;
    }

    /**
     * 读取云端整句学习模型；配置或功能开关不可用时按没有云端处理。
     */
    private resolveCloudModel(): LanguageModel | null {
        try {
            return this.aiProviderService.getModel('sentenceLearning');
        } catch (error) {
            this.logger.warn('learning recap cloud model unavailable', {
                error: this.errorMessage(error),
            });
            return null;
        }
    }

    /**
     * 解析本地推理可用的模型 id；运行时缺失或使用中模型未安装时返回 null。
     */
    private async resolveLocalModelId(): Promise<string | null> {
        try {
            const status = await this.localAiService.getStatus();
            if (!status.runtimeReady) return null;
            return status.models.find((model) => model.modelId === status.activeModelId)?.ready
                ? status.activeModelId
                : null;
        } catch (error) {
            this.logger.warn('learning recap local model resolve failed', {
                error: this.errorMessage(error),
            });
            return null;
        }
    }

    /**
     * 读取语言模型稳定标识；字符串形式的模型 id 原样返回。
     */
    private modelIdOf(model: LanguageModel | null): string {
        if (!model) return '';
        return typeof model === 'string' ? model : model.modelId;
    }

    /**
     * 校验并归一化会话开始时间。
     */
    private parseSince(since: string): Date {
        const parsed = new Date(since);
        if (Number.isNaN(parsed.getTime())) {
            throw new Error('会话开始时间无效');
        }
        return parsed;
    }

    /**
     * 归一化前端语言，仅接受应用支持的两个 locale。
     */
    private resolveLocale(locale: LearningRecapParams['locale']): 'zh-CN' | 'en-US' {
        return locale === 'en-US' ? 'en-US' : 'zh-CN';
    }

    /**
     * 匹配用归一化：忽略大小写、引号与多余空白。
     */
    private normalizeForMatch(text: string): string {
        return text
            .toLowerCase()
            .replace(/[“”"'‘’]/gu, '')
            .replace(/\s+/gu, ' ')
            .trim();
    }

    /**
     * 提取可写入日志的错误信息。
     */
    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * 复盘提示词所需的会话事实。
 */
export interface LearningRecapPromptInput {
    summary: LearningSessionSummaryVO;
    contexts: RecapContext[];
    locale: 'zh-CN' | 'en-US';
}

/**
 * 构建学习复盘提示词。
 *
 * @param input 会话词、计数、真实字幕句与输出语言。
 * @returns 完整提示词。
 */
export const buildLearningRecapPrompt = (input: LearningRecapPromptInput): string => {
    const language = input.locale === 'en-US' ? 'English' : 'Simplified Chinese';
    const wordLines = input.summary.words.map((word) => {
        const meta = [
            word.translate ? `translation: ${word.translate}` : 'no translation',
            word.status,
            word.dueAt ? 'due now' : '',
        ].filter(Boolean).join(', ');
        return `- ${word.word} (${meta})`;
    });
    const contextLines = input.contexts.map((context, index) => {
        const related = context.lemmas.length > 0 ? ` | related words: ${context.lemmas.join(', ')}` : '';
        return `${index + 1}. "${context.text}"${related}`;
    });
    return [
        'You are an English-learning coach writing a 90-second recap of a video study session.',
        `Write every explanatory field in ${language}.`,
        '',
        `Session counts: encountered ${input.summary.counts.encountered}, mastered ${input.summary.counts.mastered}, due ${input.summary.counts.due}, practice ${input.summary.counts.practice}.`,
        '',
        'Target words (the word list may only use these exact words):',
        ...wordLines,
        '',
        'Real subtitle sentences from this session:',
        ...contextLines,
        '',
        'Return JSON with this shape:',
        '{"headline":"one warm sentence about this session","words":[{"word":"exact word from the list","note":"one concrete memory hook"}],"sentence":{"text":"exact sentence copied from the list","note":"why this sentence is worth remembering"},"expression":{"text":"2-4 word expression appearing verbatim in a sentence","meaning":"short meaning"},"speakingTask":"one 20-60 second speaking task"}',
        '',
        'Rules:',
        '1. Use 2-3 words, only from the target word list. Never invent a word.',
        '2. sentence.text must be copied exactly from the provided sentences.',
        '3. expression must appear verbatim in one of the provided sentences; omit the field when none is useful.',
        '4. Keep headline, notes and speakingTask short and concrete. No emoji, no grammar lectures.',
        '5. Output valid JSON only, without markdown fences.',
    ].join('\n');
};

/**
 * 构建复述点评提示词。
 *
 * @param input 原句、用户复述、本地关键词信号与输出语言。
 * @returns 完整提示词。
 */
export const buildRetellPrompt = (input: {
    original: string;
    response: string;
    coverage: number;
    missingWords: string[];
    locale: 'zh-CN' | 'en-US';
}): string => {
    const language = input.locale === 'en-US' ? 'English' : 'Simplified Chinese';
    return [
        'You are an English tutor evaluating a learner\'s written retelling of one subtitle sentence.',
        `Write feedback in ${language}.`,
        '',
        `Original sentence: "${input.original}"`,
        `Learner's retelling: "${input.response}"`,
        `Local keyword coverage: ${Math.round(input.coverage * 100)}%`,
        `Keywords not covered: ${input.missingWords.join(', ') || 'none'}`,
        '',
        'Judge whether the retelling conveys the original meaning. Accept synonyms, simpler grammar and a different sentence structure. Do not require exact wording. Do not grade grammar unless it blocks meaning.',
        '',
        'Return JSON:',
        '{"level":"great|good|retry","feedback":"one or two specific, encouraging sentences","improved":"a natural English paraphrase, at most 30 words"}',
        '',
        'Rules:',
        '1. great = meaning is complete and easy to follow; good = main idea is there but something important is missing or unclear; retry = meaning is substantially off or too vague.',
        '2. improved must be a natural paraphrase, not a copy of the original sentence.',
        '3. Output valid JSON only, without markdown fences.',
    ].join('\n');
};

