import type {
    LearningPromptPresetRow,
    InsertLearningPromptPresetRow,
} from '@/backend/infrastructure/db/tables/learningPromptPreset';

/**
 * 整句学习 Prompt 预设仓储（仅存用户新建预设与对内置预设的覆盖版本）。
 */
export default interface LearningPromptPresetRepository {
    listAll(): Promise<LearningPromptPresetRow[]>;
    findByPresetId(presetId: string): Promise<LearningPromptPresetRow | null>;
    upsert(value: InsertLearningPromptPresetRow): Promise<LearningPromptPresetRow>;
    deleteByPresetId(presetId: string): Promise<void>;
}
