import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import {
    isActiveWordStatus,
    type WordEncounterAction,
} from '@/common/types/vocabulary';
import type {
    LearningSessionSummaryParams,
    LearningSessionSummaryVO,
    LearningSessionWordVO,
} from '@/common/types/learningSession';
import type {
    LearningDataExportVO,
    LearningDataResetResultVO,
} from '@/common/types/learningData';
import type { ReviewRetentionStats } from '@/common/types/review';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 会进入“本次学习”摘要的行动；seen/hover 只算曝光，不构成学习证据。 */
export const LEARNING_SESSION_ACTIONS = [
    'open',
    'save',
    'known',
    'ignore',
    'shadow',
    'dictation',
    'review',
] as const satisfies readonly WordEncounterAction[];

/**
 * 学习数据服务：会话摘要、可移植导出与学习记录清除。
 */
export default interface LearningDataService {
    /**
     * 查询某个播放会话中遇到的目标词、已掌握词与待复习词。
     */
    getSessionSummary(params: LearningSessionSummaryParams): Promise<LearningSessionSummaryVO>;

    /**
     * 构造可移植的学习数据快照。
     */
    buildExport(): Promise<LearningDataExportVO>;

    /**
     * 把学习数据写入指定 JSON 文件。
     *
     * @param filePath 目标文件绝对路径。
     * @returns 写入字节数。
     */
    exportToJson(filePath: string): Promise<{ bytes: number }>;

    /**
     * 删除学习事件与复习卡，并重置掌握字段；保留词表与用户状态。
     */
    resetLearningData(): Promise<LearningDataResetResultVO>;
}

/**
 * 学习数据服务实现。
 */
