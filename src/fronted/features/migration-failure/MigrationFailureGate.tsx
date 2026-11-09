import React, { useState } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import TitleBar from '@/fronted/components/layout/TitleBar/TitleBar';
import { AlertTriangle, Copy, RefreshCw, Trash2 } from 'lucide-react';
import type { MigrationFailureDetail } from '@/common/contracts/migration-failure';
import {
    resetAndRelaunch,
    retryAfterMigrationFailure,
} from './migrationFailureApi';

/**
 * 迁移失败恢复 Gate 组件属性。
 */
export interface MigrationFailureGateProps {
    /** 本次启动的迁移失败详情；来自 migration-failure/detail。 */
    failure: MigrationFailureDetail;
}

/**
 * 复制到剪贴板的通用动作 hook；失败时提示但不中断。
 *
 * @returns 复制状态与触发方法。
 */
const useCopyText = () => {
    const [copied, setCopied] = useState(false);
    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // 剪贴板不可用（如无焦点）时静默：用户可直接手动选择文本复制
        }
    };
    return { copied, copy };
};

/**
 * 迁移失败恢复 Gate 页面。
 *
 * 启动迁移失败时替代主界面：展示失败点与原因，引导用户「重试」或
 * 「重置并重试」。重置是有损操作（清除全部设置与本地数据库），必须
 * 经过确认弹窗；重置/重试成功时窗口会被后端重启，页面停在加载态即可。
 *
 * 采用 Astryx 布局与原语（VStack/HStack/Card/Button/AlertDialog）构建。
 *
 * @param props 组件属性。
 * @returns 迁移失败恢复 JSX 元素。
 */
export const MigrationFailureGate: React.FC<MigrationFailureGateProps> = ({ failure }) => {
    const { t } = useI18nTranslation('migration');
    const [acting, setActing] = useState<'retry' | 'reset' | null>(null);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);
    const { copied, copy } = useCopyText();

    /** 失败详情的纯文本形态，供用户复制反馈。 */
    const detailText = [
        failure.phase ? `phase: ${failure.phase}` : null,
        failure.migrationId ? `migration: ${failure.migrationId}` : null,
        failure.errorMessage ? `error: ${failure.errorMessage}` : null,
    ].filter(Boolean).join('\n');

    const handleRetry = async () => {
        setActing('retry');
        setResetError(null);
        try {
            await retryAfterMigrationFailure();
        } catch (error) {
            setActing(null);
            toast.error(t('retryFailed'));
            void error;
        }
    };

    const handleReset = async () => {
        setActing('reset');
        setResetError(null);
        try {
            await resetAndRelaunch();
            // 成功时后端会延迟重启，保持重置中展示直到窗口销毁。
        } catch (error) {
            setActing(null);
            setResetError(error instanceof Error ? error.message : String(error));
        }
    };

    return (
        <VStack height="100%" width="100%" gap={0}>
            {/* 顶栏控制区域 */}
            <VStack width="100%" height={36} justify="center">
                <TitleBar maximizable={false} className="top-0 left-0 w-full h-9 z-50" />
            </VStack>

            {/* 主恢复操作卡片区域 */}
            <Center width="100%" height="fill" padding={4}>
                <VStack width="100%" maxWidth={540} gap={6} hAlign="center">
                    {/* 警告指示图标 */}
                    <Center
                        width={64}
                        height={64}
                        className="rounded-2xl bg-warning/12 text-warning-text"
                    >
                        <Icon icon={AlertTriangle as unknown as IconType} size="lg" />
                    </Center>

                    <VStack gap={2} hAlign="center">
                        <Heading level={1} weight="bold" textWrap="balance">
                            {t('title')}
                        </Heading>
                        <Text type="supporting" color="secondary" justify="center">
                            {t('desc')}
                        </Text>
                    </VStack>

                    {/* 失败详情卡片 */}
                    <Card variant="default" padding={4} width="100%">
                        <VStack gap={2} width="100%">
                            <HStack justify="between" align="center" width="100%">
                                <Text type="supporting" color="secondary" weight="medium">
                                    {t('detailLabel')}
                                </Text>
                                <Button
                                    label={copied ? t('copied') : t('copy')}
                                    variant="ghost"
                                    size="sm"
                                    icon={<Icon icon={Copy as unknown as IconType} size="sm" />}
                                    onClick={() => { void copy(detailText); }}
                                />
                            </HStack>
                            <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border/50 bg-surface/60 p-2.5 font-mono text-metadata leading-relaxed text-secondary select-text">
                                {detailText}
                            </pre>
                        </VStack>
                    </Card>

                    {resetError && (
                        <Banner
                            status="error"
                            title={`${t('resetFailed')}: ${resetError}`}
                        />
                    )}

                    {/* 操作按钮组 */}
                    <HStack gap={3} justify="center" wrap="wrap">
                        <Button
                            label={acting === 'retry' ? t('retrying') : t('retry')}
                            variant="primary"
                            size="lg"
                            isLoading={acting === 'retry'}
                            isDisabled={acting !== null}
                            icon={<Icon icon={RefreshCw as unknown as IconType} size="sm" />}
                            onClick={() => { void handleRetry(); }}
                        />
                        <Button
                            label={acting === 'reset' ? t('resetting') : t('reset')}
                            variant="secondary"
                            size="lg"
                            isLoading={acting === 'reset'}
                            isDisabled={acting !== null}
                            icon={<Icon icon={Trash2 as unknown as IconType} size="sm" />}
                            onClick={() => setResetDialogOpen(true)}
                        />
                    </HStack>
                </VStack>
            </Center>

            {/* 重置有损确认弹窗 */}
            <AlertDialog
                isOpen={resetDialogOpen}
                onOpenChange={setResetDialogOpen}
                title={t('resetConfirmTitle')}
                description={t('resetConfirmDesc')}
                actionLabel={t('resetConfirmOk')}
                cancelLabel={t('resetConfirmCancel')}
                actionVariant="destructive"
                isActionLoading={acting === 'reset'}
                onAction={() => {
                    setResetDialogOpen(false);
                    void handleReset();
                }}
            />
        </VStack>
    );
};

export default MigrationFailureGate;
