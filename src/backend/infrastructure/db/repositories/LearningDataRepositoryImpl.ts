import { and, asc, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    recommendationEvent,
    type InsertRecommendationEvent,
    type RecommendationEvent,
} from '@/backend/infrastructure/db/tables/recommendationEvent';
import { productionPracticeRecord } from '@/backend/infrastructure/db/tables/productionPracticeRecord';
import { reviewCard, type ReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import { sentencePracticeRecord } from '@/backend/infrastructure/db/tables/sentencePracticeRecord';
import { wordEncounter, type WordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { words, type Word } from '@/backend/infrastructure/db/tables/words';
import TYPES from '@/backend/ioc/types';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type {
    LearningDataResetCounts,
    SessionEventQuery,
} from '@/backend/services/repositories/LearningDataRepository';
import type { ReviewOutcome } from '@/backend/services/repositories/WordEncounterRepository';
import { effectiveWordMastery } from '@/common/learning/mastery';

/**
 * 学习数据 SQLite 仓储。
 */
@injectable()
export default class LearningDataRepositoryImpl implements LearningDataRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async listUserWords(): Promise<Word[]> {
        const rows = await this.db
            .select()
            .from(words)
            .where(ne(words.source, 'default'))
            .orderBy(asc(words.word));
        return rows.map((row) => ({ ...row, mastery: effectiveWordMastery(row) }));
    }

    public async listEncounters(): Promise<WordEncounter[]> {
        return this.db
            .select()
            .from(wordEncounter)
            .orderBy(asc(wordEncounter.id));
    }

    public async listReviewCards(): Promise<ReviewCard[]> {
        return this.db
            .select()
            .from(reviewCard)
            .orderBy(asc(reviewCard.word));
    }

    public async listSessionEvents(query: SessionEventQuery): Promise<WordEncounter[]> {
        if (!query.videoId && !query.fileHash) {
            return [];
        }
        return this.db
            .select()
            .from(wordEncounter)
            .where(and(
                gte(wordEncounter.created_at, query.since),
                inArray(wordEncounter.action, [...query.actions]),
                or(
                    query.videoId ? eq(wordEncounter.video_id, query.videoId) : undefined,
                    query.fileHash ? eq(wordEncounter.file_hash, query.fileHash) : undefined,
                ),
            ))
            .orderBy(asc(wordEncounter.id))
            .limit(query.limit ?? 2000);
    }

    public async findWordsByLemmas(lemmas: string[]): Promise<Word[]> {
        if (lemmas.length === 0) {
            return [];
        }
        const rows = await this.db
            .select()
            .from(words)
            .where(inArray(sql`lower(${words.word})`, lemmas.map((lemma) => lemma.toLowerCase())));
        return rows.map((row) => ({ ...row, mastery: effectiveWordMastery(row) }));
    }

    public async findReviewCardsByWords(wordsToFind: string[]): Promise<ReviewCard[]> {
        if (wordsToFind.length === 0) {
            return [];
        }
        return this.db
            .select()
            .from(reviewCard)
            .where(inArray(reviewCard.word, wordsToFind.map((word) => word.toLowerCase())));
    }

    public async listReviewOutcomesSince(since: string): Promise<ReviewOutcome[]> {
        return this.db
            .select({
                rating: wordEncounter.rating,
                score: wordEncounter.score,
            })
            .from(wordEncounter)
            .where(and(
                eq(wordEncounter.action, 'review'),
                gte(wordEncounter.created_at, since),
            ));
    }

    public async insertRecommendationEvent(value: InsertRecommendationEvent): Promise<void> {
        await this.db.insert(recommendationEvent).values(value);
    }

    public async listRecommendationEventsSince(
        since: string,
        limit = 5000,
    ): Promise<RecommendationEvent[]> {
        return this.db
            .select()
            .from(recommendationEvent)
            .where(gte(recommendationEvent.created_at, since))
            .orderBy(asc(recommendationEvent.id))
            .limit(limit);
    }

    public async listRecommendationEvents(): Promise<RecommendationEvent[]> {
        return this.db
            .select()
            .from(recommendationEvent)
            .orderBy(asc(recommendationEvent.id));
    }

    public async resetLearningData(): Promise<LearningDataResetCounts> {
        const now = new Date().toISOString();
        return this.db.transaction((tx) => {
            const encounters = tx.delete(wordEncounter).run();
            const cards = tx.delete(reviewCard).run();
            const recommendations = tx.delete(recommendationEvent).run();
            // 句子练习（跟读/听写）与产出型练习（复述/角色扮演）都属于用户学习记录，
            // 清除学习数据时必须一并删除，否则会残留按视频定位的历史成绩。
            tx.delete(sentencePracticeRecord).run();
            tx.delete(productionPracticeRecord).run();
            const updatedWords = tx.update(words).set({
                mastery: 0,
                confidence: 0,
                last_seen_at: null,
                mastered_at: null,
                updated_at: now,
            }).run();
            return {
                encountersDeleted: Number(encounters.changes),
                reviewCardsDeleted: Number(cards.changes),
                recommendationsDeleted: Number(recommendations.changes),
                wordsReset: Number(updatedWords.changes),
            };
        });
    }
}
