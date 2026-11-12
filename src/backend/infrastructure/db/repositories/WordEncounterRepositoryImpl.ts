import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    wordEncounter,
    type InsertWordEncounter,
} from '@/backend/infrastructure/db/tables/wordEncounter';
import { watchHistory } from '@/backend/infrastructure/db/tables/watchHistory';
import TYPES from '@/backend/ioc/types';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import type {
    EncounterActionRow,
    EncounterContextRow,
    ReviewOutcome,
} from '@/backend/services/repositories/WordEncounterRepository';
import type { WordEncounterAction } from '@/common/types/vocabulary';

/** 语境查询的防御性上限：正常复习队列最多 50 张卡，不会接近这个量级。 */
const MAX_CONTEXT_EVENTS = 2000;

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
                createdAt: wordEncounter.created_at,
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

    public async findLatestContexts(lemmas: string[]): Promise<EncounterContextRow[]> {
        if (lemmas.length === 0) {
            return [];
        }
        const rows = this.db
            .select({
                lemma: wordEncounter.lemma,
                text: wordEncounter.context,
                videoId: wordEncounter.video_id,
                videoFileName: watchHistory.file_name,
                sentenceIndex: wordEncounter.sentence_index,
                sentenceHash: wordEncounter.sentence_hash,
                createdAt: wordEncounter.created_at,
            })
            .from(wordEncounter)
            .leftJoin(watchHistory, eq(watchHistory.id, wordEncounter.video_id))
            .where(and(
                inArray(sql`lower(${wordEncounter.lemma})`, lemmas.map((lemma) => lemma.toLowerCase())),
                isNotNull(wordEncounter.context),
            ))
            .orderBy(desc(wordEncounter.created_at), desc(wordEncounter.id))
            .limit(MAX_CONTEXT_EVENTS)
            .all();
        // 已按时间倒序，每个 lemma 的第一条就是最近一次带语境的遭遇。
        const latest = new Map<string, EncounterContextRow>();
        for (const row of rows) {
            if (!row.text || latest.has(row.lemma)) {
                continue;
            }
            latest.set(row.lemma, { ...row, text: row.text });
        }
        return Array.from(latest.values());
    }
}
