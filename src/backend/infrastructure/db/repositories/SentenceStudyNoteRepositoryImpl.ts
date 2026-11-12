import { and, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    sentenceStudyNote,
    type SentenceStudyNoteRow,
} from '@/backend/infrastructure/db/tables/sentenceStudyNote';
import TYPES from '@/backend/ioc/types';
import type SentenceStudyNoteRepository from '@/backend/services/repositories/SentenceStudyNoteRepository';
import {
    SentenceStudyCardSchema,
    type SentenceStudyCard,
} from '@/common/types/aiRes/AiUnifiedAnalysisRes';
import {
    buildSentenceStudyKey,
    type PersistedChatMessage,
    type SentenceStudyNoteSaveParams,
    type SentenceStudyRecordVO,
} from '@/common/types/chat';

/** 安全反序列化首卡缓存；历史结构损坏时优雅降级为 null 而不阻塞整句进入。 */
const parseStudyCardJson = (
    raw: string | null,
    logger: ReturnType<typeof getMainLogger>,
): SentenceStudyCard | null => {
    if (!raw) return null;
    try {
        const parsed = SentenceStudyCardSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch (error) {
        logger.warn('ignore malformed sentence study card cache', { error });
        return null;
    }
};

/** 安全反序列化对话历史；损坏条目忽略不崩溃。 */
const parseMessagesJson = (
    raw: string,
    logger: ReturnType<typeof getMainLogger>,
): PersistedChatMessage[] => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is PersistedChatMessage => (
            Boolean(item)
            && typeof item === 'object'
            && typeof item.id === 'string'
            && (item.role === 'user' || item.role === 'assistant')
            && Array.isArray(item.blocks)
        ));
    } catch (error) {
        logger.warn('ignore malformed sentence study chat history', { error });
        return [];
    }
};

const toVO = (
    row: SentenceStudyNoteRow,
    logger: ReturnType<typeof getMainLogger>,
): SentenceStudyRecordVO => ({
    sentenceKey: row.sentence_key,
    videoId: row.video_id,
    fileHash: row.file_hash,
    sentenceIndex: row.sentence_index,
    originalText: row.original_text,
    studyCard: parseStudyCardJson(row.study_card_json, logger),
    noteSummary: row.note_summary,
    messages: parseMessagesJson(row.messages_json, logger),
    presetId: row.preset_id,
    updatedAt: row.updated_at,
});

/**
 * 整句学习笔记、首卡缓存与历史对话仓储实现。
 */
@injectable()
export default class SentenceStudyNoteRepositoryImpl implements SentenceStudyNoteRepository {
    private readonly logger = getMainLogger('SentenceStudyNoteRepository');

    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async findByLocation(
        fileHash: string,
        sentenceIndex: number,
    ): Promise<SentenceStudyRecordVO | null> {
        const key = buildSentenceStudyKey(fileHash, sentenceIndex);
        const byKey = await this.findByKey(key);
        if (byKey) return byKey;

        const rows = await this.db
            .select()
            .from(sentenceStudyNote)
            .where(and(
                eq(sentenceStudyNote.file_hash, fileHash),
                eq(sentenceStudyNote.sentence_index, sentenceIndex),
            ))
            .limit(1);
        return rows.length > 0 ? toVO(rows[0], this.logger) : null;
    }

    public async findByKey(sentenceKey: string): Promise<SentenceStudyRecordVO | null> {
        const rows = await this.db
            .select()
            .from(sentenceStudyNote)
            .where(eq(sentenceStudyNote.sentence_key, sentenceKey))
            .limit(1);
        return rows.length > 0 ? toVO(rows[0], this.logger) : null;
    }

    public async upsert(params: SentenceStudyNoteSaveParams): Promise<SentenceStudyRecordVO> {
        const now = new Date().toISOString();
        const existingRows = await this.db
            .select()
            .from(sentenceStudyNote)
            .where(eq(sentenceStudyNote.sentence_key, params.sentenceKey))
            .limit(1);

        if (existingRows.length > 0) {
            const existing = existingRows[0];
            const nextStudyCardJson = params.studyCard !== undefined
                ? (params.studyCard ? JSON.stringify(params.studyCard) : null)
                : existing.study_card_json;
            const nextNoteSummary = params.noteSummary !== undefined
                ? params.noteSummary
                : existing.note_summary;
            const nextMessagesJson = params.messages !== undefined
                ? JSON.stringify(params.messages)
                : existing.messages_json;
            const nextPresetId = params.presetId !== undefined
                ? params.presetId
                : existing.preset_id;

            await this.db
                .update(sentenceStudyNote)
                .set({
                    video_id: params.videoId,
                    original_text: params.originalText,
                    study_card_json: nextStudyCardJson,
                    note_summary: nextNoteSummary,
                    messages_json: nextMessagesJson,
                    preset_id: nextPresetId,
                    updated_at: now,
                })
                .where(eq(sentenceStudyNote.id, existing.id));

            const updated = await this.findByKey(params.sentenceKey);
            if (!updated) {
                throw new Error(`failed to read updated sentence study note: ${params.sentenceKey}`);
            }
            return updated;
        }

        const [inserted] = await this.db
            .insert(sentenceStudyNote)
            .values({
                sentence_key: params.sentenceKey,
                video_id: params.videoId,
                file_hash: params.fileHash,
                sentence_index: params.sentenceIndex,
                original_text: params.originalText,
                study_card_json: params.studyCard ? JSON.stringify(params.studyCard) : null,
                note_summary: params.noteSummary ?? '',
                messages_json: JSON.stringify(params.messages ?? []),
                preset_id: params.presetId ?? null,
                created_at: now,
                updated_at: now,
            })
            .returning();

        return toVO(inserted, this.logger);
    }

    public async saveStudyCard(params: {
        sentenceKey: string;
        videoId: string;
        fileHash: string;
        sentenceIndex: number;
        originalText: string;
        studyCard: SentenceStudyCard;
        presetId?: string | null;
    }): Promise<SentenceStudyRecordVO> {
        return this.upsert({
            sentenceKey: params.sentenceKey,
            videoId: params.videoId,
            fileHash: params.fileHash,
            sentenceIndex: params.sentenceIndex,
            originalText: params.originalText,
            studyCard: params.studyCard,
            ...(params.presetId !== undefined ? { presetId: params.presetId } : {}),
        });
    }

    public async saveMessages(params: {
        sentenceKey: string;
        videoId: string;
        fileHash: string;
        sentenceIndex: number;
        originalText: string;
        messages: PersistedChatMessage[];
        presetId?: string | null;
    }): Promise<SentenceStudyRecordVO> {
        return this.upsert({
            sentenceKey: params.sentenceKey,
            videoId: params.videoId,
            fileHash: params.fileHash,
            sentenceIndex: params.sentenceIndex,
            originalText: params.originalText,
            messages: params.messages,
            ...(params.presetId !== undefined ? { presetId: params.presetId } : {}),
        });
    }
}
