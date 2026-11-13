import React from 'react';
import { Cpu } from 'lucide-react';

import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { SystemInfo } from '@/common/contracts/system-info';
import { isHardwareSuitableForLocalAi } from '@/common/utils/hardware-profile';
import { AuthorSupportBanner } from '@/fronted/components/shared/AuthorSupportBanner';

export interface LocalLlmCardProps {
    /** 本机硬件信息，用于判断是否推荐运行本地 AI 模型。 */
    hardware?: SystemInfo | null;
    /** 硬件条件提示；不传时不展示。 */
    hardwareHint?: React.ReactNode;
}

/**
 * 本地增强资源引导卡片：
 * 不展示具体模型推荐列表或推理引擎细节，仅依据硬件能力给出适配结论与作者部署协助联系方式。
 */
export const LocalLlmCard: React.FC<LocalLlmCardProps> = ({
    hardware,
    hardwareHint,
}) => {
    const suitableForLocalAi = React.useMemo(
        () => isHardwareSuitableForLocalAi(hardware),
        [hardware],
    );

    return (
        <VStack gap={3} width="100%">
            {hardwareHint && (
                <HStack gap={2} vAlign="start">
                    <Icon icon={Cpu as unknown as IconType} size="sm" color="secondary" />
                    <Text type="supporting" color="secondary">{hardwareHint}</Text>
                </HStack>
            )}

            <AuthorSupportBanner suitableForLocalAi={suitableForLocalAi} />
        </VStack>
    );
};
