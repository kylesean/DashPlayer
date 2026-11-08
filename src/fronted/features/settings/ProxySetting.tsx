import React, { useEffect } from 'react';
import useSWR from 'swr';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import {
    SettingCard,
    SettingRow,
    SettingsLoadingSkeleton,
} from '@/fronted/features/settings/components/form';
import { Globe, Shield, Wifi } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';
import {
    SETTINGS_DETAIL_SWR_OPTIONS,
    settingsApi,
} from '@/fronted/features/settings/settingsApi';
import type { ProxySettingDetailVO } from '@/common/contracts/proxy-setting-vo';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Banner } from '@astryxdesign/core/Banner';

/** 网络代理表单数据结构。 */
type ProxyFormValues = {
    mode: ProxySettingDetailVO['mode'];
    url: string;
    bypassRules: string;
};

/**
 * 规范化模式字符串为合法枚举。
 *
 * @param value 原始模式值。
 * @returns 规范化的代理模式。
 */
const normalizeMode = (value: string | undefined): ProxyFormValues['mode'] => {
    if (value === 'custom' || value === 'none') {
        return value;
    }
    return 'system';
};

/**
 * 网络代理设置页面组件。
 *
 * 全面迁移至 Astryx UI 体系：
 * - 代理模式：使用 Astryx Selector 下拉选择（兼具 combobox 语义与无障碍支持）。
 * - 地址与绕过规则：使用 Astryx TextInput 与 TextArea。
 * - 告警与错误：使用 Astryx Banner（指定 role="alert"）。
 *
 * @returns 代理设置 JSX 元素。
 */
const ProxySetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');

    const { data: settings } = useSWR<ProxySettingDetailVO>(
        'settings/proxy/detail',
        () => settingsApi.getProxy(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );

    const form = useForm<ProxyFormValues>();
    const { setValue } = form;
    const currentMode = normalizeMode(useWatch({ control: form.control, name: 'mode' }));
    const [url, bypassRules] = useWatch({
        control: form.control,
        name: ['url', 'bypassRules'],
    });

    // 实际生效代理为空时显式警告：system 模式未探测到系统代理，或 custom 模式地址为空。
    const effectiveNoProxy =
        (currentMode === 'system' && settings?.systemProxy?.detected === false) ||
        (currentMode === 'custom' && !(url ?? '').trim());

    const {
        ready,
        status: autoSaveStatus,
        error: autoSaveError,
        initialize,
        flush,
    } = useAutoSaveSettingsForm<ProxyFormValues>({
        form,
        detailKey: 'settings/proxy/detail',
        onSave: async (values) => {
            await settingsApi.saveProxy({
                mode: values.mode,
                url: values.url,
                bypassRules: values.bypassRules,
            });
        },
    });

    useEffect(() => {
        if (!settings) {
            return;
        }
        initialize({
            mode: normalizeMode(settings.mode),
            url: settings.url,
            bypassRules: settings.bypassRules,
        });
    }, [initialize, settings]);

    if (!ready) {
        return (
            <SettingsLoadingSkeleton
                title={t('proxy.title')}
                description={t('proxy.description')}
            />
        );
    }

    const modeOptions = [
        { value: 'system', label: t('proxy.modeSystem') },
        { value: 'custom', label: t('proxy.modeCustom') },
        { value: 'none', label: t('proxy.modeNone') },
    ];

    return (
        <form
            className="w-full h-full min-h-0"
            onSubmit={(event) => {
                event.preventDefault();
                flush().catch(() => undefined);
            }}
        >
            <SettingsPageShell
                title={t('proxy.title')}
                description={t('proxy.description')}
            >
                {autoSaveStatus === 'error' && autoSaveError && (
                    <Banner
                        role="alert"
                        status="error"
                        title={autoSaveError}
                    />
                )}

                {effectiveNoProxy && (
                    <Banner
                        role="alert"
                        status="warning"
                        title={t('proxy.directConnectionWarning')}
                    />
                )}

                <SettingCard
                    title={t('proxy.modeTitle')}
                    icon={Globe}
                >
                    <SettingRow
                        title={t('proxy.modeTitle')}
                        description={t('proxy.modeDescription')}
                        icon={Wifi}
                    >
                        <Selector
                            label={t('proxy.modeTitle')}
                            isLabelHidden
                            value={currentMode}
                            options={modeOptions}
                            width={192}
                            size="sm"
                            onChange={(value) => {
                                setValue('mode', value as ProxyFormValues['mode'], {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                });
                            }}
                        />
                    </SettingRow>

                    {currentMode === 'custom' && (
                        <>
                            <SettingRow
                                title={t('proxy.urlTitle')}
                                description={t('proxy.urlDescription')}
                                icon={Globe}
                            >
                                <TextInput
                                    label={t('proxy.urlTitle')}
                                    isLabelHidden
                                    value={url ?? ''}
                                    placeholder="http://127.0.0.1:7890"
                                    size="sm"
                                    width={240}
                                    onChange={(val) => {
                                        setValue('url', val, {
                                            shouldDirty: true,
                                            shouldTouch: true,
                                        });
                                    }}
                                />
                            </SettingRow>
                            <SettingRow
                                title={t('proxy.bypassRulesTitle')}
                                description={t('proxy.bypassRulesDescription')}
                                icon={Shield}
                                alignTop
                            >
                                <TextArea
                                    label={t('proxy.bypassRulesTitle')}
                                    isLabelHidden
                                    value={bypassRules ?? ''}
                                    placeholder="localhost,127.0.0.1"
                                    rows={2}
                                    size="sm"
                                    width={240}
                                    onChange={(val) => {
                                        setValue('bypassRules', val, {
                                            shouldDirty: true,
                                            shouldTouch: true,
                                        });
                                    }}
                                />
                            </SettingRow>
                        </>
                    )}
                </SettingCard>
            </SettingsPageShell>
        </form>
    );
};

export default ProxySetting;
