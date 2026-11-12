import { asc, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    type InsertLearningPromptPresetRow,
    learningPromptPreset,
    type LearningPromptPresetRow,
} from '@/backend/infrastructure/db/tables/learningPromptPreset';
import TYPES from '@/backend/ioc/types';
import type LearningPromptPresetRepository from '@/backend/services/repositories/LearningPromptPresetRepository';

/**
 * 整句学习 Prompt 预设仓储实现。
 */
@injectable()
export default class LearningPromptPresetRepositoryImpl implements LearningPromptPresetRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async listAll(): Promise<LearningPromptPresetRow[]> {
        return this.db
            .select()
            .from(learningPromptPreset)
            .orderBy(asc(learningPromptPreset.sort_order), asc(learningPromptPreset.id));
    }

    public async findByPresetId(presetId: string): Promise<LearningPromptPresetRow | null> {
        const rows = await this.db
            .select()
            .from(learningPromptPreset)
            .where(eq(learningPromptPreset.preset_id, presetId))
            .limit(1);
        return rows[0] ?? null;
    }

    public async upsert(value: InsertLearningPromptPresetRow): Promise<LearningPromptPresetRow> {
        const now = new Date().toISOString();
        const existing = await this.findByPresetId(value.preset_id);
        if (existing) {
            await this.db
                .update(learningPromptPreset)
                .set({
                    name: value.name,
                    description: value.description ?? '',
                    role_mode: value.role_mode ?? existing.role_mode,
                    system_prompt: value.system_prompt,
                    is_builtin: value.is_builtin ?? existing.is_builtin,
                    sort_order: value.sort_order ?? existing.sort_order,
                    updated_at: now,
                })
                .where(eq(learningPromptPreset.id, existing.id));
            const updated = await this.findByPresetId(value.preset_id);
            if (!updated) {
                throw new Error(`failed to read updated preset: ${value.preset_id}`);
            }
            return updated;
        }

        const [inserted] = await this.db
            .insert(learningPromptPreset)
            .values({
                ...value,
                created_at: now,
                updated_at: now,
            })
            .returning();
        return inserted;
    }

    public async deleteByPresetId(presetId: string): Promise<void> {
        await this.db
            .delete(learningPromptPreset)
            .where(eq(learningPromptPreset.preset_id, presetId));
    }
}
