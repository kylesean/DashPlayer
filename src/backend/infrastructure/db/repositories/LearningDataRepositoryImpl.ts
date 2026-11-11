import { and, asc, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import { reviewCard, type ReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import { wordEncounter, type WordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { words, type Word } from '@/backend/infrastructure/db/tables/words';
import TYPES from '@/backend/ioc/types';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type {
    LearningDataResetCounts,
    SessionEventQuery,
} from '@/backend/services/repositories/LearningDataRepository';
import type { ReviewOutcome } from '@/backend/services/repositories/WordEncounterRepository';

/**
 * 学习数据 SQLite 仓储。
 */
@injectable()
export default class LearningDataRepositoryImpl implements LearningDataRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async listUserWords(): Promise<Word[]> {
        return this.db
            .select()
            .from(words)
            .where(ne(words.source, 'default'))
            .orderBy(asc(words.word));
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
        return this.db
            .select()
            .from(words)
            .where(inArray(sql`lower(${words.word})`, lemmas.map((lemma) => lemma.toLowerCase())));
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

    public async resetLearningData(): Promise<LearningDataResetCounts> {
        const now = new Date().toISOString();
        return this.db.transaction((tx) => {
            const encounters = tx.delete(wordEncounter).run();
            const cards = tx.delete(reviewCard).run();
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
                wordsReset: Number(updatedWords.changes),
            };
        });
    }
}
