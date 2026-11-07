import React from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import {
    SettingCard,
    SettingRow,
    SettingsLoadingSkeleton,
} from '@/fronted/features/settings/components/form';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import { Input } from '@/fronted/components/ui/input';
import { Switch } from '@/fronted/components/ui/switch';
import { youtubeImportApi } from '@/fronted/features/youtube-import/youtubeImportApi';

/**
 * YouTube 导入设置页：控制「粘贴链接导入」功能的开关与 cookies 文件。
 *
 * 开关只影响首页入口与新的导入请求，进行中的任务不受影响；
 * cookies 路径在失焦时保存，用于绕过代理出口 IP 的下载风控。
 */
const YoutubeImportSetting = () => {
    const { t } = useTranslation('youtubeImport');
    const { data: detail, error: loadError, isLoading, mutate } = useSWR(
        'youtube-import/setting-detail',
        () => youtubeImportApi.getSettingDetail(),
    );
    const [saving, setSaving] = React.useState(false);
    const [cookiesDraft, setCookiesDraft] = React.useState<string | null>(null);

    const cookiesText = cookiesDraft ?? detail?.cookiesFilePath ?? '';

    const save = async (vo: { enabled?: boolean; cookiesFilePath?: string }) => {
        setSaving(true);
        try {
            const saved = await youtubeImportApi.saveSetting({
                enabled: vo.enabled ?? detail?.enabled ?? true,
                cookiesFilePath: vo.cookiesFilePath ?? detail?.cookiesFilePath ?? '',
            });
            await mutate(saved, {
                optimisticData: saved,
                rollbackOnError: true,
            });
        } finally {
            setSaving(false);
        }
    };

    const commitCookiesPath = async () => {
        if (cookiesDraft === null) return;
        const trimmed = cookiesDraft.trim();
        if (trimmed === (detail?.cookiesFilePath ?? '')) {
            setCookiesDraft(null);
            return;
        }
        await save({ cookiesFilePath: trimmed });
        setCookiesDraft(null);
    };

    return (
        <SettingsPageShell title={t('settings.title')} description={t('settings.description')}>
            {loadError ? (
                <p className="text-sm text-destructive">{t('settings.loadFailed')}</p>
            ) : isLoading || !detail ? (
                <SettingsLoadingSkeleton title={t('settings.title')} />
            ) : (
                <SettingCard title={t('settings.featureTitle')} icon={Link2}>
                    <SettingRow
                        title={t('settings.enableTitle')}
                        description={t('settings.enableDescription')}
                    >
                        <Switch
                            checked={detail.enabled}
                            disabled={saving}
                            onCheckedChange={(checked) => void save({ enabled: checked })}
                        />
                    </SettingRow>
                    <SettingRow
                        title={t('settings.cookiesTitle')}
                        description={t('settings.cookiesDescription')}
                    >
                        <Input
                            value={cookiesText}
                            onChange={(e) => setCookiesDraft(e.target.value)}
                            onBlur={() => void commitCookiesPath()}
                            placeholder={t('settings.cookiesPlaceholder')}
                            className="w-72"
                        />
                    </SettingRow>
                </SettingCard>
            )}
        </SettingsPageShell>
    );
};

export default YoutubeImportSetting;
