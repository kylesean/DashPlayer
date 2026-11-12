import { desc, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    savedSentence,
    type SavedSentenceRow,
} from '@/backend/infrastructure/db/tables/savedSentence';
import TYPES from '@/backend/ioc/types';
import type SavedSentenceRepository from '@/backend/services/repositories/SavedSentenceRepository';
import type {
    SavedSentenceVO,
    SaveSentenceInput,
    UpdateSavedSentenceInput,
} from '@/common/types/contextStudio';

const toVO = (row: SavedSentenceRow): SavedSentenceVO => ({
    id: row.id,
    sentenceKey: row.sentence_key,
    videoId: row.video_id,
    videoTitle: row.video_title,
    fileHash: row.file_hash,
    sentenceIndex: row.sentence_index,
    startTime: row.start_time,
    endTime: row.end_time,
    text: row.text,
    textZh: row.text_zh,
    note: row.note,
    tag: row.tag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

/**
 * 收藏金句持久化仓储实现。
 */
@injectable()
export default class SavedSentenceRepositoryImpl implements SavedSentenceRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async findAll(): Promise<SavedSentenceVO[]> {
        const rows = await this.db
            .select()
            .from(savedSentence)
            .orderBy(desc(savedSentence.created_at), desc(savedSentence.id));
        return rows.map(toVO);
    }

    public async findByKey(sentenceKey: string): Promise<SavedSentenceVO | null> {
        const rows = await this.db
            .select()
            .from(savedSentence)
            .where(eq(savedSentence.sentence_key, sentenceKey))
            .limit(1);
        return rows[0] ? toVO(rows[0]) : null;
    }

    public async findKeysByVideoId(videoId: string): Promise<string[]> {
        const rows = await this.db
            .select({ sentenceKey: savedSentence.sentence_key })
            .from(savedSentence)
            .where(eq(savedSentence.video_id, videoId));
        return rows.map((row) => row.sentenceKey);
    }

    public async upsert(input: SaveSentenceInput): Promise<SavedSentenceVO> {
        const now = new Date().toISOString();
        const existing = await this.findByKey(input.sentenceKey);
        if (existing) {
            await this.db
                .update(savedSentence)
                .set({
                    video_id: input.videoId,
                    video_title: input.videoTitle ?? existing.videoTitle,
                    file_hash: input.fileHash,
                    sentence_index: input.sentenceIndex,
                    start_time: input.startTime,
                    end_time: input.endTime,
                    text: input.text,
                    text_zh: input.textZh ?? existing.textZh,
                    note: input.note ?? existing.note,
                    tag: input.tag ?? existing.tag,
                    updated_at: now,
                })
                .where(eq(savedSentence.sentence_key, input.sentenceKey));
            const updated = await this.findByKey(input.sentenceKey);
            if (!updated) {
                throw new Error(`Failed to reload saved sentence: ${input.sentenceKey}`);
            }
            return updated;
        }

        const inserted = await this.db
            .insert(savedSentence)
            .values({
                sentence_key: input.sentenceKey,
                video_id: input.videoId,
                video_title: input.videoTitle ?? '',
                file_hash: input.fileHash,
                sentence_index: input.sentenceIndex,
                start_time: input.startTime,
                end_time: input.endTime,
                text: input.text,
                text_zh: input.textZh ?? '',
                note: input.note ?? '',
                tag: input.tag ?? 'general',
                created_at: now,
                updated_at: now,
            })
            .returning();

        return toVO(inserted[0]);
    }

    public async updateNoteOrTag(input: UpdateSavedSentenceInput): Promise<SavedSentenceVO | null> {
        const existing = await this.findByKey(input.sentenceKey);
        if (!existing) {
            return null;
        }
        const now = new Date().toISOString();
        await this.db
            .update(savedSentence)
            .set({
                note: input.note !== undefined ? input.note : existing.note,
                tag: input.tag !== undefined ? input.tag : existing.tag,
                updated_at: now,
            })
            .where(eq(savedSentence.sentence_key, input.sentenceKey));
        return this.findByKey(input.sentenceKey);
    }

    public async deleteByKey(sentenceKey: string): Promise<boolean> {
        const result = await this.db
            .delete(savedSentence)
            .where(eq(savedSentence.sentence_key, sentenceKey))
            .returning({ id: savedSentence.id });
        return result.length > 0;
    }
}
