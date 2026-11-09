import React from 'react';
import { CircleHelp, Copy, ExternalLink, FolderOpen } from 'lucide-react';

import { Collapsible } from '@astryxdesign/core/Collapsible';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { StackItem } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

export interface ManualDownloadGuideProps {
    /** 折叠条上的标题，如"网络不佳？查看手动下载教程"。 */
    title: string;
    /** 展开后的教程内容。 */
    children: React.ReactNode;
}

/**
 * 手动下载教程折叠块：模型未就绪时由调用方渲染，就绪后不渲染。
 *
 * 使用 Astryx Collapsible，默认收起；展开后的步骤由调用方组织。
 */
export const ManualDownloadGuide = ({ title, children }: ManualDownloadGuideProps) => (
    <Collapsible
        defaultIsOpen={false}
        trigger={(
            <HStack gap={2} vAlign="center">
                <Icon icon={CircleHelp as unknown as IconType} size="sm" color="secondary" />
                <Text type="supporting" color="secondary">{title}</Text>
            </HStack>
        )}
    >
        <VStack gap={4} width="100%" paddingBlockStart={3}>
            {children}
        </VStack>
    </Collapsible>
);

export interface ManualDownloadSourceRowProps {
    /** 下载地址。 */
    url: string;
    /** 是否为备用源；备用源前面会加一枚标签。 */
    isBackup?: boolean;
    /** 备用源标签文案。 */
    backupLabel?: string;
    /** 复制与打开按钮的文案，同时作为无障碍标签与悬停提示。 */
    copyLabel: string;
    openLabel: string;
    onCopy: () => void;
    onOpen: () => void;
}

/**
 * 手动下载里的单个下载源：一行地址 + 两个图标按钮。
 *
 * 地址过长时单行截断，完整地址在悬停提示里；复制与打开用图标按钮，
 * 避免每个源重复一遍「复制下载链接 / 在浏览器中打开」两段文字。
 */
export const ManualDownloadSourceRow = ({
    url,
    isBackup = false,
    backupLabel,
    copyLabel,
    openLabel,
    onCopy,
    onOpen,
}: ManualDownloadSourceRowProps) => (
    <HStack gap={2} vAlign="center" width="100%">
        {isBackup && backupLabel && (
            <Token label={backupLabel} size="sm" color="orange" />
        )}
        <StackItem size="fill">
            <Text
                size="2xs"
                color="secondary"
                hasTabularNumbers
                maxLines={1}
                wordBreak="break-all"
            >
                {url}
            </Text>
        </StackItem>
        <HStack gap={1} vAlign="center">
            <IconButton
                label={copyLabel}
                tooltip={copyLabel}
                size="sm"
                variant="ghost"
                icon={<Icon icon={Copy as unknown as IconType} size="sm" />}
                onClick={onCopy}
            />
            <IconButton
                label={openLabel}
                tooltip={openLabel}
                size="sm"
                variant="ghost"
                icon={<Icon icon={ExternalLink as unknown as IconType} size="sm" />}
                onClick={onOpen}
            />
        </HStack>
    </HStack>
);

export interface ManualDownloadPathRowProps {
    /** 文件应保存到的目录。 */
    path: string;
    /** 复制路径与打开文件夹的文案。 */
    copyLabel: string;
    openLabel: string;
    onCopy: () => void;
    onOpenFolder: () => void;
}

/**
 * 手动下载里的目标目录：一行路径 + 复制、打开两个图标按钮。
 */
export const ManualDownloadPathRow = ({
    path,
    copyLabel,
    openLabel,
    onCopy,
    onOpenFolder,
}: ManualDownloadPathRowProps) => (
    <HStack gap={2} vAlign="center" width="100%">
        <StackItem size="fill">
            <Text
                size="2xs"
                color="secondary"
                hasTabularNumbers
                maxLines={1}
                wordBreak="break-all"
            >
                {path}
            </Text>
        </StackItem>
        <HStack gap={1} vAlign="center">
            <IconButton
                label={copyLabel}
                tooltip={copyLabel}
                size="sm"
                variant="ghost"
                icon={<Icon icon={Copy as unknown as IconType} size="sm" />}
                onClick={onCopy}
            />
            <IconButton
                label={openLabel}
                tooltip={openLabel}
                size="sm"
                variant="ghost"
                icon={<Icon icon={FolderOpen as unknown as IconType} size="sm" />}
                onClick={onOpenFolder}
            />
        </HStack>
    </HStack>
);

export default ManualDownloadGuide;
