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
import type WordEncounterService from '@/backend/services/WordEncounterService';

import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type ProductionPracticeRecordRepository from '@/backend/services/repositories/ProductionPracticeRecordRepository';
import type RolePlayTurnRepository from '@/backend/services/repositories/RolePlayTurnRepository';
import type SentencePracticeService from '@/backend/services/SentencePracticeService';
import { isContentLemma } from '@/common/learning/contentWords';
import { parseMaybeJson } from '@/common/utils/ai/parseMaybeJson';
import type {
    LearningRecapExpressionVO,
    LearningRecapParams,
    LearningRecapRolePlayVO,
    LearningRecapVO,
    LearningRecapWordVO,
    ProductionPracticeListParams,
    ProductionPracticeRecordVO,
    RetellEvaluationParams,
    RetellEvaluationVO,
    RetellLevel,
    RolePlayFeedbackParams,
    RolePlayFeedbackVO,
    RolePlaySessionParams,
    RolePlaySessionVO,
    RolePlayTurnParams,
    RolePlayTurnResultVO,
    RolePlayTurnVO,
    SpokenRetellParams,
    SpokenRetellVO,
} from '@/common/types/learningRecap';
import type {
    LearningSessionSummaryVO,
    LearningSessionWordVO,
} from '@/common/types/learningSession';

/**
 * 产出型练习等级到练习分数的映射。
 *
 * 与跟读共用 0–100 的练习证据口径：`retry` 也给少量分，因为「敢说出来
 * 但还不准」确实是练习，只是证据强度低，不能和 `great` 等价。
 */
const PRODUCTION_LEVEL_SCORE: Record<RetellLevel, number> = {
    great: 90,
    good: 72,
    retry: 45,
};

/** 提示词或输出契约变化时递增，使旧缓存自然失效。 */
const PROMPT_VERSION = 'learning-recap-v2';
const RECAP_CACHE_TTL_MS = 60 * 60 * 1000;
const RETELL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ROLE_PLAY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOUD_TIMEOUT_MS = 30_000;
const LOCAL_TIMEOUT_MS = 60_000;
const MAX_CONTEXTS = 6;
const MAX_RECAP_WORDS = 3;
const MAX_CONTEXT_CHARS = 400;
const MAX_RESPONSE_CHARS = 2_000;
const MAX_EXPRESSION_WORDS = 6;
const MAX_ROLE_PLAY_SCENARIO_CHARS = 500;
const MAX_ROLE_PLAY_OPENING_CHARS = 1_000;
const MAX_ROLE_PLAY_EXPRESSIONS = 3;

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
    rolePlay: z.object({
        scenario: z.string().max(MAX_ROLE_PLAY_SCENARIO_CHARS).optional(),
        openingLine: z.string().min(1).max(MAX_CONTEXT_CHARS),
        prompt: z.string().max(200).optional(),
        targetExpressions: z.array(z.object({
            text: z.string().min(1).max(120),
            meaning: z.string().min(1).max(160),
        })).max(MAX_ROLE_PLAY_EXPRESSIONS).optional(),
    }).optional(),
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
 * AI 场景回应点评的结构化输出契约。
 */
