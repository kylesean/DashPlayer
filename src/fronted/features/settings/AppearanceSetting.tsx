import React, { useState, useEffect } from 'react';
import {
    SettingField,
    SettingSection,
    SettingsLoadingSkeleton,
} from '@/fronted/features/settings/components/form';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { useForm, useWatch } from 'react-hook-form';
import { SETTINGS_DETAIL_SWR_OPTIONS, settingsApi } from '@/fronted/features/settings/settingsApi';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { applyLanguageSetting } from '@/fronted/i18n';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';
import { THEME_PREVIEW_COLORS } from '@/fronted/app/themeFamilies';
import useSWR from 'swr';
import type { AppearanceSettingVO } from '@/common/contracts/appearance-setting-vo';
import { Captions, Laptop, Moon, Palette, PanelLeft, PanelRight, SlidersHorizontal, Sun } from 'lucide-react';
import { Grid } from '@astryxdesign/core/Grid';
import { Selector } from '@astryxdesign/core/Selector';
import {
    SegmentedControl,
    SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { CardRadio, CardRadioGroup } from '@/fronted/components/shared/common/CardRadioGroup';
import { SETTING_ROW_TESTIDS } from '@/common/constants/qa-testids';

const logger = getRendererLogger('AppearanceSetting');
type AppearanceFormValues = AppearanceSettingVO;

/**
 * 外观偏好设置组件。
 *
 * 全面迁移至 Astryx UI 体系：
 * - 主题选择：采用 CardRadioGroup 卡片单选组，保留色点预览与选中描边。
 * - 界面语言：采用 Selector 下拉单选组件。
 * - 字号档位与预览模式：采用 SegmentedControl 分段切换。
 * - 预览容器与布局：采用 Card、VStack、HStack、Text 等 Astryx 原语。
 *
 * @returns 外观设置 JSX 元素。
 */
const APPEARANCE_FONT_SIZES: AppearanceFormValues['fontSize'][] = ['fontSizeSmall', 'fontSizeMedium', 'fontSizeLarge'];

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
            previewColor: THEME_PREVIEW_COLORS.neutral,
        },
        {
            value: 'stone' as const,
            label: 'Stone',
            desc: t('appearance.themeStoneDesc'),
            previewColor: THEME_PREVIEW_COLORS.stone,
        },
        {
            value: 'gothic' as const,
            label: 'Gothic',
            desc: t('appearance.themeGothicDesc'),
            previewColor: THEME_PREVIEW_COLORS.gothic,
        },
        {
            value: 'matcha' as const,
            label: 'Matcha',
            desc: t('appearance.themeMatchaDesc'),
            previewColor: THEME_PREVIEW_COLORS.matcha,
        },
        {
            value: 'y2k' as const,
            label: 'Y2K',
            desc: t('appearance.themeY2kDesc'),
            // Y2K 的记忆点是长春花蓝页面，而不是深棕 accent
            previewColor: THEME_PREVIEW_COLORS.y2k,
        },
        {
            value: 'butter' as const,
            label: 'Butter',
            desc: t('appearance.themeButterDesc'),
            previewColor: THEME_PREVIEW_COLORS.butter,
        },
        {
            value: 'chocolate' as const,
            label: 'Chocolate',
            desc: t('appearance.themeChocolateDesc'),
            previewColor: THEME_PREVIEW_COLORS.chocolate,
        },
    ];

    /** 当前选中的主题；用于在单选列表下方展示一行说明，避免每项都塞说明导致高度不一。 */
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

    const transcriptPosition = currentTranscriptPosition || 'right';

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
                {/* ① 主题：视觉风格是看一眼就能选的东西，颜色圆点保留预览 */}
                <SettingSection
                    title={t('appearance.sections.theme')}
                    description={t('appearance.sections.themeDesc')}
                    icon={Palette}
                >
                    <VStack gap={2} width="100%">
                        <VStack gap={0.5}>
                            <Text type="body" weight="medium">{t('appearance.themeFamilyTitle')}</Text>
                            <Text type="supporting" color="secondary">
                                {t('appearance.themeFamilyDescription')}
                            </Text>
                        </VStack>
                        <CardRadioGroup
                            label={t('appearance.themeFamilyTitle')}
                            value={currentThemeFamily || 'neutral'}
                            onChange={(val) => {
                                setValue('themeFamily', val as AppearanceFormValues['themeFamily'], {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                });
                            }}
                        >
                            <Grid columns={{ minWidth: 120, max: 4 }} gap={2} width="100%">
                                {themeFamilyOptions.map((opt) => {
                                    const isSelected = (currentThemeFamily || 'neutral') === opt.value;
                                    return (
                                        <CardRadio key={opt.value} value={opt.value} className="h-16">
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
                                        </CardRadio>
                                    );
                                })}
                            </Grid>
                        </CardRadioGroup>
                        {selectedThemeFamily && (
                            <Text type="supporting" color="secondary">
                                {selectedThemeFamily.desc}
                            </Text>
                        )}
                    </VStack>

                    <Divider variant="subtle" />

                    <SettingField
                        title={t('appearance.themeTitle')}
                        description={isDarkOnlyTheme ? undefined : t('appearance.themeDescription')}
                    >
                        <SegmentedControl
                            label={t('appearance.themeTitle')}
                            value={selectedThemeMode}
                            onChange={(val) => {
                                setValue('theme', val as AppearanceFormValues['theme'], {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                });
                            }}
                            size="sm"
                            isDisabled={isDarkOnlyTheme}
                            disabledMessage={isDarkOnlyTheme ? t('appearance.darkOnlyThemeHint') : undefined}
                        >
                            {themeOptions.map((opt) => (
                                <SegmentedControlItem
                                    key={opt.value}
                                    value={opt.value}
                                    label={opt.label}
                                    icon={<Icon icon={opt.icon} size="sm" />}
                                />
                            ))}
                        </SegmentedControl>
                    </SettingField>
                </SettingSection>

                <Divider />

                {/* ② 界面与文字：语言、字号与剧本停靠 */}
                <SettingSection
                    title={t('appearance.sections.interface')}
                    description={t('appearance.sections.interfaceDesc')}
                    icon={SlidersHorizontal}
                >
                    <SettingField
                        title={t('appearance.languageTitle')}
                        description={t('appearance.languageDescription')}
                        testId={SETTING_ROW_TESTIDS.language}
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
                    </SettingField>

                    <Divider variant="subtle" />

                    <SettingField
                        title={t('appearance.fontSizeTitle')}
                        description={t('appearance.fontSizeDescription')}
                    >
                        <SegmentedControl
                            label={t('appearance.fontSizeTitle')}
                            value={currentFontSize}
                            onChange={(val) => {
                                setValue('fontSize', val as AppearanceFormValues['fontSize'], {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                });
                            }}
                            size="sm"
                        >
                            {APPEARANCE_FONT_SIZES.map((size) => (
                                <SegmentedControlItem
                                    key={size}
                                    value={size}
                                    label={fontSizeOptions[size]}
                                />
                            ))}
                        </SegmentedControl>
                    </SettingField>

                    <Divider variant="subtle" />

                    <SettingField
                        title={t('appearance.transcriptPositionTitle')}
                        description={t('appearance.transcriptPositionDescription')}
                        alignTop
                    >
                        <CardRadioGroup
                            label={t('appearance.transcriptPositionTitle')}
                            value={transcriptPosition}
                            onChange={(val) => {
                                setValue('transcriptPosition', val as AppearanceFormValues['transcriptPosition'], {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                });
                            }}
                        >
                            <Grid columns={{ minWidth: 120, max: 2 }} gap={2} width={320}>
                                <CardRadio value="right">
                                    <VStack gap={1.5} align="center" justify="center">
                                        <Icon
                                            icon={PanelRight as unknown as Parameters<typeof Icon>[0]['icon']}
                                            size="sm"
                                            color={transcriptPosition === 'right' ? 'accent' : 'secondary'}
                                        />
                                        <Text
                                            type="supporting"
                                            weight={transcriptPosition === 'right' ? 'semibold' : undefined}
                                            color={transcriptPosition === 'right' ? 'primary' : 'secondary'}
                                        >
                                            {t('appearance.transcriptPositionRight')}
                                        </Text>
                                    </VStack>
                                </CardRadio>
                                <CardRadio value="left">
                                    <VStack gap={1.5} align="center" justify="center">
                                        <Icon
                                            icon={PanelLeft as unknown as Parameters<typeof Icon>[0]['icon']}
                                            size="sm"
                                            color={transcriptPosition === 'left' ? 'accent' : 'secondary'}
                                        />
                                        <Text
                                            type="supporting"
                                            weight={transcriptPosition === 'left' ? 'semibold' : undefined}
                                            color={transcriptPosition === 'left' ? 'primary' : 'secondary'}
                                        >
                                            {t('appearance.transcriptPositionLeft')}
                                        </Text>
                                    </VStack>
                                </CardRadio>
                            </Grid>
                        </CardRadioGroup>
                    </SettingField>
                </SettingSection>

                <Divider />

                {/* ③ 字幕预览：真实组件、真实字号 */}
                <SettingSection
                    title={t('appearance.subtitlePreviewTitle')}
                    description={t('appearance.subtitlePreviewHint')}
                    icon={Captions}
                    action={(
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
                    )}
                >
                    <Card variant="default" padding={4} width="100%">
                        {previewMode === 'main' ? (
                            <VStack gap={2} align="center" justify="center" padding={2}>
                                <Text
                                    type="large"
                                    size={currentFontSize === 'fontSizeSmall' ? 'base' : currentFontSize === 'fontSizeLarge' ? '2xl' : 'lg'}
                                    weight="medium"
                                    justify="center"
                                >
                                    {t('appearance.subtitlePreviewSampleEn')}
                                </Text>
                                <Text
                                    type="body"
                                    color="secondary"
                                    size={currentFontSize === 'fontSizeSmall' ? 'sm' : currentFontSize === 'fontSizeLarge' ? 'xl' : 'base'}
                                    justify="center"
                                >
                                    {t('appearance.subtitlePreviewSampleZh')}
                                </Text>
                            </VStack>
                        ) : (
                            <VStack gap={2} align="center" justify="center" padding={2}>
                                <Card variant="transparent" padding={3} maxWidth={420} width="100%" className="border border-border/60 rounded-xl">
                                    <VStack gap={1} align="center">
                                        <Text
                                            type="body"
                                            weight="medium"
                                            size={currentFontSize === 'fontSizeSmall' ? 'xsm' : currentFontSize === 'fontSizeLarge' ? 'base' : 'sm'}
                                            justify="center"
                                        >
                                            {t('appearance.subtitlePreviewSampleEn')}
                                        </Text>
                                        <Text
                                            type="supporting"
                                            color="secondary"
                                            size={currentFontSize === 'fontSizeSmall' ? '4xs' : currentFontSize === 'fontSizeLarge' ? 'sm' : 'xsm'}
                                            justify="center"
                                        >
                                            {t('appearance.subtitlePreviewSampleZh')}
                                        </Text>
                                    </VStack>
                                </Card>
                            </VStack>
                        )}
                    </Card>
                </SettingSection>
            </SettingsPageShell>
        </form>
    );
};

export default AppearanceSetting;
