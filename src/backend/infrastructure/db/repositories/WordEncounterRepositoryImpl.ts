import { and, eq, gte, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    wordEncounter,
    type InsertWordEncounter,
} from '@/backend/infrastructure/db/tables/wordEncounter';
import TYPES from '@/backend/ioc/types';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import type {
    EncounterActionRow,
    ReviewOutcome,
} from '@/backend/services/repositories/WordEncounterRepository';
import type { WordEncounterAction } from '@/common/types/vocabulary';

/**
 * 单词遭遇事件 SQLite 仓储。
 */
@injectable()
export default class WordEncounterRepositoryImpl implements WordEncounterRepository {
    /**
     * @param db 数据库实例。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async record(value: InsertWordEncounter): Promise<void> {
        this.db.insert(wordEncounter).values({
            ...value,
            created_at: value.created_at ?? new Date().toISOString(),
        }).run();
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

    public async listActionsSince(
        since: string,
        actions: readonly WordEncounterAction[],
    ): Promise<EncounterActionRow[]> {
        if (actions.length === 0) {
            return [];
        }
        return this.db
            .select({
                lemma: wordEncounter.lemma,
                action: wordEncounter.action,
                createdAt: wordEncounter.created_at,
            })
            .from(wordEncounter)
            .where(and(
                gte(wordEncounter.created_at, since),
                inArray(wordEncounter.action, [...actions]),
            ));
    }
}
