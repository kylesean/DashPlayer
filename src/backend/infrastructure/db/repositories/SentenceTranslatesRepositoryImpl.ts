import { and, eq, inArray } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import { sentenceTranslates } from '@/backend/infrastructure/db/tables/sentenceTranslates';
import TYPES from '@/backend/ioc/types';
import TimeUtil from '@/common/utils/TimeUtil';

import type SentenceTranslatesRepository from '@/backend/services/repositories/SentenceTranslatesRepository';
import { type SentenceTranslatesUpsertParams } from '@/backend/services/repositories/SentenceTranslatesRepository';

/**
 * 句子翻译缓存仓储实现。
 */
@injectable()
export default class SentenceTranslatesRepositoryImpl implements SentenceTranslatesRepository {
    /**
     * 初始化句子翻译缓存仓储实例。
     *
     * @param db 由依赖容器注入的数据库实例，测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async findBySentencesAndMode(sentences: string[], mode: string) {
        if (sentences.length === 0) {
            return [];
        }
        return this.db
            .select()
            .from(sentenceTranslates)
            .where(and(inArray(sentenceTranslates.sentence, sentences), eq(sentenceTranslates.mode, mode)));
    }

    public async upsert(params: SentenceTranslatesUpsertParams): Promise<void> {
        await this.db
            .insert(sentenceTranslates)
            .values({
                sentence: params.sentence,
                translate: params.translate,
                mode: params.mode,
            })
            .onConflictDoUpdate({
                target: [sentenceTranslates.sentence, sentenceTranslates.mode],
                set: {
                    translate: params.translate,
                    mode: params.mode,
                    updated_at: params.updated_at ?? TimeUtil.timeUtc(),
                },
            });
    }

    public async upsertMany(params: SentenceTranslatesUpsertParams[]): Promise<void> {
        await Promise.all(params.map((item) => this.upsert(item)));
    }

    public async deleteByMode(mode: string): Promise<number> {
        const result = await this.db
            .delete(sentenceTranslates)
            .where(eq(sentenceTranslates.mode, mode));
        return result.changes ?? 0;
    }
}

