import { injectable } from 'inversify';
import { storeGet } from '@/backend/infrastructure/settings/store';
import type { AiModelScene } from '@/backend/services/AiProviderService';
import type { SettingKey } from '@/common/types/store_schema';
import { parseStoredProviderProfiles } from '@/common/utils/cloud-ai-providers';

export type RoutedModel = {
    providerId: 'openai';
    modelId: string;
    fullModelId: string;
};

export default interface ModelRoutingService {
    resolveOpenAiModel(scene: AiModelScene): RoutedModel;
}


@injectable()
export class ModelRoutingServiceImpl implements ModelRoutingService {
    /**
     * 将 AI 使用场景映射到对应的模型设置键。
     * @param scene 当前 AI 使用场景。
     * @returns 该场景保存模型标识的设置键。
     */
    private resolveFeatureKey(scene: AiModelScene): string {
        if (scene === 'sentenceLearning') {
            return 'models.openai.sentenceLearning';
        }
        if (scene === 'subtitleTranslation') {
            return 'models.openai.subtitleTranslation';
        }
        return 'models.openai.dictionary';
    }

    /**
     * 解析服务配置中的 OpenAI 模型清单。
     * @param raw 逗号或换行分隔的模型配置。
     * @returns 去空、去重后的模型标识列表；空配置保持为空，不做默认模型回退。
     */
    private parseModels(raw: string): string[] {
        const parsed = raw
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0);

        return Array.from(new Set(parsed));
    }

    /**
     * 解析场景当前选择的 OpenAI 模型，并严格校验它仍在服务配置清单中。
     * @param scene 当前 AI 使用场景。
     * @returns 已校验的模型路由；配置缺失或失效时直接抛错。
     */
    public resolveOpenAiModel(scene: AiModelScene): RoutedModel {
        const profiles = parseStoredProviderProfiles(storeGet('models.openai.providers'));
        const availableModels = profiles && profiles.length > 0
            ? Array.from(new Set(profiles.flatMap((profile) => {
                const disabled = new Set(profile.disabledModels);
                return profile.models.filter((model) => !disabled.has(model));
            })))
            : (() => {
                const disabledModels = new Set(this.parseModels(storeGet('models.openai.disabled')));
                return this.parseModels(storeGet('models.openai.available'))
                    .filter((model) => !disabledModels.has(model));
            })();
        if (availableModels.length === 0) {
            throw new Error('OpenAI 可用模型列表为空，请先在服务配置中添加或启用模型');
        }
        const modelKey = this.resolveFeatureKey(scene) as SettingKey;
        const selectedModel = storeGet(modelKey);
        if (!availableModels.includes(selectedModel)) {
            throw new Error(`当前模型未在服务配置中启用: ${selectedModel}`);
        }

        return {
            providerId: 'openai',
            modelId: selectedModel,
            fullModelId: `openai:${selectedModel}`,
        };
    }
}
