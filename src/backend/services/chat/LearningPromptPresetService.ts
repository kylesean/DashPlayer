import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type LearningPromptPresetRepository from '@/backend/services/repositories/LearningPromptPresetRepository';
import {
    BUILTIN_LEARNING_PROMPT_PRESETS,
    DEFAULT_LEARNING_PROMPT_PRESET_ID,
    findBuiltinPromptPreset,
} from '@/backend/services/chat/LearningPromptPresets';
import type {
    LearningPromptPresetResetParams,
    LearningPromptPresetSaveParams,
    LearningPromptPresetVO,
} from '@/common/types/chat';

export default interface LearningPromptPresetService {
    list(): Promise<LearningPromptPresetVO[]>;
    resolvePrompt(presetId?: string): Promise<{ preset: LearningPromptPresetVO; rawPrompt: string }>;
    save(params: LearningPromptPresetSaveParams): Promise<LearningPromptPresetVO>;
    resetBuiltin(params: LearningPromptPresetResetParams): Promise<LearningPromptPresetVO>;
}

/**
 * 整句学习教学预设服务：合并内置只读预设与 SQLite 用户自定义/覆盖条目。
 */
@injectable()
export class LearningPromptPresetServiceImpl implements LearningPromptPresetService {
    constructor(
        @inject(TYPES.LearningPromptPresetRepository) private readonly repository: LearningPromptPresetRepository,
        @inject(TYPES.SettingsStore) private readonly settingsStore: SettingsStore,
    ) {}

    public async list(): Promise<LearningPromptPresetVO[]> {
        const storedRows = await this.repository.listAll();
        const storedById = new Map(storedRows.map((row) => [row.preset_id, row]));
        const activeId = this.getActivePresetId();

        const result: LearningPromptPresetVO[] = [];
        for (const builtin of BUILTIN_LEARNING_PROMPT_PRESETS) {
            const override = storedById.get(builtin.id);
            result.push({
                id: builtin.id,
                name: override?.name ?? builtin.name,
                description: override?.description ?? builtin.description,
                roleMode: (override?.role_mode as LearningPromptPresetVO['roleMode']) ?? builtin.roleMode,
                systemPrompt: override?.system_prompt ?? builtin.systemPrompt,
                isBuiltin: true,
                isDefault: builtin.id === activeId,
                updatedAt: override?.updated_at ?? '',
            });
            storedById.delete(builtin.id);
        }

        for (const custom of storedById.values()) {
            result.push({
                id: custom.preset_id,
                name: custom.name,
                description: custom.description,
                roleMode: (custom.role_mode as LearningPromptPresetVO['roleMode']) ?? 'custom',
                systemPrompt: custom.system_prompt,
                isBuiltin: false,
                isDefault: custom.preset_id === activeId,
                updatedAt: custom.updated_at,
            });
        }

        return result;
    }

    public async resolvePrompt(presetId?: string): Promise<{ preset: LearningPromptPresetVO; rawPrompt: string }> {
        const all = await this.list();
        const targetId = presetId?.trim() || this.getActivePresetId();
        const matched = all.find((item) => item.id === targetId)
            ?? all.find((item) => item.id === DEFAULT_LEARNING_PROMPT_PRESET_ID)
            ?? all[0];
        return {
            preset: matched,
            rawPrompt: matched.systemPrompt,
        };
    }

    public async save(params: LearningPromptPresetSaveParams): Promise<LearningPromptPresetVO> {
        const presetId = params.id.trim();
        const builtin = findBuiltinPromptPreset(presetId);
        const row = await this.repository.upsert({
            preset_id: presetId,
            name: params.name.trim() || builtin?.name || '自定义导师',
            description: params.description?.trim() ?? builtin?.description ?? '用户自定义教学提示词',
            role_mode: params.roleMode ?? builtin?.roleMode ?? 'custom',
            system_prompt: params.systemPrompt,
            is_builtin: Boolean(builtin),
            sort_order: builtin?.sortOrder ?? 200,
        });

        if (params.setAsActive) {
            this.settingsStore.set('learning.activePromptPresetId', row.preset_id);
        }

        return {
            id: row.preset_id,
            name: row.name,
            description: row.description,
            roleMode: row.role_mode as LearningPromptPresetVO['roleMode'],
            systemPrompt: row.system_prompt,
            isBuiltin: row.is_builtin,
            isDefault: row.preset_id === this.getActivePresetId(),
            updatedAt: row.updated_at,
        };
    }

    public async resetBuiltin(params: LearningPromptPresetResetParams): Promise<LearningPromptPresetVO> {
        const builtin = findBuiltinPromptPreset(params.id);
        if (!builtin) {
            throw new Error(`不存在内置预设：${params.id}`);
        }
        await this.repository.deleteByPresetId(builtin.id);
        return {
            id: builtin.id,
            name: builtin.name,
            description: builtin.description,
            roleMode: builtin.roleMode,
            systemPrompt: builtin.systemPrompt,
            isBuiltin: true,
            isDefault: builtin.id === this.getActivePresetId(),
            updatedAt: '',
        };
    }

    private getActivePresetId(): string {
        const stored = this.settingsStore.get('learning.activePromptPresetId');
        return stored && stored.trim().length > 0 ? stored.trim() : DEFAULT_LEARNING_PROMPT_PRESET_ID;
    }
}
