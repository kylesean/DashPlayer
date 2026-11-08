import { and, desc, eq } from 'drizzle-orm';
import { injectable } from 'inversify';

import db from '@/backend/infrastructure/db';
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

    public async insertOne(value: InsertSentencePracticeRecord): Promise<number> {
        const [record] = await db.insert(sentencePracticeRecord).values(value).returning({ id: sentencePracticeRecord.id });
        return record.id;
    }

    public async listBySentence(fileHash: string, sentenceIndex: number, limit = 20): Promise<SentencePracticeRecord[]> {
        return db
            .select()
            .from(sentencePracticeRecord)
            .where(and(
                eq(sentencePracticeRecord.file_hash, fileHash),
                eq(sentencePracticeRecord.sentence_index, sentenceIndex),
            ))
            .orderBy(desc(sentencePracticeRecord.id))
            .limit(limit);
    }
}
