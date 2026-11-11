import type LocalAiService from '@/backend/services/LocalAiService';
import type ModelRoutingService from '@/backend/services/ModelRoutingService';
import type SettingService from '@/backend/services/SettingService';
import {
    buildSubtitleStorageMode,
    type SubtitleTranslationStorageMode,
} from '@/backend/services/subtitle-translation/SubtitleTranslationStorageMode';
import { resolveSubtitleStyleWithSignature } from '@/common/constants/openaiSubtitlePrompts';
import type { TranslationMode, TranslationProvider } from '@/common/types/TranslationResult';

/**
 * 字幕翻译的 provider 设置取值（含 legacy 的 'local-mt'）。
 */
export type TranslationProviderSetting = NonNullable<
    Awaited<ReturnType<SettingService['getCurrentTranslationProvider']>>
>;

/**
 * 归一化 provider 设置。
 *
 * 设置里已废弃的 'local-mt' 引擎统一映射为 'local'，让缓存模式、调度 profileKey
 * 与网关路由都只面对 'tencent' | 'openai' | 'local' 三种 provider，避免旧值
 * 在多条链路上各自适配后产生不一致。
 *
 * @param raw 设置里读到的原始 provider。
 * @returns 归一化后的 provider。
 */
export const normalizeTranslationProvider = (raw: TranslationProviderSetting): TranslationProvider => {
    return raw === 'local-mt' ? 'local' : raw;
};

/**
 * 上下文解析依赖：设置、本地推理与模型路由服务。
 */
export interface SubtitleTranslationContextDeps {
    /** 设置业务服务。 */
    settingService: SettingService;
    /** 本地大模型推理服务。 */
    localAiService: LocalAiService;
    /** 模型路由配置服务。 */
    modelRoutingService: ModelRoutingService;
}

/**
 * 当前设置解析出的字幕翻译稳定上下文。
 */
export interface ResolvedSubtitleTranslationContext {
    /** 当前翻译模式（zh 等）。 */
    mode: TranslationMode;
    /** 持久化缓存模式（含引擎与模型标识）。 */
    storageMode: SubtitleTranslationStorageMode;
    /** OpenAI 批量提示词使用的风格约束；腾讯引擎为 undefined。 */
    style?: string;
    /** 调度器使用的 profileKey。 */
    profileKey: string;
    /** 本地引擎使用中的模型 ID；云端引擎为 null。 */
    localModelId: string | null;
}

/**
 * 解析当前设置对应的风格、持久化缓存模式与调度 profileKey。
 *
 * 这是设置到缓存键/网关引擎路径的唯一解析入口：播放调度与独立直翻都从这里取值，
 * 避免同一配置在多处重复拼装后产生不一致。
 *
 * @param deps 上下文解析依赖。
 * @param provider 当前字幕翻译 provider（已归一化）。
 * @returns 翻译模式、缓存模式、风格、调度 profileKey 与本地模型 ID（云端为 null）；
 *          对应引擎未配置模型时抛出显式错误。
 */
export const resolveSubtitleTranslationContext = async (
    deps: SubtitleTranslationContextDeps,
    provider: TranslationProvider,
): Promise<ResolvedSubtitleTranslationContext> => {
    if (provider === 'tencent') {
        return { mode: 'zh', storageMode: 'tencent', profileKey: 'tencent', localModelId: null };
    }
    const mode = await deps.settingService.getOpenAiSubtitleTranslationMode();
    const customStyle = mode === 'custom'
        ? await deps.settingService.getOpenAiSubtitleCustomStyle()
        : undefined;
    const resolved = resolveSubtitleStyleWithSignature(mode, customStyle);
    const localModelId = provider === 'local' ? await deps.localAiService.getActiveModelId() : null;
    if (provider === 'local') {
        // 本地引擎缺少模型标识时显式失败，不滑入云端路由掩盖配置问题。
        if (!localModelId) throw new Error('本地字幕翻译模型未配置');
        const storageMode = buildSubtitleStorageMode('local', localModelId, mode, resolved.signature);
        return { mode, storageMode, style: resolved.style, profileKey: `${storageMode}:${localModelId}`, localModelId };
    }
    const routed = deps.modelRoutingService.resolveOpenAiModel('subtitleTranslation');
    const storageMode = buildSubtitleStorageMode('openai', routed.modelId, mode, resolved.signature);
    return { mode, storageMode, style: resolved.style, profileKey: `${storageMode}:${routed.fullModelId}`, localModelId: null };
};
