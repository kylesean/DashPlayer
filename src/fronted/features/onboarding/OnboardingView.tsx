import { CONFETTI_COLORS } from '@/fronted/styles/decorationPalette';
import React from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { create as createConfetti } from 'canvas-confetti';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import TitleBar from '@/fronted/components/layout/TitleBar/TitleBar';
import { TITLE_BAR_HEIGHT } from '@/fronted/components/layout/TitleBar/titleBarMetrics';
import {
    CheckCircle2,
    Cloud,
    Copy,
    Cpu,
    Download,
    ExternalLink,
    FileVideo,
    Folder,
    FolderOpen,
    HelpCircle,
    ArrowLeft,
    ArrowRight,
    Check,
    XCircle,
} from 'lucide-react';
import { useOnboardingBundle, type BundleTierChoice } from '@/fronted/features/onboarding/hooks/useOnboardingBundle';
import {
    CLOUD_AI_PROVIDER_PRESETS,
    isLocalLlmEndpoint,
} from '@/common/constants/cloud-ai-provider-presets';
import { isHardwareSuitableForLocalAi } from '@/common/utils/hardware-profile';
import { AuthorSupportBanner } from '@/fronted/components/shared/AuthorSupportBanner';

// 版本号与 QA fixture 共用同一常量：两边各写一份字面量时，bump 后 QA 会静默失效。
export { CURRENT_ONBOARDING_VERSION } from '@/common/constants/onboarding';

/** 点阵涟漪背景的列数与行数。 */
const RIPPLE_COLUMNS = 11;
const RIPPLE_ROWS = 5;
/** 点阵涟漪的呼吸周期（秒）：下载中更紧凑，让背景跟着进度"活"起来。 */
const RIPPLE_DURATION_IDLE = 3.6;
const RIPPLE_DURATION_ACTIVE = 1.4;

/** 引导页内可选快速配置的四家主流云端服务预设。 */
const QUICK_PRESET_IDS = [
    'openai',
    'anthropic',
    'google-gemini',
    'deepseek',
] as const;

/** 把字节/秒格式化为网速文案。 */
function formatSpeed(bytesPerSecond: number): string {
    const megabytes = bytesPerSecond / 1024 / 1024;
    return megabytes >= 1
        ? `${Math.round(megabytes)} MB/s`
        : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

/** 随机烟花连放的束数。 */
const FIREWORK_BURSTS = 4;

/** 完成页的全屏庆祝动画。 */
const Confetti: React.FC = () => {
    React.useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        Object.assign(canvas.style, {
            position: 'fixed',
            inset: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '50',
        });
        document.body.appendChild(canvas);

        const fire = createConfetti(canvas, { resize: true, useWorker: true, disableForReducedMotion: true });
        const base = { colors: CONFETTI_COLORS, disableForReducedMotion: true };

        void fire({ ...base, particleCount: 60, angle: 58, spread: 58, origin: { x: 0, y: 0.78 }, startVelocity: 60, scalar: 1.1, flat: true, ticks: 260 });
        void fire({ ...base, particleCount: 60, angle: 122, spread: 58, origin: { x: 1, y: 0.78 }, startVelocity: 60, scalar: 1.1, flat: true, ticks: 260 });
        void fire({ ...base, particleCount: 110, spread: 110, origin: { x: 0.5, y: 0.4 }, startVelocity: 44, scalar: 1.2, shapes: ['star', 'circle'], gravity: 0.9, decay: 0.91, ticks: 300 });

        const timers = Array.from({ length: FIREWORK_BURSTS }, (_, index) => window.setTimeout(() => {
            void fire({
                ...base,
                particleCount: 55,
                spread: 360,
                startVelocity: 26,
                origin: { x: 0.2 + Math.random() * 0.6, y: 0.22 + Math.random() * 0.34 },
                scalar: 0.9,
                shapes: ['star', 'circle'],
                gravity: 0.6,
                decay: 0.94,
                ticks: 200,
            });
        }, 240 + index * 240));

        return () => {
            timers.forEach((timer) => window.clearTimeout(timer));
            fire.reset();
            canvas.remove();
        };
    }, []);

    return null;
};

