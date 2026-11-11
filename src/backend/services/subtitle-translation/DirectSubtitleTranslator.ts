import type ClientProviderService from '@/backend/services/ClientProviderService';
import type SettingService from '@/backend/services/SettingService';
import type {
    SubtitleBatchTranslationInput,
    SubtitleTranslationTarget,
} from '@/backend/services/gateways/translate/SubtitleBatchTranslationInput';
import type { TencentTranslateClient } from '@/backend/services/gateways/translate/TencentTranslateClient';
import {
    normalizeTranslationProvider,
    type ResolvedSubtitleTranslationContext,
} from '@/backend/services/subtitle-translation/SubtitleTranslationContext';
import type { SubtitleTranslationStorageMode } from '@/backend/services/subtitle-translation/SubtitleTranslationStorageMode';
import { buildSentenceStorageKey, shouldTranslateSubtitleText } from '@/backend/services/subtitle-translation/SubtitleTranslationCacheKey';
import { concurrency } from '@/backend/utils/concurrency';
import type { TranslationProvider } from '@/common/types/TranslationResult';

/**
 * 不依赖播放窗口的独立字幕翻译目标。
 */
export interface DirectTranslationTarget {
    /** 用于缓存和结果映射的归一化原文键。 */
    key: string;
    /** 保留原始大小写的待翻译文本。 */
    text: string;
}

/**
 * 直译器宿主能力：缓存读写、按模式清空与批量翻译（含云端失败回退本地）
 * 由编排服务提供，直译器只保留独立文本批次的编排逻辑。
 */
export interface DirectSubtitleTranslatorHost {
    /** 批量查询当前模式下的句级翻译缓存，键为数据库存储键。 */
    getTranslations(keys: string[], storageMode: SubtitleTranslationStorageMode): Promise<Map<string, string>>;
    /** 批量持久化新增翻译，键为数据库存储键。 */
    saveTranslations(translations: Map<string, string>, storageMode: SubtitleTranslationStorageMode): Promise<void>;
    /** 删除当前模式下的全部句级翻译缓存，返回删除行数。 */
    deleteTranslationsByMode(storageMode: SubtitleTranslationStorageMode): Promise<number>;
    /** 按当前引擎批量翻译，云端失败时对这一批回退本地大模型。 */
    translateWithFallback(
        input: SubtitleBatchTranslationInput,
        provider: 'openai' | 'local',
        localModelId: string | null,
        targets: SubtitleTranslationTarget[]
    ): Promise<{ translations: Map<string, string>; fellBackToLocal: boolean }>;
}

/**
 * 直译器依赖。
 */
export interface DirectSubtitleTranslatorDeps {
    /** 设置业务服务：读取当前翻译 provider。 */
    settingService: SettingService;
    /** 腾讯云翻译客户端提供器。 */
    tencentProvider: ClientProviderService<TencentTranslateClient>;
    /** 当前设置到缓存模式/风格上下文的解析入口。 */
    resolveContext: (provider: TranslationProvider) => Promise<ResolvedSubtitleTranslationContext>;
    /** 宿主能力。 */
    host: DirectSubtitleTranslatorHost;
    /** 独立日志出口。 */
    logger: { info: (message: string, data?: unknown) => void };
}

/**
 * 独立字幕文本批次的直译器。
 *
 * 服务收藏片段、AI 问答等非播放窗口场景：与播放调度共用缓存、Provider 网关
 * 和批量 Prompt（经宿主），但不创建播放位置会话、不携带上下文邻居。
 * 从 SubtitleTranslationService 拆出的用意：播放窗口调度（更新需求、优先级
 * 窗口、失败重试）与一次性直翻是两条编排路径，留在同一个类里相互遮蔽。
 */
export class DirectSubtitleTranslator {
    constructor(private readonly deps: DirectSubtitleTranslatorDeps) {}

