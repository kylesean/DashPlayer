import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Download, Square, Volume2 } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import { settingsApi } from '@/frontend/features/settings/settingsApi';
import {
    cancelPackDownload,
    startPackDownload,
    updatePackCallbacks,
    usePackDownloadState,
} from '@/frontend/features/settings/resourcePackDownloadStore';
import { clearTtsAudioCache, getTtsUrl, playAudioUrl } from '@/frontend/infrastructure/audio/AudioPlayer';
import { useAudioVolume } from '@/frontend/infrastructure/audio/audioVolume';
import type { TtsVoiceVO } from '@/common/contracts/tts-voice';

const TTS_VOICE_DOWNLOAD_ID = 'settings-tts-voice';
const RECOMMENDED_KOKORO_VOICE_ID = 'kokoro-en-US-bella';
const TTS_PREVIEW_SAMPLE = 'Hello, welcome to Refrain.';

interface TtsVoiceCardProps {
    /** 音色切换或安装完成后的回调，用于同步刷新上方资源包卡片。 */
    onVoiceChange?: () => void;
}

/**
 * 离线朗读音色选择与直达下载卡片。
 */
export default function TtsVoiceCard({ onVoiceChange }: TtsVoiceCardProps) {
    const { t } = useTranslation('settings');
    const { data, isLoading, mutate } = useSWR(
        'sherpa-tts/voices',
        () => settingsApi.listTtsVoices(),
        { revalidateOnFocus: false },
    );

    const { downloading, live, error } = usePackDownloadState(TTS_VOICE_DOWNLOAD_ID);

    const refreshAll = useCallback(() => {
        void mutate();
        onVoiceChange?.();
    }, [mutate, onVoiceChange]);

    const handleDownloadComplete = useCallback(() => {
        clearTtsAudioCache();
        toast.success(t('resources.ttsVoice.downloadedToast'));
        refreshAll();
    }, [refreshAll, t]);

    useEffect(() => {
        updatePackCallbacks(TTS_VOICE_DOWNLOAD_ID, {
            onRefresh: refreshAll,
            onComplete: handleDownloadComplete,
        });
    }, [refreshAll, handleDownloadComplete]);

    const options = useMemo(() => (data?.voices ?? []).map((voice: TtsVoiceVO) => ({
        value: voice.id,
        label: voiceLabel(voice, t),
    })), [data?.voices, t]);

    const selected = data?.selected ?? '';
    const selectedVoice = data?.voices.find((voice) => voice.id === selected);
    const recommendedUpgradeVoice = data?.voices.find(
        (voice) => voice.id === RECOMMENDED_KOKORO_VOICE_ID && !voice.installed,
    );
    const showUpgradePrompt = Boolean(
        selectedVoice
        && selectedVoice.installed
        && selectedVoice.quality !== 'high'
        && recommendedUpgradeVoice,
    );

    const startVoiceDownload = async () => {
        if (downloading) return;
        await startPackDownload({
            packId: TTS_VOICE_DOWNLOAD_ID,
            entries: [{
                key: 'tts',
                download: async () => { await settingsApi.downloadSherpaTtsModel(); },
                cancel: async () => { await settingsApi.cancelSherpaTtsModelDownload(); },
            }],
            onRefresh: refreshAll,
            onComplete: handleDownloadComplete,
        });
    };

    const handleChange = async (voiceId: string, autoDownload = false) => {
        try {
            await settingsApi.selectTtsVoice(voiceId);
            clearTtsAudioCache();
            await mutate();
            onVoiceChange?.();
            if (autoDownload) {
                await startVoiceDownload();
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <Card padding={0} width="100%" variant="muted">
            <VStack gap={0}>
                <HStack gap={3} align="center" justify="between" className="px-3 py-2.5">
                    <VStack gap={0.5} className="min-w-0">
                        <Text type="label">{t('resources.ttsVoice.title')}</Text>
                        <Text type="supporting" color="secondary">
                            {t('resources.ttsVoice.description')}
                        </Text>
                    </VStack>
                    <div className="shrink-0">
                        <Selector
                            label={t('resources.ttsVoice.title')}
                            isLabelHidden
                            size="sm"
                            width="260px"
                            value={selected}
                            onChange={(value) => { void handleChange(value); }}
                            isDisabled={isLoading || downloading || options.length === 0}
                            options={options}
                        />
                    </div>
                </HStack>

                {selectedVoice && !selectedVoice.installed && (
                    <div className="border-t border-border/50 px-3 py-2.5">
                        <VStack gap={2}>
                            <HStack gap={3} align="center" justify="between" wrap="wrap">
                                <Text type="supporting" color="secondary" className="min-w-0 flex-1">
                                    {t('resources.ttsVoice.downloadHint')}
                                </Text>
                                <Button
                                    size="sm"
                                    variant={downloading ? 'secondary' : 'primary'}
                                    icon={<Icon icon={(downloading ? Square : Download) as unknown as IconType} size="sm" />}
                                    label={downloading
                                        ? t('resources.ttsVoice.cancelDownload')
                                        : t('resources.ttsVoice.downloadButton')}
                                    onClick={() => {
                                        if (downloading) {
                                            void cancelPackDownload(TTS_VOICE_DOWNLOAD_ID);
                                        } else {
                                            void startVoiceDownload();
                                        }
                                    }}
                                />
                            </HStack>
                            {downloading && (
                                <VStack gap={1}>
                                    <ProgressBar
                                        label="Voice Download Progress"
                                        value={live.percent}
                                        max={100}
                                        isLabelHidden
                                    />
                                    <Text type="supporting" color="secondary" hasTabularNumbers>
                                        {t('resources.ttsVoice.downloadingVoice', { percent: live.percent })}
                                    </Text>
                                </VStack>
                            )}
                            {error && (
                                <Banner status="error" title={error} />
                            )}
                        </VStack>
                    </div>
                )}

                <TtsVolumeRow canPreview={Boolean(selectedVoice?.installed)} />

                {showUpgradePrompt && (
                    <div className="border-t border-border/50 px-3 py-2.5">
                        <HStack gap={3} align="center" justify="between" wrap="wrap">
                            <Text type="supporting" color="secondary" className="min-w-0 flex-1">
                                {t('resources.ttsVoice.upgradeHint')}
                            </Text>
                            <Button
                                size="sm"
                                variant="secondary"
                                icon={<Icon icon={Download as unknown as IconType} size="sm" />}
                                isDisabled={downloading}
                                label={t('resources.ttsVoice.upgradeAction')}
                                onClick={() => { void handleChange(RECOMMENDED_KOKORO_VOICE_ID, true); }}
                            />
                        </HStack>
                    </div>
                )}
            </VStack>
        </Card>
    );
}

/**
 * 生成音色的人类可读名称。
 *
 * 例：`美音 · 女声 · 高清 · Kokoro Bella`。口音放在最前，因为这是学习者最先关心的差异。
 */
function voiceLabel(voice: TtsVoiceVO, t: (key: string) => string): string {
    const accent = voice.accent === 'en-GB' ? t('resources.ttsVoice.accentGB') : t('resources.ttsVoice.accentUS');
    const gender = voice.gender === 'male' ? t('resources.ttsVoice.male') : t('resources.ttsVoice.female');
    const quality = voice.quality === 'low'
        ? t('resources.ttsVoice.qualityLow')
        : voice.quality === 'high'
            ? t('resources.ttsVoice.qualityHigh')
            : t('resources.ttsVoice.qualityMedium');
    const namePart = voice.name ? ` · ${voice.name}` : '';
    const suffix = voice.installed ? '' : ` · ${t('resources.ttsVoice.notInstalledShort')}`;
    return `${accent} · ${gender} · ${quality}${namePart}${suffix}`;
}

function TtsVolumeRow({ canPreview }: { canPreview: boolean }) {
    const { t } = useTranslation('settings');
    const ttsVolume = useAudioVolume((s) => s.ttsVolume);
    const setTtsVolume = useAudioVolume((s) => s.setTtsVolume);
    const [previewing, setPreviewing] = useState(false);
    const pct = Math.round(ttsVolume * 100);

    const handlePreview = async () => {
        if (!canPreview || previewing) return;
        setPreviewing(true);
        try {
            clearTtsAudioCache();
            const url = await getTtsUrl(TTS_PREVIEW_SAMPLE);
            await playAudioUrl(url);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error(t('resources.ttsVoice.previewFailed', { defaultValue: '试听失败：{{msg}}', msg }));
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <div className="border-t border-border/50 px-3 py-2.5">
            <HStack gap={3} align="center" justify="between" wrap="wrap">
                <Text size="sm" color="primary">
                    {t('resources.ttsVoice.volumeLabel', { defaultValue: 'TTS 朗读音量' })}
                </Text>
                <HStack gap={2} align="center">
                    <HStack gap={2} align="center" className="w-44">
                        <input
                            type="range"
                            aria-label={t('resources.ttsVoice.volumeLabel', { defaultValue: 'TTS 朗读音量' })}
                            min={10}
                            max={100}
                            step={5}
                            value={pct}
                            onChange={(e) => setTtsVolume(Number(e.target.value) / 100)}
                            className="flex-1 accent-accent-bg cursor-pointer"
                        />
                        <Text type="supporting" color="secondary" hasTabularNumbers className="w-10 text-right">
                            {pct}%
                        </Text>
                    </HStack>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<Icon icon={Volume2 as unknown as IconType} size="sm" />}
                        isDisabled={!canPreview || previewing}
                        label={previewing
                            ? t('resources.ttsVoice.previewing', { defaultValue: '合成中…' })
                            : t('resources.ttsVoice.previewAction', { defaultValue: '试听' })}
                        onClick={() => { void handlePreview(); }}
                    />
                </HStack>
            </HStack>
        </div>
    );
}