/** 下载步骤背后的点阵涟漪。 */
const DotRippleBackground: React.FC<{ active: boolean }> = ({ active }) => {
    const dots = React.useMemo(
        () => Array.from({ length: RIPPLE_COLUMNS * RIPPLE_ROWS }, (_, index) => {
            const column = index % RIPPLE_COLUMNS;
            const row = Math.floor(index / RIPPLE_COLUMNS);
            return { key: index, delay: (column + row) * 0.16 };
        }),
        [],
    );

    return (
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
            <div
                className="grid h-full w-full items-center justify-items-center gap-3 px-2 py-6"
                style={{ gridTemplateColumns: `repeat(${RIPPLE_COLUMNS}, minmax(0, 1fr))` }}
            >
                {dots.map((dot) => (
                    <span
                        key={dot.key}
                        className="dot-ripple h-1 w-1 rounded-full bg-accent-bg/60"
                        style={{
                            animationDelay: `${dot.delay}s`,
                            animationDuration: `${active ? RIPPLE_DURATION_ACTIVE : RIPPLE_DURATION_IDLE}s`,
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export interface OnboardingViewProps {
    onCompleted?: () => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({ onCompleted }) => {
    const { t } = useI18nTranslation('onboarding');
    const {
        screen,
        dispatch,
        finishing,
        hardware,
        advice,
        storagePath,
        storageAvailable,
        choosingStorage,
        handleChooseStorage,
        selectedTier,
        selectTier,
        toggleItem,
        allBundleEntries,
        bundleEntries,
        downloadingBundle,
        overallPercent,
        progressLabel,
        live,
        allReady,
        pendingSizeLabel,
        bundleError,
        remainingLabel,
        cloudQuickOpen,
        setCloudQuickOpen,
        cloudPresetId,
        selectCloudPreset,
        cloudApiKey,
        setCloudApiKey,
        cloudModelId,
        setCloudModelId,
        cloudSaving,
        cloudSavedProvider,
        saveQuickCloudSetup,
        downloadBundle,
        cancelBundleDownload,
        openManualGuide,
        finishOnboarding,
        copyText,
        openUrl,
        openFolder,
    } = useOnboardingBundle();

    const gpuLabel = React.useMemo(() => {
        if (!hardware) return '';
        if (hardware.gpuAcceleration === 'metal') return t('hardware.gpuMetal');
        if (hardware.gpuAcceleration === 'vulkan') return t('hardware.gpuVulkan');
        return t('hardware.gpuCpu');
    }, [hardware, t]);

    const tierCards: Array<{ key: BundleTierChoice; title: string; desc: string; recommended?: boolean }> = [
        {
            key: 'standard',
            title: t('steps.download.tiers.standardTitle'),
            desc: t('steps.download.tiers.standardDesc'),
            recommended: advice.recommendedOnboardingTier === 'standard',
        },
        {
            key: 'light',
            title: t('steps.download.tiers.lightTitle'),
            desc: t('steps.download.tiers.lightDesc'),
            recommended: advice.recommendedOnboardingTier === 'light',
        },
        {
            key: 'custom',
            title: t('steps.download.tiers.customTitle'),
            desc: t('steps.download.tiers.customDesc'),
        },
    ];

    const quickPresets = React.useMemo(
        () => QUICK_PRESET_IDS
            .map((id) => CLOUD_AI_PROVIDER_PRESETS.find((preset) => preset.id === id))
            .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset)),
        [],
    );
    const selectedQuickPreset = React.useMemo(
        () => quickPresets.find((preset) => preset.id === cloudPresetId) ?? quickPresets[0],
        [cloudPresetId, quickPresets],
    );
    const quickPresetNeedsKey = selectedQuickPreset
        ? !isLocalLlmEndpoint(selectedQuickPreset.endpoint)
        : true;
    const suitableForLocalAi = React.useMemo(
        () => isHardwareSuitableForLocalAi(hardware),
        [hardware],
    );

    const manualEntries = React.useMemo(
        () => bundleEntries.filter((entry) => entry.urls && entry.urls.length > 0),
        [bundleEntries],
    );

    return (
        <div
            data-testid="onboarding-view"
            className="relative flex h-screen w-full flex-col overflow-hidden bg-body text-primary select-none"
        >
            <header
                className="relative z-20 flex shrink-0 items-center"
                style={{ height: TITLE_BAR_HEIGHT }}
            >
                <TitleBar maximizable={false} className="w-full" />
            </header>

            {screen !== 'done' && <DotRippleBackground active={downloadingBundle} />}

            {finishing && (
                <main className="relative z-10 flex flex-1 items-center justify-center px-8 pb-14">
                    <div
                        role="status"
                        aria-label={t('steps.download.finishing', { defaultValue: '正在完成设置…' })}
                        className="flex w-full max-w-xl flex-col items-center gap-4 text-center"
                    >
                        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-bg/12 text-accent">
                            <Check className="h-7 w-7" />
                        </span>
                        <p className="text-sm text-secondary">
                            {t('steps.download.finishing', { defaultValue: '正在完成设置…' })}
                        </p>
                    </div>
                </main>
            )}

            {screen === 'storage' && (
                <main className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto scrollbar-none px-8 pb-10">
                    <div className="flex w-full max-w-lg flex-col items-center gap-7 text-center">
                        <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-bg/12 text-accent">
                            <span className="absolute inset-0 rounded-full bg-accent-bg/20 blur-2xl" aria-hidden="true" />
                            <Folder className="relative h-7 w-7" />
                        </span>

                        <div className="space-y-2">
                            <h1 className="text-3xl font-bold tracking-tight">{t('steps.storage.heroTitle')}</h1>
                            <p className="text-sm text-secondary leading-relaxed">{t('steps.storage.heroDesc')}</p>
                        </div>

                        {hardware && (
                            <div
                                data-testid="onboarding-hardware-summary"
                                className="flex w-full items-start gap-2.5 rounded-xl border border-border/60 bg-card/70 px-4 py-3 text-left text-sm"
                            >
                                <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                                <div className="min-w-0 space-y-0.5">
                                    <div className="font-medium text-primary">
                                        {t('hardware.summary', {
                                            memory: hardware.totalMemoryGb,
                                            cores: hardware.cpuCount,
                                            gpu: gpuLabel,
                                        })}
                                    </div>
                                    <div className="text-xs text-secondary leading-relaxed">
                                        {advice.recommendedOnboardingTier === 'standard'
                                            ? t('hardware.recommendedStandard')
                                            : t('hardware.recommendedLight')}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="w-full space-y-3.5 rounded-2xl border border-border/70 bg-card/70 p-5 text-left shadow-sm">
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-secondary">{t('steps.storage.pathLabel')}</div>
                                <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-body/60 py-2 pr-2 pl-3.5">
                                    <FolderOpen className="h-4 w-4 shrink-0 text-secondary" />
                                    <span
                                        className="line-clamp-2 min-w-0 flex-1 break-all font-mono text-sm leading-relaxed text-primary"
                                        title={storagePath}
                                    >
                                        {storagePath || t('steps.storage.pathLoading')}
                                    </span>
                                    <Button
                                        label={t('steps.storage.chooseFolder')}
                                        variant="secondary"
                                        size="sm"
                                        isLoading={choosingStorage}
                                        isDisabled={choosingStorage}
                                        onClick={() => { void handleChooseStorage(); }}
                                    />
                                </div>
                            </div>

                            <p className="text-sm text-secondary leading-relaxed">{t('steps.storage.note')}</p>

                            {!storageAvailable && (
                                <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                                    <span>{t('steps.storage.unavailable')}</span>
                                </div>
                            )}
                        </div>

                        <Button
                            label={t('nextStep')}
                            variant="primary"
                            size="lg"
                            endContent={<Icon icon={ArrowRight as unknown as IconType} size="sm" />}
                            onClick={() => dispatch('NEXT')}
                        />
                    </div>
                </main>
            )}

            {screen === 'download' && (
                <>
                    <div className="absolute top-11 left-6 z-20">
                        <Button
                            label={t('steps.manual.back')}
                            variant="ghost"
                            size="sm"
                            isDisabled={downloadingBundle}
                            icon={<Icon icon={ArrowLeft as unknown as IconType} size="sm" />}
                            onClick={() => dispatch('BACK')}
                        />
                    </div>

                    <div className="absolute top-11 right-6 z-20">
                        <Button
                            label={t('steps.download.skip')}
                            variant="ghost"
                            size="sm"
                            isDisabled={finishing || downloadingBundle}
                            onClick={() => { void finishOnboarding(); }}
                        />
                    </div>

                    <main className="relative z-10 flex flex-1 flex-col items-center overflow-y-auto scrollbar-none px-6 pt-12 pb-10">
                        <div className="flex w-full max-w-2xl flex-col items-center gap-5 text-center">
                            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-bg/12 text-accent">
                                <span className="absolute inset-0 rounded-full bg-accent-bg/20 blur-2xl" aria-hidden="true" />
                                <Download className="relative h-6 w-6" />
                            </span>

                            <div className="space-y-1.5">
                                <h1 className="text-2xl font-bold tracking-tight">{t('steps.download.heroTitle')}</h1>
                                <p className="text-sm text-secondary">{t('steps.download.heroDesc')}</p>
                            </div>

                            {/* 方案档位切换 */}
                            <div className="grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-3">
                                {tierCards.map((tier) => {
                                    const active = selectedTier === tier.key;
                                    return (
                                        <button
                                            key={tier.key}
                                            type="button"
                                            disabled={downloadingBundle}
                                            data-testid={`onboarding-tier-${tier.key}`}
                                            onClick={() => selectTier(tier.key)}
                                            className={`flex flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors ${
                                                active
                                                    ? 'border-accent bg-accent-bg/10'
                                                    : 'border-border/70 bg-card/70 hover:bg-card'
                                            } ${downloadingBundle ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold text-primary">{tier.title}</span>
                                                {tier.recommended && (
                                                    <Badge
                                                        variant="info"
                                                        label={t('steps.download.tiers.recommendedBadge')}
                                                    />
                                                )}
                                            </div>
                                            <p className="text-xs leading-relaxed text-secondary">{tier.desc}</p>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* 资源组件明细清单 */}
                            <div className="w-full divide-y divide-border/50 rounded-xl border border-border/70 bg-card/75 text-left">
                                {allBundleEntries.map((entry) => (
                                    <div key={entry.key} className="flex flex-col gap-2 px-4 py-2.5">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex min-w-0 items-start gap-2.5">
                                                <div className="pt-0.5">
                                                    <CheckboxInput
                                                        label={entry.title}
                                                        isLabelHidden
                                                        size="sm"
                                                        value={entry.checked}
                                                        isDisabled={downloadingBundle || !entry.optional}
                                                        onChange={() => toggleItem(entry.key)}
                                                    />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-primary">{entry.title}</div>
                                                    <div className="text-xs text-secondary">{entry.description}</div>
                                                </div>
                                            </div>
                                            <div className="shrink-0">
                                                {entry.ready ? (
                                                    <Badge
                                                        variant="success"
                                                        label={t('steps.download.ready')}
                                                    />
                                                ) : (
                                                    <span className="text-xs font-medium text-secondary tabular-nums">
                                                        {entry.checked ? entry.sizeLabel : '—'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                    </div>
                                ))}
                            </div>

                            {/* 主操作区 */}
                            {downloadingBundle ? (
                                <div className="flex w-full max-w-md flex-col items-center gap-2.5">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-4xl font-semibold tabular-nums tracking-tight">{overallPercent}</span>
                                        <span className="text-lg text-secondary">%</span>
                                    </div>
                                    <ProgressBar
                                        label={t('steps.download.progressLabel', { defaultValue: '下载进度' })}
                                        isLabelHidden
                                        value={overallPercent}
                                        variant="accent"
                                    />
                                    <p className="text-sm text-secondary">
                                        {progressLabel}
                                        {live.speed > 0 ? ` · ${formatSpeed(live.speed)}` : ''}
                                        {remainingLabel ? ` · ${remainingLabel}` : ''}
                                    </p>
                                    <Button
                                        label={t('steps.download.cancel')}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { void cancelBundleDownload(); }}
                                    />
                                </div>
                            ) : allReady ? (
                                <div className="flex flex-col items-center gap-3">
                                    <span className="inline-flex items-center gap-2 text-sm font-medium text-success-text">
                                        <CheckCircle2 className="h-4 w-4" />
                                        {t('steps.download.tiers.allReadyLabel')}
                                    </span>
                                    <Button
                                        label={t('steps.download.finish')}
                                        variant="primary"
                                        size="lg"
                                        isLoading={finishing}
                                        isDisabled={finishing}
                                        icon={<Icon icon={Check as unknown as IconType} size="sm" />}
                                        onClick={() => { void finishOnboarding(); }}
                                    />
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-2.5">
                                    <Button
                                        label={bundleError ? t('steps.download.retry') : t('steps.download.action')}
                                        variant="primary"
                                        size="lg"
                                        isDisabled={finishing}
                                        icon={<Icon icon={Download as unknown as IconType} size="sm" />}
                                        onClick={() => { void downloadBundle(); }}
                                    >
                                        <HStack gap={1.5} align="center">
                                            <span>{bundleError ? t('steps.download.retry') : t('steps.download.action')}</span>
                                            <span className="text-sm font-normal opacity-75">
                                                {t('steps.download.packSize', { size: pendingSizeLabel })}
                                            </span>
                                        </HStack>
                                    </Button>
                                    {bundleError && (
                                        <span className="flex items-center gap-1.5 text-sm text-error">
                                            <XCircle className="h-3.5 w-3.5 shrink-0" />
                                            <span className="break-all">{bundleError}</span>
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* 可选：顺手配置云端 API（低内存设备特别友好） */}
                            <div className="w-full text-left">
                                <button
                                    type="button"
                                    onClick={() => setCloudQuickOpen(!cloudQuickOpen)}
                                    className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-secondary hover:text-primary"
                                >
                                    <Cloud className="h-3.5 w-3.5" />
                                    <span>{t('steps.download.cloud.toggle')}</span>
                                </button>

                                {(cloudQuickOpen || advice.preferCloudLlm) && (
                                    <div className="mt-2.5 space-y-3 rounded-xl border border-border/60 bg-card/75 p-3.5">
                                        {advice.preferCloudLlm && (
                                            <p className="text-xs text-secondary">{t('steps.download.cloud.preferHint')}</p>
                                        )}
                                        <div className="flex flex-wrap gap-1.5">
                                            {quickPresets.map((preset) => (
                                                <Button
                                                    key={preset.id}
                                                    label={preset.name}
                                                    size="sm"
                                                    variant={cloudPresetId === preset.id ? 'primary' : 'secondary'}
                                                    onClick={() => selectCloudPreset(preset.id)}
                                                />
                                            ))}
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <TextInput
                                                label={t('steps.download.cloud.apiKeyLabel')}
                                                type="password"
                                                value={cloudApiKey}
                                                onChange={setCloudApiKey}
                                                placeholder={quickPresetNeedsKey
                                                    ? t('steps.download.cloud.apiKeyPlaceholder')
                                                    : t('steps.download.cloud.apiKeyOptionalPlaceholder')}
                                                size="sm"
                                                width="100%"
                                            />
                                            <TextInput
                                                label="Model"
                                                value={cloudModelId}
                                                onChange={setCloudModelId}
                                                placeholder={t('steps.download.cloud.modelPlaceholder', { defaultValue: '手动输入模型 ID' })}
                                                size="sm"
                                                width="100%"
                                            />
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            {cloudSavedProvider ? (
                                                <span className="inline-flex items-center gap-1.5 text-xs text-success-text">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                    {t('steps.download.cloud.savedBadge', { provider: cloudSavedProvider })}
                                                </span>
                                            ) : (
                                                <span />
                                            )}
                                            <Button
                                                label={cloudSaving ? t('steps.download.cloud.saving') : t('steps.download.cloud.saveButton')}
                                                size="sm"
                                                variant="secondary"
                                                isLoading={cloudSaving}
                                                isDisabled={cloudSaving || (quickPresetNeedsKey && !cloudApiKey.trim()) || !cloudModelId.trim()}
                                                onClick={() => { void saveQuickCloudSetup(); }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {suitableForLocalAi && <AuthorSupportBanner compact suitableForLocalAi />}

                            {manualEntries.length > 0 && (
                                <Button
                                    label={t('steps.models.manualGuideTitle')}
                                    variant="ghost"
                                    size="sm"
                                    icon={<Icon icon={HelpCircle as unknown as IconType} size="sm" />}
                                    onClick={() => { void openManualGuide(); }}
                                />
                            )}
                        </div>
                    </main>
                </>
            )}

            {screen === 'manual' && (
                <main className="relative z-10 flex flex-1 flex-col items-center overflow-y-auto scrollbar-none px-8 py-8">
                    <div className="w-full max-w-2xl space-y-6">
                        <div>
                            <Button
                                label={t('steps.manual.back')}
                                variant="ghost"
                                size="sm"
                                icon={<Icon icon={ArrowLeft as unknown as IconType} size="sm" />}
                                onClick={() => dispatch('CLOSE_MANUAL')}
                            />
                        </div>

                        <div className="space-y-2 text-center">
                            <h1 className="text-2xl font-bold tracking-tight">{t('steps.manual.title')}</h1>
                            <p className="text-sm text-secondary leading-relaxed">{t('steps.manual.desc')}</p>
                        </div>

                        <div className="space-y-4">
                            {manualEntries.map((entry) => (
                                <Card key={entry.key} variant="default" padding={4}>
                                    <VStack gap={4} width="100%">
                                        <Text type="body" weight="semibold">{entry.title}</Text>

                                        <VStack gap={2} width="100%">
                                            <Text type="supporting" color="secondary">{t('steps.manual.addressLabel')}</Text>
                                            {(entry.urls ?? []).map((url, index) => (
                                                <Card key={url} variant="muted" padding={3}>
                                                    <VStack gap={2} width="100%">
                                                        <HStack gap={2} align="start">
                                                            {index > 0 && (
                                                                <span className="mt-0.5 shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-metadata font-medium text-warning-text">
                                                                    {t('steps.models.backupSource')}
                                                                </span>
                                                            )}
                                                            <span className="font-mono text-metadata break-all text-secondary">{url}</span>
                                                        </HStack>
                                                        <HStack gap={2} align="center">
                                                            <Button
                                                                label={t('steps.models.copyLink')}
                                                                variant="secondary"
                                                                size="sm"
                                                                icon={<Icon icon={Copy as unknown as IconType} size="sm" />}
                                                                onClick={() => { void copyText(url); }}
                                                            />
                                                            <Button
                                                                label={t('steps.models.openInBrowser')}
                                                                variant="secondary"
                                                                size="sm"
                                                                icon={<Icon icon={ExternalLink as unknown as IconType} size="sm" />}
                                                                onClick={() => { void openUrl(url); }}
                                                            />
                                                        </HStack>
                                                    </VStack>
                                                </Card>
                                            ))}
                                        </VStack>

                                        {entry.targetPath && (
                                            <VStack gap={2} width="100%">
                                                <Text type="supporting" color="secondary">{t('steps.manual.targetLabel')}</Text>
                                                <Card variant="muted" padding={3}>
                                                    <VStack gap={2} width="100%">
                                                        <span className="font-mono text-metadata break-all text-secondary">{entry.targetPath}</span>
                                                        <HStack gap={2} align="center">
                                                            <Button
                                                                label={t('steps.models.copyPath')}
                                                                variant="secondary"
                                                                size="sm"
                                                                icon={<Icon icon={Copy as unknown as IconType} size="sm" />}
                                                                onClick={() => { void copyText(entry.targetPath as string); }}
                                                            />
                                                            <Button
                                                                label={t('steps.models.openFolder')}
                                                                variant="secondary"
                                                                size="sm"
                                                                icon={<Icon icon={FolderOpen as unknown as IconType} size="sm" />}
                                                                onClick={() => { void openFolder(entry.targetPath as string); }}
                                                            />
                                                        </HStack>
                                                    </VStack>
                                                </Card>
                                            </VStack>
                                        )}
                                    </VStack>
                                </Card>
                            ))}
                        </div>

                        <p className="pb-2 text-center text-sm text-secondary leading-relaxed">
                            {t('steps.manual.footer')}
                        </p>
                    </div>
                </main>
            )}

            {screen === 'done' && (
                <main className="relative z-10 flex flex-1 flex-col items-center overflow-y-auto scrollbar-none px-8 py-10">
                    <Confetti />
                    <div className="w-full max-w-2xl space-y-6">
                        <div className="space-y-2 text-center">
                            <div className="flex justify-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-bg/15 text-accent">
                                    <Check className="h-6 w-6" />
                                </span>
                            </div>
                            <h3 className="text-lg font-semibold">{t('steps.done.title')}</h3>
                            <p className="text-sm text-secondary leading-relaxed">{t('steps.done.desc')}</p>
                        </div>

                        <div className="space-y-3">
                            <div className="space-y-1 text-center sm:text-left">
                                <h3 className="flex items-center justify-center gap-2 text-base font-semibold sm:justify-start">
                                    <FileVideo className="w-4 h-4 text-accent" />
                                    {t('steps.tutorial.title')}
                                </h3>
                                <p className="text-sm text-secondary">{t('steps.tutorial.desc')}</p>
                            </div>

                            <div className="space-y-3 pt-1">
                                <div className="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                                        <Folder className="w-4 h-4 shrink-0 text-accent" />
                                        <span>{t('steps.tutorial.method1Title')}</span>
                                    </div>
                                    <p className="text-sm text-secondary leading-relaxed">{t('steps.tutorial.method1Desc')}</p>
                                    <div className="rounded-lg border border-border/40 bg-muted/60 p-2.5 text-sm text-primary/90">
                                        {t('steps.tutorial.method1Tip')}
                                    </div>
                                </div>

                                <div className="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                                        <FileVideo className="w-4 h-4 shrink-0 text-accent" />
                                        <span>{t('steps.tutorial.method2Title')}</span>
                                    </div>
                                    <p className="text-sm text-secondary leading-relaxed">{t('steps.tutorial.method2Desc')}</p>
                                    <div className="rounded-lg border border-border/40 bg-muted/60 p-2.5 text-sm text-primary/90">
                                        {t('steps.tutorial.method2Tip')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button
                                label={t('startUsing')}
                                variant="primary"
                                size="sm"
                                endContent={<Icon icon={ArrowRight as unknown as IconType} size="sm" />}
                                onClick={onCompleted}
                            />
                        </div>
                    </div>
                </main>
            )}
        </div>
    );
};

export default OnboardingView;
