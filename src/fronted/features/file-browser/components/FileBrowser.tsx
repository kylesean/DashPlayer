import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { VStack } from '@astryxdesign/core/VStack';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import ProjectListComp from '@/fronted/features/file-browser/components/project-list-comp';
import { Folder, X } from 'lucide-react';
import { apiPath, swrApiMutate } from '@/fronted/lib/swr-util';
import FolderSelector, { FolderSelectAction } from '@/fronted/features/file-browser/components/FolderSelector';
import FileSelector, { FileAction } from '@/fronted/features/file-browser/components/FileSelector';
import VideoItem2, { type BrowserItemVariant } from '@/fronted/features/file-browser/components/VideoItem2';
import ProjItem2 from '@/fronted/features/file-browser/components/ProjItem2';
import PathUtil from '@/common/utils/PathUtil';
import useSWR from 'swr';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';
import BackNavItem from '@/fronted/features/file-browser/components/BackNavItem';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import { useTranslation } from 'react-i18next';

const logger = getRendererLogger('FileBrowser');
const FileBrowser = () => {
    const navigate = useNavigate();
    const { t } = useTranslation('common');
    const file = usePlaybackSession(state => state.videoPath);
    const videoId = usePlaybackSession(state => state.videoId);
    const cardRef = useRef<HTMLDivElement>(null);
    const [showTitle, setShowTitle] = useState(true);

    const [previousData, setPreviousData] = useState<WatchHistoryVO | null>(null);

    useEffect(() => {
        const checkHeight = () => {
            setShowTitle(window.innerHeight > 800);
        };

        checkHeight();
        window.addEventListener('resize', checkHeight);
        return () => window.removeEventListener('resize', checkHeight);
    }, []);
    const { data } = useSWR(
        [apiPath('watch-history/detail'), videoId],
        ([_p, v]) => fileBrowserApi.getWatchHistoryDetail(v ?? ''),
        {
            revalidateOnFocus: false,
            fallbackData: previousData,
            onSuccess: (data) => {
                setPreviousData(data);
            }
        }
    );
    return (
        <Card
            width="100%"
            height="fill"
            padding={4}
            variant="default"
        >
            <VStack width="100%" height="fill" gap={3}>
                {showTitle && (
                    <Heading level={3} weight="semibold">
                        {t('videoExplorer')}
                    </Heading>
                )}
                <div className="flex items-center gap-2.5 shrink-0">
                    <div className="flex-1 min-w-0">
                        <FileSelector
                            withMkv
                            onSelected={FileAction.playerAction(navigate)}
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        <FolderSelector
                            onSelected={FolderSelectAction.defaultAction2(async (vid) => {
                                navigate(`/player/${vid}`);
                            })}
                        />
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                    <ProjectListComp
                        enterProj={data?.isFolder ? data?.basePath : ''}
                        backEle={(root, currentPath, hc) => (
                            <BackNavItem
                                root={root}
                                currentPath={currentPath}
                                onClick={hc}
                            />
                        )}
                        videoEle={(pv) => {
                            let variant: BrowserItemVariant = 'normal';
                            if (file === PathUtil.join(pv.basePath, pv.fileName)) {
                                variant = 'highlight';
                            } else if (pv.current_position > 5) {
                                variant = 'lowlight';
                            }
                            return (
                                <VideoItem2
                                    onClick={() => navigate(`/player/${pv.id}`)}
                                    pv={pv}
                                    ctxMenus={[
                                        {
                                            icon: <Folder />,
                                            text: t('showInExplorer'),
                                            onClick: async () => {
                                                await fileBrowserApi.openFolder(pv.basePath);
                                            }
                                        }
                                    ]} variant={variant} />
                            );
                        }}
                        projEle={(p, hc) => {
                            const ctxMenus = [
                                {
                                    icon: <Folder />,
                                    text: t('showInExplorer'),
                                    onClick: async () => {
                                        await fileBrowserApi.openFolder(p.basePath);
                                    }
                                },
                                {
                                    icon: <X />,
                                    text: t('delete'),
                                    disabled: file === PathUtil.join(p.basePath, p.fileName),
                                    onClick: async () => {
                                        await fileBrowserApi.deleteWatchHistoryGroup(p.id);
                                        await swrApiMutate('watch-history/list');
                                    }
                                }
                            ];
                            let variant: BrowserItemVariant = 'normal';
                            if (file === PathUtil.join(p.basePath, p.fileName)) {
                                variant = 'highlight';
                            } else if (!p.isFolder && p?.current_position > 5) {
                                variant = 'lowlight';
                            }
                            return (
                                <ProjItem2 v={p}
                                           variant={variant}
                                           onClick={async () => {
                                               logger.debug('project clicked', { projectId: p.id });
                                               hc();
                                               if (!p.isFolder) {
                                                   navigate(`/player/${p.id}`);
                                               }
                                           }}
                                           ctxMenus={ctxMenus} />
                            );
                        }}
                        className="w-full h-full scrollbar-none"
                    />
                </div>
            </VStack>
        </Card>
    );
};

export default FileBrowser;
