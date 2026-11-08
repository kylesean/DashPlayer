import { and, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import { wordTranslates } from '@/backend/infrastructure/db/tables/wordTranslates';
import TYPES from '@/backend/ioc/types';
import TimeUtil from '@/common/utils/TimeUtil';

import type WordTranslatesRepository from '@/backend/services/repositories/WordTranslatesRepository';

/**
 * 单词翻译缓存仓储实现。
 */
@injectable()
export default class WordTranslatesRepositoryImpl implements WordTranslatesRepository {
    /**
     * 初始化单词翻译缓存仓储实例。
     *
     * @param db 由依赖容器注入的数据库实例，测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async findOne(word: string, provider: string) {
        const rows = await this.db
            .select()
            .from(wordTranslates)
            .where(and(eq(wordTranslates.word, word), eq(wordTranslates.provider, provider)))
            .limit(1);
        return rows[0] ?? null;
    }

    public async upsert(word: string, provider: string, translate: string, updatedAt?: string): Promise<void> {
        await this.db
            .insert(wordTranslates)
            .values({
                word,
                provider,
                translate,
            })
            .onConflictDoUpdate({
                target: [wordTranslates.word, wordTranslates.provider],
                set: { translate, updated_at: updatedAt ?? TimeUtil.timeUtc() },
            });
    }

    public async deleteByProvider(provider: string): Promise<number> {
        const result = await this.db
            .delete(wordTranslates)
            .where(eq(wordTranslates.provider, provider));
        return result.changes ?? 0;
    }
}

