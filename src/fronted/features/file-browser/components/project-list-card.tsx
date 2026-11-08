import useSWR from 'swr';
import React from 'react';
import { SWR_KEY, swrApiMutate } from '@/fronted/lib/swr-util';
import { Film, ListVideo, Trash2 } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import TimeUtil from '@/common/utils/TimeUtil';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger
} from '@/fronted/components/ui/context-menu';
import UrlUtil from '@/common/utils/UrlUtil';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';
import PathUtil from '@/common/utils/PathUtil';
import MediaUtil from '@/common/utils/MediaUtil';
import MusicCard from '@/fronted/features/file-browser/components/music-card';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import useInView from '@/fronted/hooks/useInView';
import i18n from '@/fronted/i18n';

const logger = getRendererLogger('ProjectListCard');

const ProjectListCard = ({
    video,
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

    const percent = showDuration
        ? Math.floor(((video?.current_position || 0) / (video?.duration || 1)) * 100)
        : 0;

    return (
        <ContextMenu
            onOpenChange={(open) => {
                setContextMenu(open);
            }}
        >
            <ContextMenuTrigger>
                <div
                    ref={containerRef}
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
                            <div className="absolute bottom-2.5 right-2.5 text-white/95 bg-black/75 backdrop-blur-md rounded-lg px-2 py-0.5 text-xs font-medium flex items-center gap-1 shadow-2xs">
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
                            <div className="absolute top-2.5 right-2.5">
                                <IconButton
                                    label={i18n.t('common:delete')}
                                    icon={<Trash2 className="w-3.5 h-3.5" />}
                                    variant="ghost"
                                    size="sm"
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        logger.debug('Deleting video from watch history', { id: video.id });
                                        await fileBrowserApi.deleteWatchHistoryGroup(video.id);
                                        await swrApiMutate('watch-history/list');
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
                            {video.fileName}
                        </Text>
                    </VStack>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem
                    onClick={async () => {
                        await fileBrowserApi.openFolder(video.basePath);
                    }}
                >
                    {i18n.t('common:showInExplorer')}
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={async () => {
                        await fileBrowserApi.deleteWatchHistoryGroup(video.id);
                        await swrApiMutate('watch-history/list');
                    }}
                >
                    {i18n.t('common:delete')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
};

export default ProjectListCard;