    /**
     * 使用当前 provider 对独立文本批次执行一次结构化翻译。
     *
     * @param texts 待翻译文本；空白项会被忽略，重复项按归一化文本键合并。
     * @returns 归一化原文到翻译结果的映射。
     */
    public async translateTexts(texts: string[]): Promise<Map<string, string>> {
        const targetsByKey = new Map<string, DirectTranslationTarget>();
        texts.forEach((text) => {
            const trimmed = text.trim();
            const key = buildSentenceStorageKey(trimmed);
            if (key && !targetsByKey.has(key)) {
                targetsByKey.set(key, { key, text: trimmed });
            }
        });
        if (targetsByKey.size === 0) {
            return new Map();
        }

        const rawProvider = await this.deps.settingService.getCurrentTranslationProvider();
        if (!rawProvider) {
            throw new Error('未启用字幕翻译服务');
        }
        const provider = normalizeTranslationProvider(rawProvider);

        const { mode, storageMode, style, localModelId } = await this.deps.resolveContext(provider);

        const targets = Array.from(targetsByKey.values());
        const cached = await this.deps.host.getTranslations(
            targets.map((target) => target.key),
            storageMode
        );
        const result = new Map(cached);
        const freshResults = new Map<string, string>();
        const pending = targets.filter((target) => !cached.has(target.key));
        const skipped = pending.filter((target) => !shouldTranslateSubtitleText(target.text));
        skipped.forEach((target) => {
            result.set(target.key, target.text);
        });

        const onlineTargets = pending.filter(
            (target) => shouldTranslateSubtitleText(target.text)
        );
        let fellBackToLocal = false;
        if (onlineTargets.length > 0) {
            const batchId = `direct-${Date.now()}`;
            const startedAt = Date.now();
            let onlineResults: Map<string, string>;
            if (provider === 'tencent') {
                onlineResults = await this.translateWithTencent(onlineTargets, batchId);
            } else {
                const gatewayOutcome = await this.translateWithGateway(
                    onlineTargets,
                    mode,
                    style,
                    localModelId,
                    provider as 'openai' | 'local',
                );
                onlineResults = gatewayOutcome.translations;
                fellBackToLocal = gatewayOutcome.fellBackToLocal;
            }
            onlineResults.forEach((translation, key) => {
                result.set(key, translation);
                freshResults.set(key, translation);
            });
            this.deps.logger.info('独立字幕批次翻译完成', {
                batchId,
                provider,
                mode,
                fellBackToLocal,
                cacheHitCount: cached.size,
                targetCount: onlineTargets.length,
                elapsedMs: Date.now() - startedAt,
            });
        }

        if (!fellBackToLocal) {
            await this.deps.host.saveTranslations(freshResults, storageMode);
        }
        return result;
    }

    /**
     * 清空当前配置对应的持久化翻译缓存。
     *
     * @returns 删除的缓存行数。
     */
    public async clearTranslationCache(): Promise<number> {
        const rawProvider = await this.deps.settingService.getCurrentTranslationProvider();
        if (!rawProvider) {
            throw new Error('未启用字幕翻译服务');
        }
        const provider = normalizeTranslationProvider(rawProvider);
        const { storageMode } = await this.deps.resolveContext(provider);
        const deleted = await this.deps.host.deleteTranslationsByMode(storageMode);
        this.deps.logger.info('已清除当前配置的字幕翻译缓存', { provider, storageMode, deleted });
        return deleted;
    }

    /**
     * 使用腾讯接口翻译不属于播放窗口的独立文本批次。
     *
     * 与主路径一致走 `tencent` 限流，避免直翻批次绕过配额触发上游限流。
     * @param targets 使用归一化原文作为 key 的目标条目。
     * @param batchId 日志关联批次编号。
     * @returns 归一化原文到翻译结果的映射。
     */
    private async translateWithTencent(
        targets: DirectTranslationTarget[],
        batchId: string
    ): Promise<Map<string, string>> {
        const client = this.deps.tencentProvider.getClient();
        if (!client) {
            throw new Error('腾讯翻译客户端未初始化，请检查密钥配置');
        }

        const holder = await concurrency.withRateLimit('tencent', () => client.batchTrans(
            targets.map((target) => target.text),
            {
                batchId,
                fileHash: 'direct',
            }
        ));
        const translations = new Map<string, string>();
        targets.forEach((target) => {
            const translation = holder.get(target.text)?.trim();
            if (translation) {
                translations.set(target.key, translation);
            }
        });
        return translations;
    }

    /**
     * 使用当前批量 Prompt 翻译不属于播放窗口的独立文本批次。
     *
     * @param targets 使用归一化原文作为 key 的目标条目。
     * @param mode 当前字幕翻译模式。
     * @param style 已解析的风格约束。
     * @param localModelId 本地引擎使用中的模型 ID；云端引擎为 null。
     * @param provider 当前配置的引擎。
     * @returns 归一化原文到翻译结果的映射及是否发生了本地回退。
     */
    private async translateWithGateway(
        targets: DirectTranslationTarget[],
        mode: ResolvedSubtitleTranslationContext['mode'],
        style: string | undefined,
        localModelId: string | null,
        provider: 'openai' | 'local'
    ): Promise<{ translations: Map<string, string>; fellBackToLocal: boolean }> {
        if (!style) {
            throw new Error('OpenAI 字幕翻译风格配置缺失');
        }
        // 独立直翻场景没有播放窗口，不携带上下文。
        const input: SubtitleBatchTranslationInput = {
            targets: [...targets],
            contextBefore: [],
            contextAfter: [],
            mode,
            style: style ?? '',
            signal: new AbortController().signal,
        };
        return this.deps.host.translateWithFallback(input, provider, localModelId, input.targets);
    }
}
