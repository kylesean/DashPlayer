import React from 'react';
import useSWR from 'swr';
import { SWR_KEY, swrApiMutate } from '@/fronted/lib/swr-util';
import { Film, Folder, ListVideo, Trash2 } from 'lucide-react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { StackItem } from '@astryxdesign/core/Stack';
import TimeUtil from '@/common/utils/TimeUtil';
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import UrlUtil from '@/common/utils/UrlUtil';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';
import PathUtil from '@/common/utils/PathUtil';
import MediaUtil from '@/common/utils/MediaUtil';
import MusicCard from '@/fronted/features/file-browser/components/music-card';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import useInView from '@/fronted/hooks/useInView';
import i18n from '@/fronted/i18n';
import { toast } from 'react-hot-toast';

const ProjectListItem = ({
    video,
    className,
    onSelected
}: {
    video: WatchHistoryVO;
    className?: string;
    onSelected: () => void;
}) => {
    // 判断是否为 MP3 文件
    const isAudio = MediaUtil.isAudio(video.fileName);
    const showDuration = !video.isFolder && video.duration > 0;
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const inView = useInView(containerRef);

    const { data: url } = useSWR(
        inView && !isAudio
            ? [SWR_KEY.SPLIT_VIDEO_THUMBNAIL, video.basePath, video.fileName, video.current_position]
            : null,
        async ([, path, file, time]) => {
            return await fileBrowserApi.getThumbnail(PathUtil.join(path, file), time);
        }
    );

    const [hover, setHover] = React.useState(false);
    const [contextMenu, setContextMenu] = React.useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
    const [isDeleting, setIsDeleting] = React.useState(false);

    const handleDelete = async () => {
        try {
            setIsDeleting(true);
            await fileBrowserApi.deleteWatchHistoryGroup(video.id);
            await swrApiMutate('watch-history/list');
            setDeleteConfirmOpen(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setIsDeleting(false);
        }
    };

    const percent = showDuration
        ? Math.floor(((video?.current_position || 0) / (video?.duration || 1)) * 100)
        : 0;

    return (
        <ContextMenu
            className={className}
            label={video.fileName}
            items={[
                {
                    label: i18n.t('common:showInExplorer'),
                    onClick: async () => {
                        await fileBrowserApi.openFolder(video.basePath);
                    },
                },
                {
                    label: i18n.t('common:delete'),
                    variant: 'destructive',
                    onClick: () => {
                        setDeleteConfirmOpen(true);
                    },
                },
            ]}
            onOpenChange={setContextMenu}
        >
            <div
                ref={containerRef}
                data-testid={`watch-history-card-${video.id}`}
                data-video-id={video.id}
                role="button"
                tabIndex={0}
                    onKeyDown={(e) => {
                        // 仅处理容器自身的按键，避免拦截子按钮的 Enter/Space
                        if (e.currentTarget === e.target && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            onSelected();
                        }
                    }}
                    onMouseEnter={() => setHover(true)}
                    onMouseLeave={() => setHover(false)}
                    onClick={onSelected}
                    className={`group flex items-center gap-4 py-3 px-2 rounded-2xl transition-all duration-150 cursor-pointer outline-none ${
                        hover || contextMenu ? 'bg-muted' : 'hover:bg-muted/50'
                    }`}
                >
                    <div className="relative w-36 sm:w-44 shrink-0 rounded-xl overflow-hidden bg-card border border-border/50 shadow-2xs">
                        {video.isFolder && (
                            <div className="absolute top-2 left-2 z-10 text-media-fg/95 bg-media-bg/75 backdrop-blur-md rounded-md px-1.5 py-0.5 text-metadata font-medium flex items-center gap-1 shadow-2xs">
                                <Folder className="w-3 h-3" />
                                <span>{i18n.t('common:folderBadge', { defaultValue: '文件夹' })}</span>
                            </div>
                        )}
                        {isAudio ? (
                            <MusicCard fileName={video.fileName} />
                        ) : url ? (
                            <img
                                src={UrlUtil.toUrl(url)}
                                style={{
                                    aspectRatio: '16/9'
                                }}
                                className="w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                alt={video.fileName}
                            />
                        ) : (
                            <div
                                style={{
                                    aspectRatio: '16/9'
                                }}
                                className="w-full bg-muted flex items-center justify-center text-muted-foreground/60"
                            >
                                <Film className="w-6 h-6 stroke-1" />
                            </div>
                        )}
                        {(showDuration || video.isFolder) && (
                            <div className="absolute bottom-2 right-2 text-media-fg/95 bg-media-bg/75 backdrop-blur-md rounded-md px-1.5 py-0.5 text-metadata font-medium flex items-center gap-1 shadow-2xs">
                                {!video.isFolder ? (
                                    TimeUtil.secondToTimeStrCompact(video?.duration)
                                ) : (
                                    <ListVideo className="w-3.5 h-3.5" />
                                )}
                            </div>
                        )}
                        {showDuration && (
                            <div className="absolute bottom-0 left-0 w-full">
                                <ProgressBar
                                    label={video.fileName}
                                    isLabelHidden
                                    value={percent}
                                    variant="accent"
                                />
                            </div>
                        )}
                    </div>
                    <StackItem size="fill">
                        <VStack gap={1} justify="center">
                            <Text
                                type="body"
                                weight="medium"
                                maxLines={1}
                            >
                                {video.displayFileName ?? video.fileName}
                            </Text>
                            <Text
                                type="supporting"
                                color="secondary"
                                maxLines={1}
                            >
                                {video.isFolder
                                    ? i18n.t('common:recentPlayedVideo', {
                                        name: video.fileName,
                                        defaultValue: `最近播放：${video.fileName}`,
                                    })
                                    : TimeUtil.dateToRelativeTime(video?.updatedAt ?? new Date())}
                            </Text>
                        </VStack>
                    </StackItem>
                    {hover && (
                        <div className="shrink-0">
                            <IconButton
                                label={i18n.t('common:delete')}
                                icon={<Trash2 className="w-4 h-4" />}
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirmOpen(true);
                                }}
                            />
                        </div>
                    )}
                </div>
            <AlertDialog
                isOpen={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title={i18n.t('common:deleteConfirmTitle', { defaultValue: '删除观看记录？' })}
                description={video.isFolder
                    ? i18n.t('common:deleteFolderConfirmDesc', {
                        defaultValue: '该目录下的全部观看记录都会被删除。位于媒体库视频目录内的文件会连同记录一起从磁盘删除，无法撤销；媒体库之外的视频只移除记录，原文件保留。',
                    })
                    : i18n.t('common:deleteConfirmDesc', {
                        defaultValue: '位于媒体库视频目录内的文件会连同记录一起从磁盘删除，无法撤销；媒体库之外的视频只移除记录，原文件保留。',
                    })}
                actionLabel={i18n.t('common:delete')}
                actionVariant="destructive"
                cancelLabel={i18n.t('common:cancel', { defaultValue: '取消' })}
                isActionLoading={isDeleting}
                onAction={handleDelete}
            />
        </ContextMenu>
    );
};

export default ProjectListItem;
