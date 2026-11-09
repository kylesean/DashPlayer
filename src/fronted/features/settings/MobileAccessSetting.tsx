import React from 'react';
import useSWR from 'swr';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Copy, ExternalLink, Smartphone, Wifi } from 'lucide-react';

import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Banner } from '@astryxdesign/core/Banner';

import {
    SettingField,
    SettingSection,
    SettingsLoadingSkeleton,
} from '@/fronted/features/settings/components/form';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import {
    SETTINGS_DETAIL_SWR_OPTIONS,
    settingsApi,
} from '@/fronted/features/settings/settingsApi';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';
import type { MobileAccessSettingSaveVO } from '@/common/contracts/mobile-access-setting-vo';

type MobileAccessFormValues = MobileAccessSettingSaveVO;

/** 端口输入的合法范围。 */
const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * 手机访问设置页。
 *
 * 管理局域网移动端访问服务的开启状态与监听端口，提供局域网访问地址展示与快速复制。
 */
const MobileAccessSetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');
    const { data: detail, error: loadError, mutate } = useSWR(
        'settings/mobile-access/detail',
        () => settingsApi.getMobileAccess(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );

    const form = useForm<MobileAccessFormValues>();
    const { setValue } = form;
    const [enabled, port] = useWatch({
        control: form.control,
        name: ['enabled', 'port'],
    });

    const { ready, error: saveError, initialize } = useAutoSaveSettingsForm<MobileAccessFormValues>({
        form,
        detailKey: 'settings/mobile-access/detail',
        onSave: async (values) => {
            await settingsApi.saveMobileAccess(values);
        },
    });

    React.useEffect(() => {
        if (!detail) {
            return;
        }
        initialize({
            enabled: detail.enabled,
            port: detail.port,
        });
    }, [detail, initialize]);

    /**
     * 复制地址到剪贴板。
     *
     * @param value 待复制的文本。
     */
    const copyText = async (value: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('mobile.copied'));
        } catch (copyErr) {
            toast.error(copyErr instanceof Error ? copyErr.message : String(copyErr));
        }
    };

    /**
     * 用系统浏览器打开地址。
     *
     * @param url 待打开的地址。
     */
    const openUrl = async (url: string): Promise<void> => {
        try {
            await settingsApi.openUrl(url);
        } catch (openErr) {
            toast.error(openErr instanceof Error ? openErr.message : String(openErr));
        }
    };

    if (loadError && !detail) {
        return (
            <SettingsPageShell title={t('mobile.title')} description={t('mobile.description')}>
                <Banner
                    status="error"
                    title={loadError instanceof Error ? loadError.message : String(loadError)}
                />
            </SettingsPageShell>
        );
    }

    if (!ready || enabled === undefined || port === undefined || !detail) {
        return (
            <SettingsLoadingSkeleton
                title={t('mobile.title')}
                description={t('mobile.description')}
            />
        );
    }

    const errorText = saveError ?? detail.lastError;
    const statusText = detail.running
        ? t('mobile.statusRunning')
        : detail.lastError
            ? t('mobile.statusFailed')
            : detail.enabled
                ? t('mobile.statusNotRunning')
                : t('mobile.statusStopped');

    const statusDotVariant = detail.running
        ? 'success'
        : detail.enabled
            ? 'warning'
            : 'neutral';

    return (
        <SettingsPageShell
            title={t('mobile.title')}
            description={t('mobile.description')}
        >
            <VStack gap={6} width="100%">
                {errorText && (
                    <Banner
                        status="error"
                        title={errorText}
                    />
                )}

                <SettingSection
                    title={t('mobile.sections.service')}
                    description={t('mobile.sections.serviceDesc')}
                    icon={Smartphone as unknown as IconType}
                >
                    <SettingField
                        title={t('mobile.enabledTitle')}
                        description={t('mobile.enabledDescription')}
                    >
                        <Switch
                            label={t('mobile.enabledTitle')}
                            isLabelHidden
                            value={Boolean(enabled)}
                            onChange={(checked) => {
                                setValue('enabled', checked, {
                                    shouldDirty: true,
                                    shouldTouch: true,
                                });
                            }}
                        />
                    </SettingField>

                    <Divider variant="subtle" />

                    <SettingField
                        title={t('mobile.portTitle')}
                        description={t('mobile.portDescription')}
                    >
                        <NumberInput
                            label={t('mobile.portTitle')}
                            isLabelHidden
                            size="sm"
                            width={112}
                            min={MIN_PORT}
                            max={MAX_PORT}
                            isIntegerOnly
                            value={port}
                            onChange={(nextPort) => {
                                if (nextPort !== port && nextPort >= MIN_PORT && nextPort <= MAX_PORT) {
                                    setValue('port', nextPort, {
                                        shouldDirty: true,
                                        shouldTouch: true,
                                    });
                                }
                            }}
                        />
                    </SettingField>
                </SettingSection>

                <Divider />

                <SettingSection
                    title={t('mobile.addressTitle')}
                    description={t('mobile.sections.addressDesc')}
                    icon={Wifi as unknown as IconType}
                    action={(
                        <HStack vAlign="center" gap={2}>
                            <StatusDot
                                variant={statusDotVariant}
                                label={statusText}
                                isPulsing={detail.running}
                            />
                            <Text size="sm" weight="medium">{statusText}</Text>
                            <Button
                                label={t('mobile.refresh')}
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    mutate().catch(() => undefined);
                                }}
                            />
                        </HStack>
                    )}
                >
                    {detail.running ? (
                        detail.lanUrls.length > 0 ? (
                            <VStack gap={0} width="100%">
                                {detail.lanUrls.map((url, index) => (
                                    <VStack key={url} gap={0} width="100%">
                                        {index > 0 && <Divider variant="subtle" />}
                                        <HStack vAlign="center" justify="between" gap={3} paddingBlock={2}>
                                            <Text type="body" hasTabularNumbers wordBreak="break-all">
                                                {url}
                                            </Text>
                                            <HStack vAlign="center" gap={1}>
                                                <IconButton
                                                    label={t('mobile.copy')}
                                                    tooltip={t('mobile.copy')}
                                                    size="sm"
                                                    variant="ghost"
                                                    icon={<Icon icon={Copy as unknown as IconType} size="sm" />}
                                                    onClick={() => {
                                                        copyText(url).catch(() => undefined);
                                                    }}
                                                />
                                                <IconButton
                                                    label={t('mobile.open')}
                                                    tooltip={t('mobile.open')}
                                                    size="sm"
                                                    variant="ghost"
                                                    icon={<Icon icon={ExternalLink as unknown as IconType} size="sm" />}
                                                    onClick={() => {
                                                        openUrl(url).catch(() => undefined);
                                                    }}
                                                />
                                            </HStack>
                                        </HStack>
                                    </VStack>
                                ))}
                            </VStack>
                        ) : (
                            <Text type="supporting" color="secondary">
                                {t('mobile.lanEmpty')}
                            </Text>
                        )
                    ) : (
                        <Text type="supporting" color="secondary">
                            {t('mobile.addressEmpty')}
                        </Text>
                    )}

                    <VStack gap={1}>
                        <Text size="2xs" color="secondary">
                            • {t('mobile.remoteHint')}
                        </Text>
                        <Text size="2xs" color="secondary">
                            • {t('mobile.securityHint')}
                        </Text>
                    </VStack>
                </SettingSection>
            </VStack>
        </SettingsPageShell>
    );
};

export default MobileAccessSetting;
