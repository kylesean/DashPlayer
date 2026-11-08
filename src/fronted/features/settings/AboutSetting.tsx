import React from 'react';
import useSWR from 'swr';
import { codeBlock } from 'common-tags';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    ExternalLink,
    FileText,
    Info,
    RefreshCw,
    Tag,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
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
import { SettingCard, SettingRow } from '@/fronted/features/settings/components/form/SettingCard';
import logoLight from '../../../../assets/logo-light.png';
import logoDark from '../../../../assets/logo-dark.png';

/**
 * GitHub 品牌图标（lucide-react 无内置 brand icon，封装标准 SVG 兼容 Astryx Icon）
 */
const GithubIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
);

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
                defaultValue: '专为语言学习与长视频精听打造的智能双语播放器',
            })}
        >
            <VStack gap={6} maxWidth={768}>
                {/* 核心卡片：应用信息与版本状态 */}
                <Card variant="muted" padding={4}>
                    <VStack gap={4}>
                        {/* 顶部主信息栏 */}
                        <HStack vAlign="center" justify="between" wrap="wrap" gap={4}>
                            <HStack vAlign="center" gap={3}>
                                <img
                                    src={isDark ? logoDark : logoLight}
                                    alt="DashPlayer Logo"
                                    width={48}
                                    height={48}
                                    draggable={false}
                                />
                                <VStack gap={1}>
                                    <HStack vAlign="center" gap={2}>
                                        <Heading level={2}>
                                            DashPlayer
                                        </Heading>
                                        {currentVersion && (
                                            <Token
                                                label={`v${currentVersion}`}
                                                size="sm"
                                                color="gray"
                                            />
                                        )}
                                    </HStack>
                                    <Text size="sm" color="secondary">
                                        {t('about.description')}
                                    </Text>
                                </VStack>
                            </HStack>

                            {/* 右侧主操作区 */}
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
                                    onClick={() => openUrl('https://github.com/kylesean/DashPlayer/releases/latest')}
                                />
                            </HStack>
                        </HStack>

                        {/* 状态展开区域 */}
                        {checking && !updateResult ? (
                            <Banner
                                status="info"
                                title={t('about.update.checking')}
                            />
                        ) : hasError ? (
                            <Banner
                                status="error"
                                title={errorText}
                                endContent={
                                    <Button
                                        label={t('about.update.retry')}
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => recheckUpdate()}
                                    />
                                }
                            />
                        ) : hasNewRelease ? (
                            <VStack gap={3}>
                                <Divider />
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
                                        onClick={() => openUrl(updateResult?.releases[0]?.url || 'https://github.com/kylesean/DashPlayer/releases/latest')}
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
                    </VStack>
                </Card>

                {/* 相关资源与开源卡片 */}
                <SettingCard
                    title={t('about.resourcesTitle', { defaultValue: '相关资源' })}
                    description={t('about.resourcesDescription', { defaultValue: '查阅官方文档、访问开源社区或查看授权协议' })}
                    icon={Info as unknown as IconType}
                >
                    <SettingRow
                        title={t('about.links.docs', { defaultValue: '官方文档' })}
                        description={t('about.links.docsDesc', { defaultValue: '查看完整使用教程与快捷键指南' })}
                        icon={FileText as unknown as IconType}
                    >
                        <Button
                            label={t('common.viewDocs', { defaultValue: '查看文档' })}
                            variant="secondary"
                            size="sm"
                            endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                            onClick={() => openUrl('https://solidspoon.xyz/DashPlayer/home.html')}
                        />
                    </SettingRow>

                    <SettingRow
                        title={t('about.links.github', { defaultValue: 'GitHub 仓库' })}
                        description={t('about.links.githubDesc', { defaultValue: '欢迎提交 Issue、功能建议或给项目点个 Star' })}
                        icon={GithubIcon as unknown as IconType}
                    >
                        <Button
                            label="GitHub"
                            variant="secondary"
                            size="sm"
                            endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                            onClick={() => openUrl('https://github.com/kylesean/DashPlayer')}
                        />
                    </SettingRow>

                    <SettingRow
                        title={t('about.links.license', { defaultValue: '开源协议' })}
                        description={t('about.links.licenseDesc', { defaultValue: '基于 GNU AGPLv3 自由开源' })}
                    >
                        <Button
                            label="GNU AGPLv3"
                            variant="secondary"
                            size="sm"
                            endContent={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                            onClick={() => openUrl('https://github.com/kylesean/DashPlayer/blob/main/LICENSE')}
                        />
                    </SettingRow>
                </SettingCard>

                <HStack justify="center" paddingBlock={2}>
                    <Text size="2xs" color="secondary" justify="center">
                        {t('about.footer', { defaultValue: '基于 solidSpoon/DashPlayer 深度定制' })} · GNU AGPLv3
                    </Text>
                </HStack>
            </VStack>
        </SettingsPageShell>
    );
};

export default AboutSetting;
