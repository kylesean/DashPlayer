import { and, eq, inArray, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import { videoLearningClipWord } from '@/backend/infrastructure/db/tables/videoLearningClipWord';
import TYPES from '@/backend/ioc/types';

import type VideoLearningClipWordRepository from '@/backend/services/repositories/VideoLearningClipWordRepository';
import { type WordClipStats } from '@/backend/services/repositories/VideoLearningClipWordRepository';

/**
 * 视频学习片段与单词关联仓储实现。
 */
@injectable()
export default class VideoLearningClipWordRepositoryImpl implements VideoLearningClipWordRepository {
    /**
     * 初始化视频学习片段-单词关联仓储实例。
     *
     * @param db 由依赖容器注入的数据库实例，测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async findClipKeysByWord(word: string): Promise<string[]> {
        if (!word) {
            return [];
        }

        const rows = await this.db
            .select({ clip_key: videoLearningClipWord.clip_key })
            .from(videoLearningClipWord)
            .where(eq(videoLearningClipWord.word, word));

        return rows.map((row) => row.clip_key);
    }

    public async getWordsMapByClipKeys(keys: string[]): Promise<Map<string, string[]>> {
        const result = new Map<string, string[]>();
        if (!keys || keys.length === 0) {
            return result;
        }

        const rows = await this.db
            .select({
                clipKey: videoLearningClipWord.clip_key,
                word: videoLearningClipWord.word,
            })
            .from(videoLearningClipWord)
            .where(inArray(videoLearningClipWord.clip_key, keys));

        const tempMap = new Map<string, Set<string>>();
        for (const row of rows) {
            const cleanedWord = typeof row.word === 'string' ? row.word.toLowerCase().trim() : '';
            if (!cleanedWord) {
                continue;
            }
            if (!tempMap.has(row.clipKey)) {
                tempMap.set(row.clipKey, new Set());
            }
            tempMap.get(row.clipKey)?.add(cleanedWord);
        }

        tempMap.forEach((set, key) => {
            result.set(key, Array.from(set));
        });

        return result;
    }

    /**
     * 按单词聚合片段统计：数量与最近一次被添加视频的时间。
     *
     * @returns 单词到片段数量及最近添加视频时间的映射。
     */
    public async statsGroupedByWord(): Promise<Record<string, WordClipStats>> {
        const rows = await this.db
            .select({
                word: videoLearningClipWord.word,
                count: sql<number>`count(*)`,
                lastAddedAt: sql<string>`max(${videoLearningClipWord.created_at})`,
            })
            .from(videoLearningClipWord)
            .groupBy(videoLearningClipWord.word);

        const result: Record<string, WordClipStats> = {};
        for (const row of rows) {
            result[row.word] = {
                count: Number(row.count) || 0,
                lastAddedAt: row.lastAddedAt ?? '',
            };
        }
        return result;
    }

    /**
     * 将某单词的全部片段关联迁移到新单词。
     *
     * 行为说明：
     * - 在同一事务内先删除新单词与旧片段重合的关联，再整体改名，
     *   避免触碰 (word, clip_key) 唯一索引。
     *
     * @param oldWord 原单词。
     * @param newWord 新单词。
     */
    public async renameWord(oldWord: string, newWord: string): Promise<void> {
        if (!oldWord || !newWord || oldWord === newWord) {
            return;
        }

        this.db.transaction((tx) => {
            const oldRows = tx
                .select({ clip_key: videoLearningClipWord.clip_key })
                .from(videoLearningClipWord)
                .where(eq(videoLearningClipWord.word, oldWord))
                .all();
            const clipKeys = oldRows.map((row) => row.clip_key);
            if (clipKeys.length === 0) {
                return;
            }

            tx.delete(videoLearningClipWord)
                .where(and(
                    eq(videoLearningClipWord.word, newWord),
                    inArray(videoLearningClipWord.clip_key, clipKeys),
                ))
                .run();

            tx.update(videoLearningClipWord)
                .set({
                    word: newWord,
                    updated_at: new Date().toISOString(),
                })
                .where(eq(videoLearningClipWord.word, oldWord))
                .run();
        });
    }

    /**
     * 删除某单词的全部片段关联。
     *
     * @param word 单词。
     */
    public async deleteByWord(word: string): Promise<void> {
        if (!word) {
            return;
        }

        this.db.delete(videoLearningClipWord)
            .where(eq(videoLearningClipWord.word, word))
            .run();
    }
}
