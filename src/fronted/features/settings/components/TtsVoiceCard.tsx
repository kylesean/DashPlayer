import { useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';

import { settingsApi } from '@/fronted/features/settings/settingsApi';
import type { TtsVoiceVO } from '@/common/contracts/tts-voice';

interface TtsVoiceCardProps {
    /**
     * 音色切换后的回调。
     *
     * 上方资源包卡片展示的是「当前选中音色」的安装状态，切换后必须让它
     * 重新拉取，否则会出现下拉框显示英音、卡片仍显示美音已就绪的错位。
     */
    onVoiceChange?: () => void;
}

/**
 * 离线朗读音色选择。
 *
 * 只负责「选哪个音色」；模型下载仍由资源包卡片统一管理——音色选择与
 * 模型安装是两件事，混在一起会让用户以为切换下拉框就会自动下载几十兆。
 *
 * @param props 组件属性。
 */
export default function TtsVoiceCard({ onVoiceChange }: TtsVoiceCardProps) {
    const { t } = useTranslation('settings');
    const { data, isLoading, mutate } = useSWR(
        'sherpa-tts/voices',
        () => settingsApi.listTtsVoices(),
        { revalidateOnFocus: false },
    );

    const options = useMemo(() => (data?.voices ?? []).map((voice: TtsVoiceVO) => ({
        value: voice.id,
        label: voiceLabel(voice, t),
    })), [data?.voices, t]);

    const selected = data?.selected ?? '';
    const selectedVoice = data?.voices.find((voice) => voice.id === selected);

    const handleChange = async (voiceId: string) => {
        try {
            await settingsApi.selectTtsVoice(voiceId);
            await mutate();
            onVoiceChange?.();
            const voice = data?.voices.find((item) => item.id === voiceId);
            if (voice && !voice.installed) {
                // 切换不触发下载：明确告诉用户下一步做什么，而不是静默失败。
                toast(t('resources.ttsVoice.notInstalled'), { icon: '⬇️' });
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
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
                            width="220px"
                            value={selected}
                            onChange={(value) => { void handleChange(value); }}
                            isDisabled={isLoading || options.length === 0}
                            options={options}
                        />
                    </div>
                </HStack>
                {selectedVoice && !selectedVoice.installed && (
                    <div className="border-t border-border/50 px-3 py-2">
                        <Text type="supporting" color="secondary">
                            {t('resources.ttsVoice.downloadHint')}
                        </Text>
                    </div>
                )}
            </VStack>
        </Card>
    );
}

/**
 * 生成音色的人类可读名称。
 *
 * 例：`美音 · 女声 · 标准`。口音放在最前，因为这是学习者最先关心的差异。
 *
 * @param voice 音色。
 * @param t 翻译函数。
 * @returns 展示用名称。
 */
function voiceLabel(voice: TtsVoiceVO, t: (key: string) => string): string {
    const accent = voice.accent === 'en-GB' ? t('resources.ttsVoice.accentGB') : t('resources.ttsVoice.accentUS');
    const gender = voice.gender === 'male' ? t('resources.ttsVoice.male') : t('resources.ttsVoice.female');
    const quality = voice.quality === 'low'
        ? t('resources.ttsVoice.qualityLow')
        : voice.quality === 'high'
            ? t('resources.ttsVoice.qualityHigh')
            : t('resources.ttsVoice.qualityMedium');
    const suffix = voice.installed ? '' : ` · ${t('resources.ttsVoice.notInstalledShort')}`;
    return `${accent} · ${gender} · ${quality}${suffix}`;
}
