import useSWR from 'swr';
import React from 'react';
import { SWR_KEY, swrApiMutate } from '@/fronted/lib/swr-util';
import { Film, Folder, ListVideo, Trash2 } from 'lucide-react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import TimeUtil from '@/common/utils/TimeUtil';
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import UrlUtil from '@/common/utils/UrlUtil';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';
import PathUtil from '@/common/utils/PathUtil';
import MediaUtil from '@/common/utils/MediaUtil';
import MusicCard from '@/fronted/features/file-browser/components/music-card';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import useInView from '@/fronted/hooks/useInView';
import i18n from '@/fronted/i18n';
import { toast } from 'react-hot-toast';

const logger = getRendererLogger('ProjectListCard');

const ProjectListCard = ({
    video,
    className,
    onSelected
}: {
    video: WatchHistoryVO;
    className?: string;
    onSelected: () => void;
}) => {
    // 1. 检测是否是 mp3
    const isAudio = MediaUtil.isAudio(video.fileName);
    const showDuration = !video.isFolder && video.duration > 0;
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const inView = useInView(containerRef);

    // 2. 如果是 mp3，就不调用生成缩略图的接口，把 key 设为 null
    const { data: url } = useSWR(
        inView && !isAudio
            ? [SWR_KEY.SPLIT_VIDEO_THUMBNAIL, video.basePath, video.fileName, video.current_position]
            : null,
        async ([_key, path, file, time]) => {
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
            logger.debug('Deleting video from watch history', { id: video.id });
            await fileBrowserApi.deleteWatchHistoryGroup(video.id);
            await swrApiMutate('watch-history/list');
            setDeleteConfirmOpen(false);
        } catch (error) {
            logger.error('Failed to delete video from watch history', { error, id: video.id });
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
                    className="group flex flex-col gap-2.5 text-left cursor-pointer outline-none transition-transform duration-200 hover:-translate-y-0.5"
                    onClick={onSelected}
                >
                    <div className="relative w-full rounded-2xl overflow-hidden bg-card border border-border/60 shadow-2xs transition-shadow duration-200 group-hover:shadow-md group-hover:border-border">
                        {/* 文件夹标记 */}
                        {video.isFolder && (
                            <div className="absolute top-2.5 left-2.5 z-10 text-media-fg/95 bg-media-bg/75 backdrop-blur-md rounded-lg px-2 py-0.5 text-xs font-medium flex items-center gap-1 shadow-2xs">
                                <Folder className="w-3.5 h-3.5" />
                                <span>{i18n.t('common:folderBadge', { defaultValue: '文件夹' })}</span>
                            </div>
                        )}
                        {/* 3. 判断如果是 mp3，优先展示 Music 图标，否则还是原先逻辑 */}
                        {isAudio ? (
                            <MusicCard fileName={video.fileName} />
                        ) : url ? (
                            <img
                                src={UrlUtil.toUrl(url)}
                                style={{
                                    aspectRatio: '16/9'
                                }}
                                className={`w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
                                    hover || contextMenu ? 'brightness-90' : ''
                                }`}
                                alt={video.fileName}
                            />
                        ) : (
                            <div
                                style={{
                                    aspectRatio: '16/9'
                                }}
                                className="w-full bg-muted flex items-center justify-center text-muted-foreground/60"
                            >
                                <Film className="w-8 h-8 stroke-1" />
                            </div>
                        )}

                        {(showDuration || video.isFolder) && (
                            <div className="absolute bottom-2.5 right-2.5 text-media-fg/95 bg-media-bg/75 backdrop-blur-md rounded-lg px-2 py-0.5 text-xs font-medium flex items-center gap-1 shadow-2xs">
                                {!video.isFolder ? (
                                    TimeUtil.secondToTimeStrCompact(video?.duration)
                                ) : (
                                    <ListVideo className="w-3.5 h-3.5" />
                                )}
                            </div>
                        )}

                        {/* 进度条 */}
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

                        {/* 悬浮时展示删除按钮 */}
                        {hover && (
                            <div className="absolute top-2.5 right-2.5 z-10">
                                <IconButton
                                    label={i18n.t('common:delete')}
                                    icon={<Trash2 className="w-3.5 h-3.5" />}
                                    variant="ghost"
                                    size="sm"
                                    className="text-media-fg/90 bg-media-bg/60 hover:bg-media-bg/90 backdrop-blur-md rounded-lg"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteConfirmOpen(true);
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    <VStack gap={0.5} width="100%">
                        <Text
                            type="body"
                            weight="medium"
                            maxLines={2}
                        >
                            {video.displayFileName ?? video.fileName}
                        </Text>
                        {video.isFolder && (
                            <Text type="supporting" color="secondary" maxLines={1}>
                                {i18n.t('common:recentPlayedVideo', {
                                    name: video.fileName,
                                    defaultValue: `最近播放：${video.fileName}`,
                                })}
                            </Text>
                        )}
                    </VStack>
                </div>
            <AlertDialog
                isOpen={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title={i18n.t('common:deleteConfirmTitle', { defaultValue: '移除观看记录？' })}
                description={i18n.t('common:deleteConfirmDesc', {
                    defaultValue: '此操作仅从播放历史中移除该项记录，不会删除磁盘上的本地文件。',
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

export default ProjectListCard;
