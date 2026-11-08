import { and, desc, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    type InsertSentencePracticeRecord,
    sentencePracticeRecord,
    type SentencePracticeRecord,
} from '@/backend/infrastructure/db/tables/sentencePracticeRecord';
import type SentencePracticeRecordRepository from '@/backend/services/repositories/SentencePracticeRecordRepository';

/**
 * 句子练习记录仓储实现。
 */
@injectable()
export default class SentencePracticeRecordRepositoryImpl implements SentencePracticeRecordRepository {
    /**
     * @param db 由依赖容器注入的 drizzle 实例；测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async insertOne(value: InsertSentencePracticeRecord): Promise<number> {
        const [record] = await this.db.insert(sentencePracticeRecord).values(value).returning({ id: sentencePracticeRecord.id });
        return record.id;
    }

    public async listBySentence(fileHash: string, sentenceIndex: number, resegmented: boolean, limit = 20): Promise<SentencePracticeRecord[]> {
        return this.db
            .select()
            .from(sentencePracticeRecord)
            .where(and(
                eq(sentencePracticeRecord.file_hash, fileHash),
                eq(sentencePracticeRecord.sentence_index, sentenceIndex),
                eq(sentencePracticeRecord.resegmented, resegmented),
            ))
            .orderBy(desc(sentencePracticeRecord.id))
            .limit(limit);
    }
}
