import type { InsertSentencePracticeRecord, SentencePracticeRecord } from '@/backend/infrastructure/db/tables/sentencePracticeRecord';

/**
 * 句子练习记录仓储接口。
 */
export default interface SentencePracticeRecordRepository {
    /**
     * 写入一条练习记录。
     *
     * @param value 记录内容(不含自增 id 与创建时间默认值)。
     * @returns 新记录的自增 id。
     */
    insertOne(value: InsertSentencePracticeRecord): Promise<number>;
    /**
     * 查询单个意群的练习历史,按创建时间倒序。
     *
     * @param fileHash 字幕内容 hash。
     * @param sentenceIndex 意群序号。
     * @param limit 返回条数上限。
     */
    listBySentence(fileHash: string, sentenceIndex: number, limit?: number): Promise<SentencePracticeRecord[]>;
    /**
     * 查询同一字幕文件的全部练习记录,供整片进度与薄弱句聚合。
     *
     * @param fileHash 字幕内容 hash。
     */
    listByFile(fileHash: string): Promise<SentencePracticeRecord[]>;
}