const rolePlayFeedbackSchema = z.object({
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

    /**
     * 检查用户的口头复述。
     *
     * 先用本地 ASR 转写录音，再复用书面复述的评分与掌握度链路；
     * 转写文本会一并返回，让用户看到系统实际听到了什么。
     */
    evaluateSpokenRetell(params: SpokenRetellParams): Promise<SpokenRetellVO>;

    /**
     * 检查用户对场景开场白的书面回应。
     *
     * 目标表达使用情况始终由本地逐字匹配；AI 只补充点评与更自然的回应。
     */
    evaluateRolePlay(params: RolePlayFeedbackParams): Promise<RolePlayFeedbackVO>;

    /**
     * 检查多轮场景对话中的一轮，并把该轮写入会话。
     *
     * 点评口径与单轮一致；轮次落库后重开弹窗可原样恢复对话。
     */
    evaluateRolePlayTurn(params: RolePlayTurnParams): Promise<RolePlayTurnResultVO>;

    /**
     * 读取某个会话已经发生的轮次。
     */
    listRolePlayTurns(params: RolePlaySessionParams): Promise<RolePlaySessionVO>;

    /**
     * 读取某个视频下最近的复述 / 角色扮演结果，供复盘弹窗展示。
     */
    listProductionPractice(params: ProductionPracticeListParams): Promise<ProductionPracticeRecordVO[]>;
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
    private readonly rolePlayInFlight = new Map<string, Promise<RolePlayFeedbackVO>>();

    constructor(
        @inject(TYPES.LearningDataService) private readonly learningDataService: LearningDataService,
        @inject(TYPES.LearningDataRepository) private readonly learningDataRepository: LearningDataRepository,
        @inject(TYPES.AiProviderService) private readonly aiProviderService: AiProviderService,
        @inject(TYPES.LocalAiService) private readonly localAiService: LocalAiService,
        @inject(TYPES.CacheService) private readonly cacheService: CacheService,
        @inject(TYPES.ProductionPracticeRecordRepository)
        private readonly productionPracticeRepository: ProductionPracticeRecordRepository,
        @inject(TYPES.RolePlayTurnRepository)
        private readonly rolePlayTurnRepository: RolePlayTurnRepository,
        @inject(TYPES.SentencePracticeService)
        private readonly sentencePracticeService: SentencePracticeService,
        @inject(TYPES.WordEncounterService) private readonly wordEncounterService: WordEncounterService,
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
            await this.recordRetellAttempt(params, original, response, localResult);
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
                const result = { ...cached, cached: true };
                await this.recordRetellAttempt(params, original, response, result);
                return result;
            }
        }

        const existing = this.retellInFlight.get(cacheKey);
        if (existing) {
            const result = await existing;
            await this.recordRetellAttempt(params, original, response, result);
            return result;
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
        const result = await task;
        await this.recordRetellAttempt(params, original, response, result);
        return result;
    }

    public async evaluateRolePlay(params: RolePlayFeedbackParams): Promise<RolePlayFeedbackVO> {
        const scenario = params.scenario?.trim().slice(0, MAX_ROLE_PLAY_SCENARIO_CHARS) ?? '';
        const openingLine = params.openingLine?.trim().slice(0, MAX_ROLE_PLAY_OPENING_CHARS) ?? '';
        const response = params.response?.trim().slice(0, MAX_RESPONSE_CHARS) ?? '';
        if (!openingLine) {
            throw new Error('场景开场白不能为空');
        }
        if (!response) {
            throw new Error('回应内容不能为空');
        }
        const targetExpressions = this.normalizeRolePlayExpressions(params.targetExpressions);

        const localResult = this.buildLocalRolePlay(response, targetExpressions);
        const cloudModel = this.resolveCloudModel();
        const localModelId = await this.resolveLocalModelId();
        if (!cloudModel && !localModelId) {
            await this.recordRolePlayAttempt(params, openingLine, response, localResult);
            return localResult;
        }

        const cacheKey = this.buildRolePlayCacheKey({
            params,
            scenario,
            openingLine,
            response,
            targetExpressions,
            cloudModelId: this.modelIdOf(cloudModel),
            localModelId: localModelId ?? '',
        });
        if (!params.forceRefresh) {
            const cached = this.cacheService.get('cache:role-play-feedback', cacheKey);
            if (cached) {
                const result = { ...cached, cached: true };
                await this.recordRolePlayAttempt(params, openingLine, response, result);
                return result;
            }
        }

        const existing = this.rolePlayInFlight.get(cacheKey);
        if (existing) {
            const result = await existing;
            await this.recordRolePlayAttempt(params, openingLine, response, result);
            return result;
        }

        const task = this.generateRolePlay({
            params,
            scenario,
            openingLine,
            response,
            targetExpressions,
            localResult,
            cacheKey,
            cloudModel,
            localModelId,
        }).finally(() => {
            this.rolePlayInFlight.delete(cacheKey);
        });
        this.rolePlayInFlight.set(cacheKey, task);
        const result = await task;
        await this.recordRolePlayAttempt(params, openingLine, response, result);
        return result;
    }

    public async listProductionPractice(params: ProductionPracticeListParams): Promise<ProductionPracticeRecordVO[]> {
        const records = await this.productionPracticeRepository.listRecentByLocation(params);
        return records.map((record) => ({
            id: record.id,
            mode: record.mode,
            level: record.level,
            sentenceText: record.sentence_text,
            responseText: record.response_text,
            feedback: record.feedback,
            improved: record.improved,
            createdAt: record.created_at,
        }));
    }

    public async evaluateSpokenRetell(params: SpokenRetellParams): Promise<SpokenRetellVO> {
        const original = params.original?.trim().slice(0, MAX_CONTEXT_CHARS) ?? '';
        if (!original) {
            throw new Error('原句不能为空');
        }
        if (!params.audio || params.audio.byteLength === 0) {
            throw new Error('录音内容为空');
        }

        // 转写失败直接抛出：没有转写就没有答案，用空字符串评分只会给一个假的 retry。
        const { transcript, rhythm } = await this.sentencePracticeService.transcribeOnce({
            audio: params.audio,
            referenceText: original,
            jobKey: `${params.videoId ?? params.fileHash ?? 'unknown'}:${params.sentenceIndex ?? 0}`,
            referenceDurationSec: params.referenceDurationSec,
        });
        if (!transcript) {
            throw new Error('没有识别到语音内容');
        }

        const evaluation = await this.evaluateRetell({
            original,
            response: transcript,
            locale: params.locale,
            videoId: params.videoId,
            fileHash: params.fileHash,
            sentenceIndex: params.sentenceIndex,
        });
        return { ...evaluation, transcript, rhythm };
    }

    public async evaluateRolePlayTurn(params: RolePlayTurnParams): Promise<RolePlayTurnResultVO> {
        const sessionKey = params.sessionKey?.trim().slice(0, 200) ?? '';
        const partnerLine = params.partnerLine?.trim().slice(0, MAX_ROLE_PLAY_OPENING_CHARS) ?? '';
        if (!sessionKey) {
            throw new Error('会话键不能为空');
        }
        if (!partnerLine) {
            throw new Error('对方台词不能为空');
        }

        // 复用单轮点评的完整链路：本地表达匹配、云端/本地模型、缓存与降级都不另起一套。
        const feedback = await this.evaluateRolePlay({
            scenario: params.scenario,
            openingLine: partnerLine,
            response: params.response,
            targetExpressions: params.targetExpressions,
            locale: params.locale,
            forceRefresh: params.forceRefresh,
            videoId: params.videoId,
            fileHash: params.fileHash,
        });

        const existing = await this.rolePlayTurnRepository.listBySession(sessionKey);
        // 同一句对方台词只占一个轮次：用户改稿重评时覆盖该轮，而不是无限追加。
        const sameLineTurn = existing.find((row) => row.partner_line === partnerLine);
        const turn = sameLineTurn?.turn ?? (existing.length > 0
            ? Math.max(...existing.map((row) => row.turn)) + 1
            : 1);

        try {
            await this.rolePlayTurnRepository.upsertTurn({
                session_key: sessionKey,
                turn,
                video_id: params.videoId ?? null,
                file_hash: params.fileHash ?? null,
                partner_line: partnerLine,
                partner_index: params.partnerIndex ?? null,
                response_text: params.response.trim().slice(0, MAX_RESPONSE_CHARS),
                level: feedback.level,
                feedback: feedback.feedback || null,
                improved: feedback.improved || null,
                used_expressions_json: JSON.stringify(feedback.usedExpressions),
                source: feedback.source,
            });
        } catch (error) {
            // 轮次落库失败不影响用户拿到点评，只损失「重开弹窗恢复对话」。
            this.logger.warn('failed to persist role play turn', { error: this.errorMessage(error) });
        }

        return {
            ...feedback,
            turn,
            partnerIndex: params.partnerIndex ?? null,
        };
    }

    public async listRolePlayTurns(params: RolePlaySessionParams): Promise<RolePlaySessionVO> {
        const sessionKey = params.sessionKey?.trim().slice(0, 200) ?? '';
        if (!sessionKey) {
            return { sessionKey: '', turns: [] };
        }
        const rows = await this.rolePlayTurnRepository.listBySession(sessionKey);
        const turns: RolePlayTurnVO[] = rows.map((row) => ({
            turn: row.turn,
            partnerLine: row.partner_line,
            partnerIndex: row.partner_index,
            response: row.response_text,
            level: row.level,
            feedback: row.feedback ?? '',
            improved: row.improved ?? '',
            usedExpressions: this.parseStringArray(row.used_expressions_json),
            source: row.source === 'ai' ? 'ai' : 'local',
        }));
        return { sessionKey, turns };
    }

    /**
     * 记录一次复述尝试。
     *
     * 落库失败不影响用户拿到反馈，只写日志。
     */
    private async recordRetellAttempt(
        params: RetellEvaluationParams,
        original: string,
        response: string,
        result: RetellEvaluationVO,
    ): Promise<void> {
        try {
            await this.productionPracticeRepository.insertOne({
                mode: 'retell',
                video_id: params.videoId ?? null,
                file_hash: params.fileHash ?? null,
                sentence_index: params.sentenceIndex ?? null,
                sentence_text: original,
                response_text: response,
                level: result.level,
                feedback: result.feedback || null,
                improved: result.improved || null,
                detail_json: JSON.stringify({
                    coverage: result.coverage,
                    matchedKeywords: result.matchedKeywords,
                    totalKeywords: result.totalKeywords,
                    missingWords: result.missingWords,
                    source: result.source,
                }),
            });
            // 复述的证据是「用出来的原句关键词」，而不是整句逐词复现：
            // 复述本来就允许换说法，只有真正说到的词才算练习过。
            // matchedKeywords 只是数量，具体词由原句内容词减去 missingWords 得到。
            const missing = new Set(result.missingWords.map((word) => word.toLowerCase()));
            const matchedWords = analyzeWords(original)
                .filter((token) => token.type === 'word')
                .map((token) => token.lemma)
                .filter((lemma) => isContentLemma(lemma) && !missing.has(lemma.toLowerCase()));
            await this.recordProductionMastery({
                words: matchedWords,
                level: result.level,
                action: 'retell',
                videoId: params.videoId,
                fileHash: params.fileHash,
                sentenceIndex: params.sentenceIndex,
                context: original,
            });
        } catch (error) {
            this.logger.warn('failed to persist retell attempt', { error: this.errorMessage(error) });
        }
    }

    /**
     * 记录一次角色扮演尝试；落库失败同样不阻断反馈。
     */
    private async recordRolePlayAttempt(
        params: RolePlayFeedbackParams,
        openingLine: string,
        response: string,
        result: RolePlayFeedbackVO,
    ): Promise<void> {
        try {
            await this.productionPracticeRepository.insertOne({
                mode: 'roleplay',
                video_id: params.videoId ?? null,
                file_hash: params.fileHash ?? null,
                sentence_index: params.sentenceIndex ?? null,
                sentence_text: openingLine,
                response_text: response,
                level: result.level,
                feedback: result.feedback || null,
                improved: result.improved || null,
                detail_json: JSON.stringify({
                    usedExpressions: result.usedExpressions,
                    targetExpressions: params.targetExpressions ?? [],
                    source: result.source,
                }),
            });
            await this.recordProductionMastery({
                words: result.usedExpressions,
                level: result.level,
                action: 'roleplay',
                videoId: params.videoId,
                fileHash: params.fileHash,
                sentenceIndex: params.sentenceIndex,
                context: openingLine,
            });
        } catch (error) {
            this.logger.warn('failed to persist role play attempt', { error: this.errorMessage(error) });
        }
    }

    /**
     * 把产出型练习结果折算成掌握度证据。
     *
     * 只有用户真的用出来的目标表达才算证据；等级映射到 0–100 分，
     * 与跟读共用同一套练习证据路径，避免两套「算不算练过」的口径。
     */
    private async recordProductionMastery(params: {
        words: readonly string[];
        level: RetellLevel;
        action: 'retell' | 'roleplay';
        videoId?: string | null;
        fileHash?: string | null;
        sentenceIndex?: number | null;
        context?: string | null;
    }): Promise<void> {
        if (params.words.length === 0) {
            return;
        }
        await this.wordEncounterService.recordProductionEvidence({
            words: params.words,
            score: PRODUCTION_LEVEL_SCORE[params.level],
            action: params.action,
            videoId: params.videoId ?? null,
            fileHash: params.fileHash ?? null,
            sentenceIndex: params.sentenceIndex ?? null,
            context: params.context ?? null,
        });
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
        const rolePlay: LearningRecapRolePlayVO | null = sentence
            ? {
                scenario: '',
                openingLine: sentence.text,
                prompt: '',
                targetExpressions: [],
            }
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
            rolePlay,
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

        const rolePlay = this.groundRolePlay(raw.rolePlay, contexts, localRecap.rolePlay);

        return {
            since: localRecap.since,
            source,
            cached: false,
            headline: raw.headline.trim(),
            words,
            sentence,
            expression,
            speakingTask: raw.speakingTask.trim(),
            rolePlay,
            counts: summary.counts,
        };
    }

    /**
     * 校验 AI 场景回应：开场白必须是真实字幕句，目标表达必须逐字出现在开场白里。
     *
     * 越界时整段回退本地场景，不因一个可选练习阻断整份复盘。
     */
    private groundRolePlay(
        raw: z.infer<typeof recapSchema>['rolePlay'],
        contexts: RecapContext[],
        fallback: LearningRecapRolePlayVO | null | undefined,
    ): LearningRecapRolePlayVO | null {
        if (!raw) {
            return fallback ?? null;
        }
        const opening = raw.openingLine.trim().slice(0, MAX_ROLE_PLAY_OPENING_CHARS);
        const matched = contexts.find(
            (context) => this.normalizeForMatch(context.text) === this.normalizeForMatch(opening),
        );
        if (!matched) {
            return fallback ?? null;
        }

        const normalizedOpening = this.normalizeForMatch(matched.text);
        const used = new Set<string>();
        const targetExpressions: LearningRecapExpressionVO[] = [];
        for (const item of raw.targetExpressions ?? []) {
            if (targetExpressions.length >= MAX_ROLE_PLAY_EXPRESSIONS) {
                break;
            }
            const text = item.text.trim();
            const key = this.normalizeForMatch(text);
            if (!text || used.has(key)) {
                continue;
            }
            if (text.split(/\s+/u).length > MAX_EXPRESSION_WORDS) {
                continue;
            }
            if (!normalizedOpening.includes(key)) {
                continue;
            }
            used.add(key);
            targetExpressions.push({
                text,
                meaning: item.meaning.trim(),
            });
        }

        return {
            scenario: raw.scenario?.trim().slice(0, MAX_ROLE_PLAY_SCENARIO_CHARS) ?? '',
            openingLine: matched.text,
            prompt: raw.prompt?.trim().slice(0, 200) ?? '',
            targetExpressions,
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
     * 本地场景回应检查：以回应长度与目标表达使用为可解释信号，不做语义打分。
     */
    private buildLocalRolePlay(response: string, targetExpressions: string[]): RolePlayFeedbackVO {
        const normalizedResponse = this.normalizeForMatch(response);
        const usedExpressions = targetExpressions.filter(
            (expression) => normalizedResponse.includes(this.normalizeForMatch(expression)),
        );
        const wordCount = analyzeWords(response)
            .filter((token) => token.type === 'word')
            .length;
        let level: RetellLevel = 'retry';
        if (wordCount >= 8 && (targetExpressions.length === 0 || usedExpressions.length > 0)) {
            level = 'great';
        } else if (wordCount >= 3) {
            level = 'good';
        }
        return {
            level,
            feedback: '',
            improved: '',
            usedExpressions,
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
     * 依次尝试云端与本地模型；两者都失败时保留本地长度/表达信号。
     */
    private async generateRolePlay(args: {
        params: RolePlayFeedbackParams;
        scenario: string;
        openingLine: string;
        response: string;
        targetExpressions: string[];
        localResult: RolePlayFeedbackVO;
        cacheKey: string;
        cloudModel: LanguageModel | null;
        localModelId: string | null;
    }): Promise<RolePlayFeedbackVO> {
        const prompt = buildRolePlayFeedbackPrompt({
            scenario: args.scenario,
            openingLine: args.openingLine,
            response: args.response,
            targetExpressions: args.targetExpressions,
            usedExpressions: args.localResult.usedExpressions,
            locale: this.resolveLocale(args.params.locale),
        });

        if (args.cloudModel) {
            try {
                const result = await concurrency.withRateLimit('gpt', () => generateObject({
                    model: args.cloudModel!,
                    schema: rolePlayFeedbackSchema,
                    prompt,
                    maxRetries: 0,
                    abortSignal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
                }));
                return this.finishRolePlay(result.object, args.localResult, args.cacheKey, 'ai', args.response);
            } catch (error) {
                this.logger.warn('role play feedback cloud failed, trying local model', {
                    error: this.errorMessage(error),
                });
            }
        }

        if (args.localModelId) {
            try {
                const output = await this.localAiService.generate(
                    prompt,
                    z.toJSONSchema(rolePlayFeedbackSchema),
                    args.localModelId,
                    AbortSignal.timeout(LOCAL_TIMEOUT_MS),
                );
                const parsed = rolePlayFeedbackSchema.safeParse(parseMaybeJson(output));
                if (!parsed.success) {
                    this.logger.error('role play feedback local output invalid', {
                        issues: parsed.error.issues,
                        rawText: JSON.stringify(output)?.slice(0, 500),
                    });
                    throw new Error('本地模型场景回应输出不符合契约');
                }
                return this.finishRolePlay(parsed.data, args.localResult, args.cacheKey, 'local', args.response);
            } catch (error) {
                this.logger.error('role play feedback local model failed', {
                    error: this.errorMessage(error),
                });
            }
        }

        return args.localResult;
    }

    /**
     * 归一化 AI 场景点评并合并本地表达使用信号。
     */
    private finishRolePlay(
        raw: z.infer<typeof rolePlayFeedbackSchema>,
        localResult: RolePlayFeedbackVO,
        cacheKey: string,
        source: 'ai' | 'local',
        response: string,
    ): RolePlayFeedbackVO {
        const feedback = raw.feedback.trim();
        if (!feedback) {
            throw new Error('模型未返回有效的场景回应点评');
        }
        const improved = raw.improved?.trim().slice(0, 300) ?? '';
        const normalizedImproved = improved
            && this.normalizeForMatch(improved) !== this.normalizeForMatch(response)
            ? improved
            : '';
        const result: RolePlayFeedbackVO = {
            level: raw.level,
            feedback,
            improved: normalizedImproved,
            usedExpressions: localResult.usedExpressions,
            source,
            cached: false,
        };
        this.cacheService.set('cache:role-play-feedback', cacheKey, result, ROLE_PLAY_CACHE_TTL_MS);
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
     * 场景回应缓存键：场景、开场白、回应、目标表达、语言与模型任一变化都重新检查。
     */
    private buildRolePlayCacheKey(args: {
        params: RolePlayFeedbackParams;
        scenario: string;
        openingLine: string;
        response: string;
        targetExpressions: string[];
        cloudModelId: string;
        localModelId: string;
    }): string {
        return ObjUtil.hash({
            mode: 'role-play-feedback',
            version: PROMPT_VERSION,
            scenario: args.scenario,
            openingLine: this.normalizeForMatch(args.openingLine),
            response: args.response.trim(),
            targetExpressions: args.targetExpressions,
            locale: this.resolveLocale(args.params.locale),
            cloudModelId: args.cloudModelId,
            localModelId: args.localModelId,
        });
    }

    /**
     * 归一化目标表达：去空、去重、限制数量，并保留用户可读写法。
     */
    private normalizeRolePlayExpressions(expressions: string[] | undefined): string[] {
        const result: string[] = [];
        const seen = new Set<string>();
        for (const expression of expressions ?? []) {
            const text = expression.trim();
            if (!text) {
                continue;
            }
            const key = this.normalizeForMatch(text);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push(text);
            if (result.length >= MAX_ROLE_PLAY_EXPRESSIONS) {
                break;
            }
        }
        return result;
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
     * 读取以 JSON 数组落库的字符串列表。
     *
     * 坏数据只丢这一项，不抛出：历史记录损坏不应让整个会话无法恢复。
     */
    private parseStringArray(value: string | null): string[] {
        if (!value) {
            return [];
        }
        const parsed = parseMaybeJson(value);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
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
        '{"headline":"one warm sentence about this session","words":[{"word":"exact word from the list","note":"one concrete memory hook"}],"sentence":{"text":"exact sentence copied from the list","note":"why this sentence is worth remembering"},"expression":{"text":"2-4 word expression appearing verbatim in a sentence","meaning":"short meaning"},"speakingTask":"one 20-60 second speaking task","rolePlay":{"scenario":"one short real-life situation inspired by the sentence","openingLine":"exact sentence copied from the list","prompt":"what the learner should reply, in one sentence","targetExpressions":[{"text":"2-4 word expression appearing verbatim in openingLine","meaning":"short meaning"}]}}',
        '',
        'Rules:',
        '1. Use 2-3 words, only from the target word list. Never invent a word.',
        '2. sentence.text must be copied exactly from the provided sentences.',
        '3. expression must appear verbatim in one of the provided sentences; omit the field when none is useful.',
        '4. rolePlay.openingLine must be copied exactly from the provided sentences. rolePlay.targetExpressions must appear verbatim in that line; use at most 3.',
        '5. Keep headline, notes, speakingTask, rolePlay.scenario and rolePlay.prompt short and concrete. No emoji, no grammar lectures.',
        '6. Output valid JSON only, without markdown fences.',
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

/**
 * 构建场景回应点评提示词。
 *
 * @param input 场景、开场白、用户回应、目标表达、本地已用表达与输出语言。
 * @returns 完整提示词。
 */
export const buildRolePlayFeedbackPrompt = (input: {
    scenario: string;
    openingLine: string;
    response: string;
    targetExpressions: string[];
    usedExpressions: string[];
    locale: 'zh-CN' | 'en-US';
}): string => {
    const language = input.locale === 'en-US' ? 'English' : 'Simplified Chinese';
    return [
        'You are a friendly English conversation partner giving written feedback on one role-play reply.',
        `Write feedback in ${language}.`,
        '',
        `Situation: ${input.scenario || '(a real-life situation from the video)'}`,
        `The other person says: "${input.openingLine}"`,
        `Learner's reply: "${input.response}"`,
        `Expressions we hoped to see: ${input.targetExpressions.join(', ') || 'none'}`,
        `Expressions the learner actually used: ${input.usedExpressions.join(', ') || 'none'}`,
        '',
        'Stay inside the role-play situation. Judge whether the reply works as a natural spoken response. Do not interrupt the conversation for small grammar slips unless they block understanding.',
        '',
        'Return JSON:',
        '{"level":"great|good|retry","feedback":"one or two specific, encouraging sentences","improved":"a natural spoken reply, 1-3 sentences"}',
        '',
        'Rules:',
        '1. great = natural, on-topic and easy to continue; good = understandable but one thing weakens it; retry = off-topic, too vague, or does not respond to the opening line.',
        '2. improved must be a natural spoken reply, not a copy of the learner\'s reply.',
        '3. Output valid JSON only, without markdown fences.',
    ].join('\n');
};