@injectable()
export class LearningDataServiceImpl implements LearningDataService {
    constructor(
        @inject(TYPES.LearningDataRepository) private readonly repository: LearningDataRepository,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    public async getSessionSummary(params: LearningSessionSummaryParams): Promise<LearningSessionSummaryVO> {
        const since = new Date(params.since);
        if (Number.isNaN(since.getTime())) {
            throw new Error('会话开始时间无效');
        }
        const limit = Math.max(1, Math.min(100, Math.trunc(params.limit ?? 30)));
        if (!params.videoId && !params.fileHash) {
            return this.emptySummary(since.toISOString());
        }

        const events = await this.repository.listSessionEvents({
            since: since.toISOString(),
            videoId: params.videoId,
            fileHash: params.fileHash,
            actions: LEARNING_SESSION_ACTIONS,
        });
        const lemmas = Array.from(new Set(events.map((event) => event.lemma.toLowerCase())));
        const [wordRows, cardRows] = await Promise.all([
            this.repository.findWordsByLemmas(lemmas),
            this.repository.findReviewCardsByWords(lemmas),
        ]);
        const wordMap = new Map(wordRows.map((word) => [word.word.toLowerCase(), word]));
        const cardMap = new Map(cardRows.map((card) => [card.word.toLowerCase(), card]));
        const now = Date.now();
        const entries = new Map<string, {
            word: Word;
            actions: Set<WordEncounterAction>;
            lastSeenAt: string;
        }>();

        for (const event of events) {
            const lemma = event.lemma.toLowerCase();
            const word = wordMap.get(lemma);
            if (!word || word.source === 'default' || word.status === 'ignored') {
                continue;
            }
            const entry = entries.get(lemma) ?? {
                word,
                actions: new Set<WordEncounterAction>(),
                lastSeenAt: event.created_at,
            };
            entry.actions.add(event.action);
            if (event.created_at > entry.lastSeenAt) {
                entry.lastSeenAt = event.created_at;
            }
            entries.set(lemma, entry);
        }

        const allWords = Array.from(entries.entries()).map(([lemma, entry]) => {
            const card = cardMap.get(lemma);
            const dueAt = card && isActiveWordStatus(entry.word.status) && Date.parse(card.due_at) <= now
                ? card.due_at
                : null;
            const word: LearningSessionWordVO = {
                word: entry.word.word,
                translate: entry.word.translate,
                status: entry.word.status,
                mastery: entry.word.mastery,
                confidence: entry.word.confidence,
                actions: Array.from(entry.actions),
                lastSeenAt: entry.lastSeenAt,
                dueAt,
            };
            return { word, cardDueAt: card?.due_at ?? null };
        });
        const visibleWords = allWords
            .slice()
            .sort((left, right) => right.word.lastSeenAt.localeCompare(left.word.lastSeenAt));
        const mastered = visibleWords
            .filter(({ word }) => word.status === 'known' && word.actions.includes('known'))
            .map(({ word }) => word);
        const due = visibleWords
            .filter(({ word }) => word.dueAt !== null)
            .map(({ word }) => word)
            .sort((left, right) => (left.dueAt ?? '').localeCompare(right.dueAt ?? ''));
        const nextDueAt = allWords
            .map(({ cardDueAt }) => cardDueAt)
            .filter((dueAt): dueAt is string => dueAt !== null)
            .sort((left, right) => left.localeCompare(right))[0] ?? null;

        return {
            since: since.toISOString(),
            counts: {
                encountered: allWords.length,
                mastered: mastered.length,
                due: due.length,
                practice: events.filter((event) =>
                    event.action === 'shadow' || event.action === 'dictation',
                ).length,
            },
            words: visibleWords.slice(0, limit).map(({ word }) => word),
            mastered: mastered.slice(0, 12),
            due: due.slice(0, 12),
            nextDueAt,
        };
    }

    public async buildExport(): Promise<LearningDataExportVO> {
        const now = new Date();
        const [words, encounters, reviewCards, last7Days, last30Days] = await Promise.all([
            this.repository.listUserWords(),
            this.repository.listEncounters(),
            this.repository.listReviewCards(),
            this.getRetentionSince(new Date(now.getTime() - 7 * DAY_MS).toISOString()),
            this.getRetentionSince(new Date(now.getTime() - 30 * DAY_MS).toISOString()),
        ]);
        return {
            schemaVersion: 1,
            exportedAt: now.toISOString(),
            words: words.map((word) => ({
                word: word.word,
                translate: word.translate,
                status: word.status,
                source: word.source,
                mastery: word.mastery,
                confidence: word.confidence,
                lastSeenAt: word.last_seen_at,
                masteredAt: word.mastered_at,
                createdAt: word.created_at,
                updatedAt: word.updated_at,
            })),
            encounters: encounters.map((encounter) => ({
                id: encounter.id,
                word: encounter.word,
                lemma: encounter.lemma,
                action: encounter.action,
                videoId: encounter.video_id,
                fileHash: encounter.file_hash,
                sentenceIndex: encounter.sentence_index,
                sentenceHash: encounter.sentence_hash,
                context: encounter.context,
                score: encounter.score,
                rating: encounter.rating,
                createdAt: encounter.created_at,
            })),
            reviewCards: reviewCards.map((card) => ({
                word: card.word,
                dueAt: card.due_at,
                state: card.state,
                reps: card.reps,
                lapses: card.lapses,
                stability: card.stability,
                difficulty: card.difficulty,
                lastReviewAt: card.last_review_at,
                lastRating: card.last_rating,
                createdAt: card.created_at,
                updatedAt: card.updated_at,
            })),
            retention: { last7Days, last30Days },
        };
    }

    public async exportToJson(filePath: string): Promise<{ bytes: number }> {
        const content = JSON.stringify(await this.buildExport(), null, 2);
        await this.fileSystemGateway.writeTextFile(filePath, content);
        return { bytes: Buffer.byteLength(content, 'utf8') };
    }

    public async resetLearningData(): Promise<LearningDataResetResultVO> {
        return this.repository.resetLearningData();
    }

    private async getRetentionSince(since: string): Promise<ReviewRetentionStats> {
        const outcomes = await this.repository.listReviewOutcomesSince(since);
        if (outcomes.length === 0) {
            return { reviewed: 0, retention: null };
        }
        const successful = outcomes.filter((outcome) =>
            outcome.rating === 'good' || outcome.rating === 'easy',
        ).length;
        return { reviewed: outcomes.length, retention: successful / outcomes.length };
    }

    private emptySummary(since: string): LearningSessionSummaryVO {
        return {
            since,
            counts: { encountered: 0, mastered: 0, due: 0, practice: 0 },
            words: [],
            mastered: [],
            due: [],
            nextDueAt: null,
        };
    }
}
