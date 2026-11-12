import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import {
    applyMasteryEvidence,
    type MasteryEvidence,
    type MasterySnapshot,
    type MasteryUpdate,
} from '@/common/learning/mastery';
import {
    createNewReviewSchedule,
    reviewRatingFromPracticeScore,
    scheduleReview,
} from '@/common/learning/reviewScheduler';
import type { ReviewCard, InsertReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import type { EncounterContextRow } from '@/backend/services/repositories/WordEncounterRepository';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import { lemmatizeWord } from '@/backend/utils/language/VocabularyMatcher';
import type {
    ReviewCardContextVO,
    ReviewCardVO,
    ReviewQueueVO,
    ReviewRateParams,
    ReviewRateResultVO,
    ReviewRetentionStats,
    ReviewSchedule,
} from '@/common/types/review';
import {
    isActiveWordStatus,
    type WordEncounterInput,
    type WordStatus,
} from '@/common/types/vocabulary';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 记录用户在播放器里与单词的真实遭遇。
 *
 * R1 起，事件不再只是日志：学习动作会更新透明掌握度，并驱动复习卡调度。
 */
export default interface WordEncounterService {
    record(params: WordEncounterInput): Promise<void>;

    /**
     * 获取当前到期复习队列与 7/30 天回忆统计。
     */
    getReviewQueue(limit?: number): Promise<ReviewQueueVO>;

    /**
     * 提交一次复习反馈，并同步更新词条状态与下一次复习时间。
     */
    rateReview(params: ReviewRateParams): Promise<ReviewRateResultVO>;

    /**
     * 记录一次产出型练习（复述 / 角色扮演）对目标词的证据。
     *
     * 产出型练习衡量的是「能不能用出来」，比跟读更难，因此只在用户真的
     * 用到了目标表达时才算证据；没用到的词不扣分，也不假装练过。
     */
    recordProductionEvidence(params: {
        words: readonly string[];
        score: number;
        action: 'retell' | 'roleplay';
        videoId?: string | null;
        fileHash?: string | null;
        sentenceIndex?: number | null;
        context?: string | null;
    }): Promise<void>;
}

@injectable()
export class WordEncounterServiceImpl implements WordEncounterService {
    constructor(
        @inject(TYPES.WordEncounterRepository) private readonly repository: WordEncounterRepository,
        @inject(TYPES.WordsRepository) private readonly wordsRepository: WordsRepository,
        @inject(TYPES.ReviewCardRepository) private readonly reviewCardRepository: ReviewCardRepository,
    ) {}

    public async record(params: WordEncounterInput): Promise<void> {
        const word = params.word?.trim() ?? '';
        if (!word) {
            return;
        }
        const lemma = lemmatizeWord(word);
        if (!lemma) {
            return;
        }

        await this.repository.record({
            word,
            lemma,
            action: params.action,
            video_id: params.videoId ?? null,
            file_hash: params.fileHash ?? null,
            sentence_index: params.sentenceIndex ?? null,
            sentence_hash: params.sentenceHash ?? null,
            context: params.context ?? null,
            score: this.normalizeScore(params.score),
            rating: params.rating ?? null,
        });

        const existing = await this.wordsRepository.findByWord(lemma);
        if (!existing) {
            return;
        }

        const now = new Date();
        const evidence = this.evidenceFor(params);
        const mastery: MasteryUpdate = evidence
            ? applyMasteryEvidence(this.masteryOf(existing), evidence)
            : this.masteryOf(existing);
        const nextStatus = this.resolveNextStatus(existing.status, mastery.suggestedStatus);
        // seen/hover/replay 只是曝光，不算学习证据（evidence 为 null）：掌握度不动，
        // 也不得刷新 last_seen_at——遗忘衰减完全由 last_seen_at 驱动，悬停/重播把
        // 时钟拨到当前会让 14 天半衰期对常查的词永不生效，掌握度虚高。
        // 纯曝光且无状态建议时整次 UPDATE 都可跳过，避免高频悬停造成写放大。
        if (evidence || nextStatus) {
            await this.wordsRepository.updateLearning(lemma, {
                mastery: mastery.mastery,
                confidence: mastery.confidence,
                status: nextStatus,
                ...(evidence ? { lastSeenAt: now.toISOString() } : {}),
            });
        }

        await this.updateReviewCard(lemma, nextStatus ?? existing.status, params, now);
    }

    public async getReviewQueue(limit = 12): Promise<ReviewQueueVO> {
        const now = new Date();
        const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
        const [dueCards, dueCount, nextDueAt, last7Days, last30Days] = await Promise.all([
            this.reviewCardRepository.listDue(now.toISOString(), safeLimit),
            this.reviewCardRepository.countDue(now.toISOString()),
            this.reviewCardRepository.nextDueAt(),
            this.getRetentionSince(new Date(now.getTime() - 7 * DAY_MS).toISOString()),
            this.getRetentionSince(new Date(now.getTime() - 30 * DAY_MS).toISOString()),
        ]);
        const contexts = await this.loadContexts(dueCards.map(({ card }) => card.word));

        return {
            items: dueCards.map(({ card, word }) => this.toReviewCardVO(card, word, contexts.get(card.word) ?? null)),
            dueCount,
            nextDueAt,
            stats: { last7Days, last30Days },
        };
    }

    public async rateReview(params: ReviewRateParams): Promise<ReviewRateResultVO> {
        const input = params.word?.trim() ?? '';
        if (!input) {
            throw new Error('单词不能为空');
        }
        const lemma = lemmatizeWord(input);
        const word = await this.wordsRepository.findByWord(lemma);
        if (!word) {
            throw new Error('词条不存在');
        }
        if (!isActiveWordStatus(word.status)) {
            throw new Error('该词当前不在复习队列');
        }

        const now = new Date();
        const existingCard = await this.reviewCardRepository.findByWord(lemma);
        const currentSchedule = existingCard
            ? this.scheduleFromCard(existingCard)
            : createNewReviewSchedule(now);
        const nextSchedule = scheduleReview(currentSchedule, params.rating, now);
        const mastery = applyMasteryEvidence(this.masteryOf(word), {
            kind: 'review',
            rating: params.rating,
        });
        const nextStatus = this.resolveNextStatus(word.status, mastery.suggestedStatus) ?? word.status;

        await this.reviewCardRepository.upsert(this.toInsertCard(lemma, nextSchedule));
        await this.wordsRepository.updateLearning(lemma, {
            mastery: mastery.mastery,
            confidence: mastery.confidence,
            status: nextStatus,
            lastSeenAt: now.toISOString(),
        });
        await this.repository.record({
            word: word.word,
            lemma,
            action: 'review',
            video_id: params.videoId ?? null,
            file_hash: params.fileHash ?? null,
            sentence_index: null,
            sentence_hash: null,
            context: null,
            score: null,
            rating: params.rating,
        });

        const nextWord = { ...word, status: nextStatus, mastery: mastery.mastery, confidence: mastery.confidence };
        const nextCard = {
            ...(existingCard ?? {}),
            id: existingCard?.id ?? 0,
            word: lemma,
            due_at: nextSchedule.dueAt,
            state: nextSchedule.state,
            reps: nextSchedule.reps,
            lapses: nextSchedule.lapses,
            stability: nextSchedule.stability,
            difficulty: nextSchedule.difficulty,
            last_review_at: nextSchedule.lastReviewAt,
            last_rating: nextSchedule.lastRating,
        } as ReviewCard;
        const contexts = await this.loadContexts([lemma]);
        return {
            card: this.toReviewCardVO(nextCard, nextWord, contexts.get(lemma) ?? null),
            status: nextStatus,
        };
    }

    private masteryOf(word: Word): MasterySnapshot {
        return { mastery: word.mastery, confidence: word.confidence };
    }

    public async recordProductionEvidence(params: {
        words: readonly string[];
        score: number;
        action: 'retell' | 'roleplay';
        videoId?: string | null;
        fileHash?: string | null;
        sentenceIndex?: number | null;
        context?: string | null;
    }): Promise<void> {
        // 产出型练习的分数与掌握度证据契约一致，都是 0–100。
        const score = this.normalizeScore(params.score) ?? 0;
        const unique = Array.from(new Set(
            params.words.map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0),
        ));
        for (const lemma of unique) {
            // 只对已经在用户词表里的词更新掌握度：产出型练习不该把没学过的词
            // 静默加进个人词表，那会让词表变成「用户说过的一切」。
            const existing = await this.wordsRepository.findByWord(lemma);
            if (!existing || existing.source === 'default') {
                continue;
            }
            const mastery = applyMasteryEvidence(this.masteryOf(existing), {
                kind: 'practice',
                score,
            });
            const nextStatus = this.resolveNextStatus(existing.status, mastery.suggestedStatus);
            await this.wordsRepository.updateLearning(lemma, {
                mastery: mastery.mastery,
                confidence: mastery.confidence,
                status: nextStatus,
                lastSeenAt: new Date().toISOString(),
            });
            await this.repository.record({
                word: existing.word,
                lemma,
                action: params.action,
                video_id: params.videoId ?? null,
                file_hash: params.fileHash ?? null,
                sentence_index: params.sentenceIndex ?? null,
                sentence_hash: null,
                context: params.context ?? null,
                score: params.score,
                rating: null,
            });
        }
    }

    private evidenceFor(params: WordEncounterInput): MasteryEvidence | null {
        switch (params.action) {
            case 'open':
                return { kind: 'open' };
            case 'save':
                return { kind: 'save' };
            case 'shadow':
            case 'dictation':
            case 'retell':
            case 'roleplay':
                return params.score === undefined
                    ? { kind: 'practice', score: 0 }
                    : { kind: 'practice', score: this.normalizeScore(params.score) ?? 0 };
            case 'review':
                return params.rating ? { kind: 'review', rating: params.rating } : null;
            case 'known':
                return { kind: 'known' };
            case 'ignore':
                return { kind: 'ignore' };
            default:
                return null;
        }
    }

    private resolveNextStatus(current: WordStatus, suggested?: WordStatus): WordStatus | undefined {
        if (!suggested) {
            return undefined;
        }
        if (suggested === 'known' || suggested === 'ignored') {
            return suggested;
        }
        if (!isActiveWordStatus(current)) {
            return undefined;
        }
        return suggested;
    }

    private async updateReviewCard(
        lemma: string,
        status: WordStatus,
        params: WordEncounterInput,
        now: Date,
    ): Promise<void> {
        // 跟读与产出型练习只提供练习反馈与 mastery 证据，不参与复习调度：
        // 口音或表达差异导致的低分不应把词推进复习队列，也不应提前/推迟 due。
        if (params.action === 'shadow' || params.action === 'retell' || params.action === 'roleplay') {
            return;
        }
        if (status === 'known' || status === 'ignored') {
            await this.reviewCardRepository.deleteByWord(lemma);
            return;
        }
        const existingCard = await this.reviewCardRepository.findByWord(lemma);
        const shouldTouchCard = ['save', 'dictation', 'review'].includes(params.action);
        if (!existingCard && !shouldTouchCard) {
            return;
        }

        const current = existingCard
            ? this.scheduleFromCard(existingCard)
            : createNewReviewSchedule(now);
        const next = params.action === 'dictation'
            ? scheduleReview(current, reviewRatingFromPracticeScore(params.score ?? 0), now)
            : params.action === 'review' && params.rating
                ? scheduleReview(current, params.rating, now)
                : current;
        await this.reviewCardRepository.upsert(this.toInsertCard(lemma, next));
    }

    private async getRetentionSince(since: string): Promise<ReviewRetentionStats> {
        const outcomes = await this.repository.listReviewOutcomesSince(since);
        const reviewed = outcomes.length;
        if (reviewed === 0) {
            return { reviewed: 0, retention: null };
        }
        const successful = outcomes.filter((outcome) =>
            outcome.rating === 'good' || outcome.rating === 'easy',
        ).length;
        return { reviewed, retention: successful / reviewed };
    }

    private normalizeScore(score?: number): number | null {
        if (score === undefined || Number.isNaN(score)) {
            return null;
        }
        return Math.max(0, Math.min(100, score));
    }

    private scheduleFromCard(card: ReviewCard): ReviewSchedule {
        return {
            dueAt: card.due_at,
            state: card.state,
            reps: card.reps,
            lapses: card.lapses,
            stability: card.stability,
            difficulty: card.difficulty,
            lastReviewAt: card.last_review_at,
            lastRating: card.last_rating,
        };
    }

    private toInsertCard(word: string, schedule: ReviewSchedule): InsertReviewCard {
        return {
            word: word.toLowerCase(),
            due_at: schedule.dueAt,
            state: schedule.state,
            reps: schedule.reps,
            lapses: schedule.lapses,
            stability: schedule.stability,
            difficulty: schedule.difficulty,
            last_review_at: schedule.lastReviewAt,
            last_rating: schedule.lastRating,
        };
    }

    private toReviewCardVO(card: ReviewCard, word: Word, context: ReviewCardContextVO | null): ReviewCardVO {
        return {
            id: card.id,
            word: word.word,
            translate: word.translate,
            status: word.status,
            mastery: word.mastery,
            confidence: word.confidence,
            schedule: this.scheduleFromCard(card),
            context,
        };
    }

    /**
     * 批量读取每个词最近一次带字幕原句的遭遇，供复习卡还原语境。
     */
    private async loadContexts(lemmas: string[]): Promise<Map<string, ReviewCardContextVO>> {
        const rows = await this.repository.findLatestContexts(lemmas);
        return new Map(rows.map((row) => [row.lemma, this.toReviewContext(row)]));
    }

    private toReviewContext(row: EncounterContextRow): ReviewCardContextVO {
        return {
            text: row.text,
            videoId: row.videoId,
            videoFileName: row.videoFileName,
            sentenceIndex: row.sentenceIndex,
            sentenceHash: row.sentenceHash,
            lastSeenAt: row.createdAt,
        };
    }
}
