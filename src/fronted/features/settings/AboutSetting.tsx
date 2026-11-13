import React from 'react';
import useSWR from 'swr';
import { codeBlock } from 'common-tags';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    BookOpen,
    ExternalLink,
    Info,
    RefreshCw,
    Tag,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { Banner } from '@astryxdesign/core/Banner';

import Md from '@/fronted/components/shared/markdown/Markdown';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import type { UpdateCheckResult } from '@/common/types/update-check';
import useSetting from '@/fronted/features/settings/settingsStore';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import { SettingField, SettingSection } from '@/fronted/features/settings/components/form';
import wordmark from '../../../../assets/brand/refrain/wordmark.svg';
import wordmarkReverse from '../../../../assets/brand/refrain/wordmark-reverse.svg';

/**
 * 关于与更新设置面板
 *
 * 展示当前应用版本、更新检测、更新日志以及官方资源与开源协议链接。
 */
const AboutSetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');
    const theme = useSetting((s) => s.values.get('appearance.theme'));

    const { data: currentVersion = '' } = useSWR<string>(
        'system/app-version',
        async () => {
            return await settingsApi.getAppVersion().catch(() => '');
        },
        {
            fallbackData: '',
            revalidateOnFocus: false,
        }
    );

    const {
        data: updateResult,
        isLoading: checking,
        isValidating,
        mutate: recheckUpdate,
    } = useSWR<UpdateCheckResult>(
        'system/check-update',
        async () => {
            return await settingsApi.checkUpdate();
        },
        {
            revalidateOnFocus: false,
        }
    );

    const isCheckingUpdate = checking || isValidating;
    const hasNewRelease = (updateResult?.releases?.length ?? 0) > 0;
    const hasError = updateResult?.status === 'error';

    const errorText = updateResult?.error
        ? t(`about.update.errors.${updateResult.error}`, {
            defaultValue: t(`checkUpdate.errors.${updateResult.error}`, {
                defaultValue: t('about.update.failedDescription', {
                    defaultValue: t('checkUpdate.failedDescription'),
                }),
            }),
        })
        : t('about.update.failedDescription', { defaultValue: t('checkUpdate.failedDescription') });

    const openUrl = async (url: string) => {
        await settingsApi.openUrl(url);
    };

    // 依主题模式配置选择图标，不调用 matchMedia，遵从 Electron IPC 注入的主题类名
    const isDark = theme === 'dark' || (theme !== 'light' && typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

    return (
        <SettingsPageShell
            title={t('about.title', { defaultValue: '关于与更新' })}
            description={t('about.slogan', {
                defaultValue: '精选 YouTube 英语视频，AI 原生的沉浸式学习',
            })}
        >
            <SettingSection
                title={t('about.appInfoTitle', { defaultValue: '产品信息' })}
                description={t('about.appInfoDescription', { defaultValue: '了解 Refrain 的版本与更新状态' })}
                icon={Info as unknown as IconType}
            >
                <Card variant="default" padding={4}>
                    <HStack vAlign="center" justify="between" wrap="wrap" gap={4}>
                        <HStack vAlign="center" gap={3}>
                            <img
                                className="h-10 w-auto object-contain shrink-0"
                                src={isDark ? wordmarkReverse : wordmark}
                                alt={t('about.appName', { defaultValue: 'Refrain' })}
                                draggable={false}
                            />
                            {currentVersion && (
                                <Token
                                    label={`v${currentVersion}`}
                                    size="sm"
                                    color="gray"
                                />
                            )}
                        </HStack>

                        <HStack vAlign="center" gap={2}>
                            <Button
                                label={t('about.update.checkNow', { defaultValue: '检查更新' })}
                                size="sm"
                                variant="secondary"
                                isLoading={isCheckingUpdate}
                                icon={<Icon icon={RefreshCw as unknown as IconType} size="sm" />}
                                onClick={() => recheckUpdate()}
                            />
                            <Button
                                label={t('about.links.releases', { defaultValue: '版本日志' })}
                                size="sm"
                                variant="ghost"
                                icon={<Icon icon={Tag as unknown as IconType} size="sm" />}
                                endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                                onClick={() => openUrl('https://github.com/kylesean/Refrain/releases/latest')}
                            />
                        </HStack>
                    </HStack>
                </Card>

                {checking && !updateResult ? (
                    <Banner
                        status="info"
                        title={t('about.update.checking')}
                    />
                ) : hasError ? (
                    <Banner
                        status="error"
                        title={errorText}
                        endContent={(
                            <Button
                                label={t('about.update.retry')}
                                size="sm"
                                variant="secondary"
                                onClick={() => recheckUpdate()}
                            />
                        )}
                    />
                ) : hasNewRelease ? (
                    <VStack gap={3} width="100%">
                        <HStack vAlign="center" justify="between" gap={3}>
                            <HStack vAlign="center" gap={2}>
                                <Text weight="bold" size="sm">
                                    {t('about.update.newVersionFound')}
                                </Text>
                                <Token
                                    label={updateResult?.releases[0]?.version ?? ''}
                                    size="sm"
                                    color="blue"
                                />
                            </HStack>

                            <Button
                                label={t('about.update.downloadNow')}
                                size="sm"
                                variant="primary"
                                endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                                onClick={() => openUrl(updateResult?.releases[0]?.url || 'https://github.com/kylesean/Refrain/releases/latest')}
                            />
                        </HStack>

                        <Card variant="default" padding={3}>
                            <ScrollableArea label="Release Notes" height={192}>
                                <Md>
                                    {(updateResult?.releases ?? []).map((release) => (
                                        codeBlock`
                                        ${release.content}
                                        `
                                    )).join('\n---\n')}
                                </Md>
                            </ScrollableArea>
                        </Card>
                    </VStack>
                ) : (
                    <Banner
                        status="success"
                        title={t('about.update.upToDateTitle', { defaultValue: '当前已是最新版本' })}
                    />
                )}
            </SettingSection>

            <Divider />

            <SettingSection
                title={t('about.resourcesTitle', { defaultValue: '相关资源' })}
                description={t('about.resourcesDescription', { defaultValue: '查阅官方文档、访问开源社区或查看授权协议' })}
                icon={BookOpen as unknown as IconType}
            >
                <SettingField
                    title={t('about.links.docs', { defaultValue: '官方文档' })}
                    description={t('about.links.docsDesc', { defaultValue: '查看完整使用教程与快捷键指南' })}
                >
                    <Button
                        label={t('common.viewDocs', { defaultValue: '查看文档' })}
                        variant="secondary"
                        size="sm"
                        endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                        onClick={() => openUrl('https://kylesean.github.io/Refrain/home.html')}
                    />
                </SettingField>

                <Divider variant="subtle" />

                <SettingField
                    title={t('about.links.github', { defaultValue: 'GitHub 仓库' })}
                    description={t('about.links.githubDesc', { defaultValue: '欢迎提交 Issue、功能建议或给项目点个 Star' })}
                >
                    <Button
                        label="GitHub"
                        variant="secondary"
                        size="sm"
                        endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                        onClick={() => openUrl('https://github.com/kylesean/Refrain')}
                    />
                </SettingField>

                <Divider variant="subtle" />

                <SettingField
                    title={t('about.links.license', { defaultValue: '开源协议' })}
                    description={t('about.links.licenseDesc', { defaultValue: '基于 GNU AGPLv3 自由开源' })}
                >
                    <Button
                        label="GNU AGPLv3"
                        variant="secondary"
                        size="sm"
                        endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                        onClick={() => openUrl('https://github.com/kylesean/Refrain/blob/main/LICENSE')}
                    />
                </SettingField>
            </SettingSection>

            <HStack justify="center" paddingBlock={2}>
                <Text size="2xs" color="secondary" justify="center">
                    {t('about.footer', { defaultValue: 'Refrain · 沉浸式英语视频学习桌面应用' })} · GNU AGPLv3
                </Text>
            </HStack>
        </SettingsPageShell>
    );
};

export default AboutSetting;
