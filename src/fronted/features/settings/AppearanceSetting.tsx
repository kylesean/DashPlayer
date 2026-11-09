import React, { useState, useEffect } from 'react';
import {
    SliderInput,
    SettingCard,
    SettingRow,
    SettingsLoadingSkeleton,
} from '@/fronted/features/settings/components/form';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { useForm, useWatch } from 'react-hook-form';
import { SETTINGS_DETAIL_SWR_OPTIONS, settingsApi } from '@/fronted/features/settings/settingsApi';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { applyLanguageSetting } from '@/fronted/i18n';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';
import useSWR from 'swr';
import type { AppearanceSettingVO } from '@/common/contracts/appearance-setting-vo';
import { Columns2, Globe, Laptop, Moon, Palette, PanelLeft, PanelRight, Sun, Type } from 'lucide-react';
import { SelectableCard } from '@astryxdesign/core/SelectableCard';
import { Grid } from '@astryxdesign/core/Grid';
import { Selector } from '@astryxdesign/core/Selector';
import {
    SegmentedControl,
    SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';

const logger = getRendererLogger('AppearanceSetting');
type AppearanceFormValues = AppearanceSettingVO;

/**
 * 外观偏好设置组件。
 *
 * 全面迁移至 Astryx UI 体系：
 * - 主题选择：采用 SelectableCard 网格单选卡片。
 * - 界面语言：采用 Selector 下拉单选组件。
 * - 字号档位与预览模式：采用 SegmentedControl 分段切换。
 * - 预览容器与布局：采用 Card、VStack、HStack、Text 等 Astryx 原语。
 *
 * @returns 外观设置 JSX 元素。
 */
const AppearanceSetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');

    const { data: settings } = useSWR<AppearanceSettingVO>(
        'settings/appearance/detail',
        () => settingsApi.getAppearance(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );

    const form = useForm<AppearanceFormValues>();
    const { setValue } = form;
    const [currentTheme, currentThemeFamily, currentFontSize, currentLanguage, currentTranscriptPosition] = useWatch({
        control: form.control,
        name: ['theme', 'themeFamily', 'fontSize', 'language', 'transcriptPosition'],
    });

    const { ready, initialize, flush } = useAutoSaveSettingsForm<AppearanceFormValues>({
        form,
        detailKey: 'settings/appearance/detail',
        onSave: async (values) => {
            logger.debug('saving appearance settings', { values });
            await settingsApi.saveAppearance(values);
        },
    });

    const [previewMode, setPreviewMode] = useState<string>('main');

    useEffect(() => {
        if (!settings) {
            return;
        }
        initialize(settings);
    }, [initialize, settings]);

    if (!ready) {
        return (
            <SettingsLoadingSkeleton
                title={t('appearance.title')}
                description={t('appearance.description')}
            />
        );
    }

    if (currentTheme === undefined || currentFontSize === undefined || currentLanguage === undefined) {
        throw new Error('外观设置表单未初始化');
    }

    const fontSizeOptions: Record<AppearanceFormValues['fontSize'], string> = {
        fontSizeSmall: t('appearance.fontSizeSmall'),
        fontSizeMedium: t('appearance.fontSizeMedium'),
        fontSizeLarge: t('appearance.fontSizeLarge'),
    };

    const themeOptions = [
        {
            value: 'system' as const,
            label: t('appearance.themeSystem'),
            icon: Laptop,
        },
        {
            value: 'dark' as const,
            label: t('appearance.themeDark'),
            icon: Moon,
        },
        {
            value: 'light' as const,
            label: t('appearance.themeLight'),
            icon: Sun,
        },
    ];

    const themeFamilyOptions = [
        {
            value: 'neutral' as const,
            label: 'Neutral',
            desc: t('appearance.themeNeutralDesc'),
            // 取色点必须用主题真实 accent，并区分 light/dark，避免"选米色出蓝按钮"
            previewColor: 'light-dark(#1b1b1b, #f1f1f1)',
        },
        {
            value: 'stone' as const,
            label: 'Stone',
            desc: t('appearance.themeStoneDesc'),
            previewColor: 'light-dark(#25252a, #f0f0f9)',
        },
        {
            value: 'gothic' as const,
            label: 'Gothic',
            desc: t('appearance.themeGothicDesc'),
            previewColor: 'light-dark(#e8f1f6, #e8f1f6)',
        },
        {
            value: 'matcha' as const,
            label: 'Matcha',
            desc: t('appearance.themeMatchaDesc'),
            previewColor: 'light-dark(#3e481d, #c0cba9)',
        },
        {
            value: 'y2k' as const,
            label: 'Y2K',
            desc: t('appearance.themeY2kDesc'),
            // Y2K 的记忆点是长春花蓝页面，而不是深棕 accent
            previewColor: 'light-dark(#cccffa, #edeffc)',
        },
        {
            value: 'butter' as const,
            label: 'Butter',
            desc: t('appearance.themeButterDesc'),
            previewColor: 'light-dark(#225bff, #fdee8c)',
        },
        {
            value: 'chocolate' as const,
            label: 'Chocolate',
            desc: t('appearance.themeChocolateDesc'),
            previewColor: 'light-dark(#8c5927, #d4a06a)',
        },
    ];

    /** 当前选中的主题；用于在网格下方展示一行说明，避免每张卡都塞说明导致高度不一。 */
    const selectedThemeFamily = themeFamilyOptions.find(
        (opt) => opt.value === (currentThemeFamily || 'neutral'),
    );

    /** Gothic 是深色专用主题：色彩模式选项禁用，避免用户以为浅色没生效。 */
    const isDarkOnlyTheme = currentThemeFamily === 'gothic';
    /** 深色专用主题下，色彩模式始终显示为深色（保存值不变，切回其他主题后恢复）。 */
    const selectedThemeMode = isDarkOnlyTheme ? 'dark' : currentTheme;

    const languageOptions = [
        { value: 'system', label: t('appearance.languageSystem') },
        { value: 'zh-CN', label: t('appearance.languageZhCN') },
        { value: 'en-US', label: t('appearance.languageEnUS') },
    ];

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                flush().catch((error) => {
                    logger.error('flush appearance settings failed', { error });
                });
            }}
        >
            <SettingsPageShell
                title={t('appearance.title')}
                description={t('appearance.description')}
            >
                <SettingCard
                    title={t('appearance.cardTitle')}
                    description={t('appearance.cardDescription')}
                    icon={Palette}
                >
                    {/* 设计主题：只保留统一的色点 + 名称，说明放到网格下方一行，
                        避免每张卡各写一段说明导致卡片高度参差、换行错位 */}
                    <VStack paddingInline={4} paddingBlock={3} gap={2} width="100%">
                        <HStack gap={2} align="center">
                            <Icon icon={Palette} size="sm" color="secondary" />
                            <VStack gap={0.5}>
                                <Text type="body" weight="medium">
                                    {t('appearance.themeFamilyTitle')}
                                </Text>
                                <Text type="supporting" color="secondary">
                                    {t('appearance.themeFamilyDescription')}
                                </Text>
                            </VStack>
                        </HStack>
                        <Grid
                            columns={{ minWidth: 120, max: 4 }}
                            gap={2}
                            width="100%"
                        >
                            {themeFamilyOptions.map((opt) => {
                                const isSelected = (currentThemeFamily || 'neutral') === opt.value;
                                return (
                                    <SelectableCard
                                        key={opt.value}
                                        label={opt.label}
                                        isSelected={isSelected}
                                        height={64}
                                        padding={2}
                                        onChange={() => {
                                            if (!isSelected) {
                                                setValue('themeFamily', opt.value, {
                                                    shouldDirty: true,
                                                    shouldTouch: true,
                                                });
                                            }
                                        }}
                                    >
                                        <HStack vAlign="center" justify="center" gap={2} height="100%">
                                            <span
                                                className="h-3.5 w-3.5 shrink-0 rounded-[50%] shadow-xs ring-1 ring-border"
                                                style={{ backgroundColor: opt.previewColor }}
                                            />
                                            <Text
                                                type="body"
                                                weight={isSelected ? 'bold' : 'medium'}
                                                color={isSelected ? 'primary' : 'secondary'}
                                            >
                                                {opt.label}
                                            </Text>
                                        </HStack>
                                    </SelectableCard>
                                );
                            })}
                        </Grid>
                        {selectedThemeFamily && (
                            <Text type="supporting" color="secondary">
                                {selectedThemeFamily.desc}
                            </Text>
                        )}
                    </VStack>

                    {/* 浅色/深色模式切换行 */}
                    <SettingRow
                        title={t('appearance.themeTitle')}
                        description={
                            isDarkOnlyTheme
                                ? t('appearance.darkOnlyThemeHint')
                                : t('appearance.themeDescription')
                        }
                        icon={Palette}
                    >
                        <Grid
                            columns={{ minWidth: 96, max: 3 }}
                            gap={2}
                            maxWidth={360}
                        >
                            {themeOptions.map((opt) => {
                                const isSelected = selectedThemeMode === opt.value;
                                return (
                                    <SelectableCard
                                        key={opt.value}
                                        label={opt.label}
                                        isSelected={isSelected}
                                        isDisabled={isDarkOnlyTheme}
                                        padding={2}
                                        onChange={() => {
                                            if (isDarkOnlyTheme) {
                                                return;
                                            }
                                            if (!isSelected) {
                                                setValue('theme', opt.value, {
                                                    shouldDirty: true,
                                                    shouldTouch: true,
                                                });
                                            }
                                        }}
                                    >
                                        <VStack gap={1.5} align="center" justify="center">
                                            <Icon icon={opt.icon} size="sm" color={isSelected ? 'accent' : 'secondary'} />
                                            <Text
                                                type="supporting"
                                                weight={isSelected ? 'semibold' : undefined}
                                                color={isSelected ? 'primary' : 'secondary'}
                                            >
                                                {opt.label}
                                            </Text>
                                        </VStack>
                                    </SelectableCard>
                                );
                            })}
                        </Grid>
                    </SettingRow>

                    {/* 界面语言行 */}
                    <SettingRow
                        title={t('appearance.languageTitle')}
                        description={t('appearance.languageDescription')}
                        icon={Globe}
                    >
                        <Selector
                            label={t('appearance.languageTitle')}
                            isLabelHidden
                            value={currentLanguage}
                            options={languageOptions}
                            width={192}
                            size="sm"
                            onChange={(val) => {
                                setValue('language', val as AppearanceFormValues['language'], {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                });
                                applyLanguageSetting(val).catch(() => undefined);
                            }}
                        />
                    </SettingRow>

                    {/* 字幕字号行 */}
                    <SettingRow
                        title={t('appearance.fontSizeTitle')}
                        description={t('appearance.fontSizeDescription')}
                        icon={Type}
                    >
                        <SliderInput
                            values={['fontSizeSmall', 'fontSizeMedium', 'fontSizeLarge']}
                            valueLabelMap={fontSizeOptions}
                            defaultValue={currentFontSize}
                            setValue={(v) => {
                                if (v === 'fontSizeSmall' || v === 'fontSizeMedium' || v === 'fontSizeLarge') {
                                    setValue('fontSize', v, { shouldDirty: true, shouldTouch: true });
                                }
                            }}
                        />
                    </SettingRow>

                    {/* 伴读剧本流停靠方位行 */}
                    <SettingRow
                        title={t('appearance.transcriptPositionTitle')}
                        description={t('appearance.transcriptPositionDescription')}
                        icon={Columns2}
                    >
                        <Grid
                            columns={{ minWidth: 120, max: 2 }}
                            gap={2}
                            maxWidth={320}
                        >
                            <SelectableCard
                                label={t('appearance.transcriptPositionRight')}
                                isSelected={(currentTranscriptPosition || 'right') === 'right'}
                                padding={2}
                                onChange={() => {
                                    if (currentTranscriptPosition !== 'right') {
                                        setValue('transcriptPosition', 'right', {
                                            shouldDirty: true,
                                            shouldTouch: true,
                                        });
                                    }
                                }}
                            >
                                <VStack gap={1.5} align="center" justify="center">
                                    <Icon
                                        icon={PanelRight as unknown as Parameters<typeof Icon>[0]['icon']}
                                        size="sm"
                                        color={(currentTranscriptPosition || 'right') === 'right' ? 'accent' : 'secondary'}
                                    />
                                    <Text
                                        type="supporting"
                                        weight={(currentTranscriptPosition || 'right') === 'right' ? 'semibold' : undefined}
                                        color={(currentTranscriptPosition || 'right') === 'right' ? 'primary' : 'secondary'}
                                    >
                                        {t('appearance.transcriptPositionRight')}
                                    </Text>
                                </VStack>
                            </SelectableCard>

                            <SelectableCard
                                label={t('appearance.transcriptPositionLeft')}
                                isSelected={currentTranscriptPosition === 'left'}
                                padding={2}
                                onChange={() => {
                                    if (currentTranscriptPosition !== 'left') {
                                        setValue('transcriptPosition', 'left', {
                                            shouldDirty: true,
                                            shouldTouch: true,
                                        });
                                    }
                                }}
                            >
                                <VStack gap={1.5} align="center" justify="center">
                                    <Icon
                                        icon={PanelLeft as unknown as Parameters<typeof Icon>[0]['icon']}
                                        size="sm"
                                        color={currentTranscriptPosition === 'left' ? 'accent' : 'secondary'}
                                    />
                                    <Text
                                        type="supporting"
                                        weight={currentTranscriptPosition === 'left' ? 'semibold' : undefined}
                                        color={currentTranscriptPosition === 'left' ? 'primary' : 'secondary'}
                                    >
                                        {t('appearance.transcriptPositionLeft')}
                                    </Text>
                                </VStack>
                            </SelectableCard>
                        </Grid>
                    </SettingRow>

                    {/* 实时字幕预览区域 */}
                    <VStack padding={4} gap={3} width="100%">
                        <HStack justify="between" align="center" width="100%">
                            <VStack gap={0.5}>
                                <Text type="supporting" weight="semibold" color="secondary">
                                    {t('appearance.subtitlePreviewTitle')}
                                </Text>
                                <Text type="supporting" color="secondary">
                                    {t('appearance.subtitlePreviewHint')}
                                </Text>
                            </VStack>

                            <SegmentedControl
                                label={t('appearance.subtitlePreviewTitle')}
                                value={previewMode}
                                onChange={setPreviewMode}
                                size="sm"
                            >
                                <SegmentedControlItem
                                    value="main"
                                    label={t('appearance.subtitlePreviewMain')}
                                />
                                <SegmentedControlItem
                                    value="side"
                                    label={t('appearance.subtitlePreviewSide')}
                                />
                            </SegmentedControl>
                        </HStack>

                        <Card variant="default" padding={4} width="100%">
                            {previewMode === 'main' ? (
                                <VStack gap={2} align="center" justify="center" padding={2}>
                                    <Text
                                        type="large"
                                        size={currentFontSize === 'fontSizeSmall' ? 'base' : currentFontSize === 'fontSizeLarge' ? '2xl' : 'lg'}
                                        weight="medium"
                                        justify="center"
                                    >
                                        Every journey begins with a single bold step.
                                    </Text>
                                    <Text
                                        type="body"
                                        color="secondary"
                                        size={currentFontSize === 'fontSizeSmall' ? 'sm' : currentFontSize === 'fontSizeLarge' ? 'xl' : 'base'}
                                        justify="center"
                                    >
                                        每一个伟大的旅程，都始于勇敢迈出的第一步。
                                    </Text>
                                </VStack>
                            ) : (
                                <VStack gap={2} align="center" justify="center" padding={2}>
                                    <Card variant="muted" padding={3} maxWidth={420} width="100%">
                                        <VStack gap={1} align="center">
                                            <Text
                                                type="body"
                                                weight="medium"
                                                size={currentFontSize === 'fontSizeSmall' ? 'xsm' : currentFontSize === 'fontSizeLarge' ? 'base' : 'sm'}
                                                justify="center"
                                            >
                                                Every journey begins with a single bold step.
                                            </Text>
                                            <Text
                                                type="supporting"
                                                color="secondary"
                                                size={currentFontSize === 'fontSizeSmall' ? '4xs' : currentFontSize === 'fontSizeLarge' ? 'sm' : 'xsm'}
                                                justify="center"
                                            >
                                                每一个伟大的旅程，都始于勇敢迈出的第一步。
                                            </Text>
                                        </VStack>
                                    </Card>
                                </VStack>
                            )}
                        </Card>
                    </VStack>
                </SettingCard>
            </SettingsPageShell>
        </form>
    );
};

export default AppearanceSetting;
