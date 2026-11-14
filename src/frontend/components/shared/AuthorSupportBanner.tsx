import React from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, LifeBuoy, Mail, MessageCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import { AUTHOR_SUPPORT_CONTACT } from '@/common/constants/author-support';

interface AuthorSupportBannerProps {
    /** 紧凑模式（用于引导页内嵌）。 */
    compact?: boolean;
    /** 嵌入父级卡片内部时省略外层 Card 包裹，避免双重圆角边框。 */
    embedded?: boolean;
    /** 本机硬件是否推荐运行本地 AI 模型。 */
    suitableForLocalAi?: boolean;
}

/**
 * 作者部署协助与联系卡片：
 * 开源免费应用之外，提供按本机硬件选型与本地/远程大模型部署支持联系方式。
 */
export const AuthorSupportBanner: React.FC<AuthorSupportBannerProps> = ({
    compact = false,
    embedded = false,
    suitableForLocalAi = false,
}) => {
    const { t } = useTranslation('common');

    const copyValue = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('authorSupport.copied', { label, value, defaultValue: `已复制 ${label}：${value}` }));
        } catch {
            toast.error(t('authorSupport.copyFailed', { defaultValue: '复制失败' }));
        }
    };

    const content = (
        <VStack gap={2} width="100%" data-testid={embedded ? 'author-support-banner' : undefined}>
            <HStack gap={2} vAlign="center">
                <LifeBuoy className="h-4 w-4 shrink-0 text-accent" />
                <Text size="sm" weight="semibold">
                    {suitableForLocalAi
                        ? t('authorSupport.suitableTitle', {
                            defaultValue: '恭喜你，您的硬件配置非常推荐运行本地 AI 模型',
                        })
                        : t('authorSupport.title', { defaultValue: '需要本地 AI 部署协助？可联系作者' })}
                </Text>
            </HStack>
            <Text type="supporting" color="secondary">
                {suitableForLocalAi
                    ? t('authorSupport.suitableDescription', {
                        defaultValue: '如果不知道如何部署，欢迎联系作者协助配置与指导，本软件开源免费使用。',
                    })
                    : t('authorSupport.description', {
                        defaultValue: '本软件开源免费使用；如不确定如何选择或部署本地 AI 服务，欢迎联系作者获取协助。',
                    })}
            </Text>
            <HStack gap={2} wrap="wrap" vAlign="center">
                <Button
                    size="sm"
                    variant="secondary"
                    label={t('authorSupport.wechatLabel', {
                        wechat: AUTHOR_SUPPORT_CONTACT.wechat,
                        defaultValue: `WeChat：${AUTHOR_SUPPORT_CONTACT.wechat}`,
                    })}
                    icon={<MessageCircle className="h-3.5 w-3.5" />}
                    endContent={<Copy className="h-3 w-3 opacity-70" />}
                    onClick={() => { void copyValue(AUTHOR_SUPPORT_CONTACT.wechat, 'WeChat'); }}
                />
                <Button
                    size="sm"
                    variant="secondary"
                    label={t('authorSupport.emailLabel', {
                        email: AUTHOR_SUPPORT_CONTACT.email,
                        defaultValue: `Email：${AUTHOR_SUPPORT_CONTACT.email}`,
                    })}
                    icon={<Mail className="h-3.5 w-3.5" />}
                    endContent={<Copy className="h-3 w-3 opacity-70" />}
                    onClick={() => { void copyValue(AUTHOR_SUPPORT_CONTACT.email, 'Email'); }}
                />
            </HStack>
        </VStack>
    );

    if (embedded) {
        return content;
    }

    return (
        <Card variant="muted" padding={compact ? 2 : 3} data-testid="author-support-banner">
            {content}
        </Card>
    );
};
