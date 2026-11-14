import React from 'react';
import useSWR from 'swr';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { FileText, SquarePlay } from 'lucide-react';

import { Banner } from '@astryxdesign/core/Banner';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';

import {
    SettingField,
    SettingSection,
    SettingsLoadingSkeleton,
} from '@/frontend/features/settings/components/form';
import SettingsPageShell from '@/frontend/features/settings/components/form/SettingsPageShell';
import {
    SETTINGS_DETAIL_SWR_OPTIONS,
    settingsApi,
} from '@/frontend/features/settings/settingsApi';
import { youtubeImportApi } from '@/frontend/features/youtube-import/youtubeImportApi';

/**
 * YouTube 导入设置页：控制「粘贴链接导入」功能的开关与 cookies 文件。
 *
 * 开关只影响首页入口与新的导入请求，进行中的任务不受影响；
 * cookies 路径在失焦或回车时保存，用于绕过代理出口 IP 的下载风控。
 */
const YoutubeImportSetting: React.FC = () => {
    const { t } = useTranslation('youtubeImport');
    const { data: detail, error: loadError, isLoading, mutate } = useSWR(
        'youtube-import/setting-detail',
        () => youtubeImportApi.getSettingDetail(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );
    const [saving, setSaving] = React.useState(false);
    const [cookiesDraft, setCookiesDraft] = React.useState<string | null>(null);

    const cookiesText = cookiesDraft ?? detail?.cookiesFilePath ?? '';

    /**
     * 保存 YouTube 导入配置。
     *
     * @param vo 需修改的导入配置字段。
     */
    const save = async (vo: { enabled?: boolean; cookiesFilePath?: string }): Promise<boolean> => {
        setSaving(true);
        try {
            const saved = await youtubeImportApi.saveSetting({
                enabled: vo.enabled ?? detail?.enabled ?? true,
                cookiesFilePath: vo.cookiesFilePath ?? detail?.cookiesFilePath ?? '',
            });
            await mutate(saved, false);
            return true;
        } catch (error) {
            // 保存失败必须显式暴露：开关弹回、路径未保存，不能让用户误以为已生效
            toast.error(error instanceof Error ? error.message : String(error), { id: 'youtube-import-setting-save' });
            return false;
        } finally {
            setSaving(false);
        }
    };

    /**
     * 失焦或按回车时提交 cookies 路径。
     */
    const commitCookiesPath = async () => {
        if (cookiesDraft === null) return;
        const trimmed = cookiesDraft.trim();
        if (trimmed === (detail?.cookiesFilePath ?? '')) {
            setCookiesDraft(null);
            return;
        }
        const ok = await save({ cookiesFilePath: trimmed });
        if (ok) {
            setCookiesDraft(null);
        }
    };

    return (
        <SettingsPageShell title={t('settings.title')} description={t('settings.description')}>
            <VStack gap={6} width="100%">
                {loadError ? (
                    <Banner
                        status="error"
                        title={t('settings.loadFailed')}
                        description={loadError instanceof Error ? loadError.message : String(loadError)}
                    />
                ) : isLoading || !detail ? (
                    <SettingsLoadingSkeleton
                        title={t('settings.title')}
                        description={t('settings.description')}
                    />
                ) : (
                    <SettingSection
                        title={t('settings.featureTitle')}
                        description={t('settings.featureDescription')}
                        icon={SquarePlay as unknown as IconType}
                    >
                        <SettingField
                            title={t('settings.enableTitle')}
                            description={t('settings.enableDescription')}
                        >
                            <Switch
                                label={t('settings.enableTitle')}
                                isLabelHidden
                                value={detail.enabled}
                                isDisabled={saving}
                                onChange={(checked) => void save({ enabled: checked })}
                            />
                        </SettingField>

                        <Divider variant="subtle" />

                        <SettingField
                            title={t('settings.cookiesTitle')}
                            description={t('settings.cookiesDescription')}
                        >
                            <HStack gap={2} vAlign="center">
                                <TextInput
                                    label={t('settings.cookiesTitle')}
                                    isLabelHidden
                                    value={cookiesText}
                                    isDisabled={saving}
                                    onChange={(value) => setCookiesDraft(value)}
                                    onEnter={() => void commitCookiesPath()}
                                    onBlur={() => void commitCookiesPath()}
                                    placeholder={t('settings.cookiesPlaceholder')}
                                    size="sm"
                                    width={280}
                                />
                                <IconButton
                                    label={t('settings.chooseCookiesFile')}
                                    tooltip={t('settings.chooseCookiesFile')}
                                    size="sm"
                                    variant="secondary"
                                    isDisabled={saving}
                                    icon={<Icon icon={FileText as unknown as IconType} size="sm" />}
                                    onClick={async () => {
                                        try {
                                            const files = await settingsApi.selectFile(['.txt']);
                                            if (files && files.length > 0) {
                                                const selectedPath = files[0];
                                                setCookiesDraft(selectedPath);
                                                const ok = await save({ cookiesFilePath: selectedPath });
                                                if (ok) {
                                                    setCookiesDraft(null);
                                                }
                                            }
                                        } catch {
                                            // 忽略取消
                                        }
                                    }}
                                />
                            </HStack>
                        </SettingField>
                    </SettingSection>
                )}
            </VStack>
        </SettingsPageShell>
    );
};

export default YoutubeImportSetting;
