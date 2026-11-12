import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TitleBar from '@/fronted/components/layout/TitleBar/TitleBar';
import useLayout from '@/fronted/app/stores/layoutStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import ProjectListCard from '@/fronted/features/file-browser/components/project-list-card';
import ProjectListItem from '@/fronted/features/file-browser/components/project-list-item';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from '@astryxdesign/core/Layout';
import { TITLE_BAR_HEIGHT } from '@/fronted/components/layout/TitleBar/titleBarMetrics';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Center } from '@astryxdesign/core/Center';
import SideBar from '@/fronted/components/layout/SideBar';
import useSWR from 'swr';
import { apiPath } from '@/fronted/lib/swr-util';
import {
    ChevronsDown,
    Clock,
    Play,
} from 'lucide-react';
import FolderSelector, { FolderSelectAction } from '@/fronted/features/file-browser/components/FolderSelector';
import FileSelector, { FileAction } from '@/fronted/features/file-browser/components/FileSelector';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import YoutubeImportButton from '@/fronted/features/youtube-import/YoutubeImportButton';
import YoutubeImportHero from '@/fronted/features/youtube-import/YoutubeImportHero';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import ContentCompassSection from '@/fronted/features/content-compass/ContentCompassSection';

const logger = getRendererLogger('HomePage');

/**
 * 应用主页：展示最近观看记录、快速文件导入入口与功能导航。
 */
const HomePage = () => {
    const { t: tc } = useI18nTranslation('common');
    const navigate = useNavigate();
    const changeSideBar = useLayout((s) => s.changeSideBar);
    const sidebarCollapsed = useLayout((s) => s.sidebarCollapsed);

    async function handleClickById(vId: string) {
        await fileBrowserApi.changeWindowSize('player');
        changeSideBar(false);
        navigate(`/player/${vId}`);
    }

    const { data: vpsBasic } = useSWR(
        apiPath('watch-history/list/basic'),
        fileBrowserApi.listBasicWatchHistory,
        { revalidateOnMount: true, dedupingInterval: 0 }
    );
    const [fullHistoryReady, setFullHistoryReady] = React.useState(false);
    const { data: vpsFull } = useSWR(
        fullHistoryReady ? apiPath('watch-history/list') : null,
        fileBrowserApi.listWatchHistory,
        {
            revalidateOnMount: true,
            dedupingInterval: 0,
            onError: (error) => {
                logger.warn('failed to load full watch history list', {
                    error: error instanceof Error ? error.message : String(error),
                });
            },
        }
    );
    const vps = vpsFull ?? vpsBasic;
    const clear = usePlaybackSession((s) => s.clear);
    const [num, setNum] = React.useState(4);
    // 从第四个开始截取num个
    const rest = vps?.slice(3, num + 3);

    useEffect(() => {
        fileBrowserApi.changeWindowSize('home').then();
        clear();
    }, [clear]);

    useEffect(() => {
        let timerId: ReturnType<typeof setTimeout> | null = null;
        let idleId: number | null = null;

        if ('requestIdleCallback' in window) {
            idleId = window.requestIdleCallback(() => {
                setFullHistoryReady(true);
            }, { timeout: 1500 });
        } else {
            timerId = globalThis.setTimeout(() => {
                setFullHistoryReady(true);
            }, 0);
        }

        return () => {
            if (idleId !== null && 'cancelIdleCallback' in window) {
                window.cancelIdleCallback(idleId);
            }
            if (timerId !== null) {
                globalThis.clearTimeout(timerId);
            }
        };
    }, []);

    const hasHistory = vps && vps.length > 0;

    return (
        <Layout
            height="fill"
            header={
                <LayoutHeader height={TITLE_BAR_HEIGHT} padding={0} hasDivider={false}>
                    <TitleBar maximizable={false} className="w-full" />
                </LayoutHeader>
            }
            start={
                <LayoutPanel
                    width={sidebarCollapsed ? 56 : 208}
                    padding={0}
                    hasDivider={false}
                    className="h-full overflow-hidden transition-[width] duration-200"
                >
                    <SideBar compact={sidebarCollapsed} />
                </LayoutPanel>
            }
            content={
                <LayoutContent isScrollable padding={6}>
                    {hasHistory ? (
                        <VStack gap={8} width="100%">
                            {/* 顶部快速打开区域：简洁优雅的卡片 */}
                            <Card variant="default" padding={4}>
                                <HStack vAlign="center" hAlign="between" gap={4} width="100%">
                                    <VStack gap={0.5}>
                                        <Text type="body" weight="semibold">
                                            {tc('quickStartTitle')}
                                        </Text>
                                        <Text type="supporting" color="secondary">
                                            {tc('quickStartDesc')}
                                        </Text>
                                    </VStack>
                                    <HStack vAlign="center" gap={3}>
                                        <div className="w-36">
                                            <FileSelector
                                                onSelected={FileAction.playerAction2(navigate)}
                                                withMkv
                                            />
                                        </div>
                                        <div className="w-36">
                                            <FolderSelector
                                                onSelected={FolderSelectAction.defaultAction2(async (vid) => {
                                                    await fileBrowserApi.changeWindowSize('player');
                                                    changeSideBar(false);
                                                    navigate(`/player/${vid}`);
                                                })}
                                            />
                                        </div>
                                        <YoutubeImportButton />
                                    </HStack>
                                </HStack>
                            </Card>

                            <ContentCompassSection
                                excludeVideoIds={vps?.slice(0, 3).map((video) => video.id)}
                                onSelected={handleClickById}
                            />

                            {/* 最近观看区 */}
                            <VStack gap={3} width="100%">
                                <HStack vAlign="center" hAlign="between" width="100%">
                                    <HStack vAlign="center" gap={2}>
                                        <Clock className="h-4 w-4 text-secondary" />
                                        <Heading level={3}>
                                            {tc('recentWatch')}
                                        </Heading>
                                    </HStack>
                                    {vps && vps.length > 0 && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={<Play className="h-3.5 w-3.5 fill-current" />}
                                            onClick={() => handleClickById(vps[0].id)}
                                            label={tc('pickUpWhereLeftOff')}
                                        />
                                    )}
                                </HStack>

                                <Grid columns={{ minWidth: 240, max: 4 }} gap={5}>
                                    {vps?.slice(0, 3).map((v) => (
                                        <ProjectListCard
                                            key={v.id}
                                            onSelected={() => handleClickById(v.id)}
                                            video={v}
                                        />
                                    ))}
                                </Grid>
                            </VStack>

                            {/* 历史记录列表区 */}
                            {rest && rest.length > 0 && (
                                <VStack gap={2} width="100%">
                                    <Heading level={4} color="secondary">
                                        {tc('earlierRecords')}
                                    </Heading>
                                    <VStack gap={1} width="100%">
                                        {rest.map((v) => (
                                            <ProjectListItem
                                                key={v.id}
                                                onSelected={() => handleClickById(v.id)}
                                                video={v}
                                            />
                                        ))}
                                    </VStack>
                                </VStack>
                            )}

                            {vps && (num + 3 < vps.length) && (
                                <HStack hAlign="center" width="100%">
                                    <Button
                                        label={tc('loadMore')}
                                        variant="ghost"
                                        size="sm"
                                        icon={<ChevronsDown className="h-3.5 w-3.5" />}
                                        onClick={() => setNum(num + 10)}
                                    />
                                </HStack>
                            )}
                        </VStack>
                    ) : (
                        /* 无播放历史时的专属初始场景：YouTube 优先动线 */
                        <Center height="100%" minHeight={420}>
                            <YoutubeImportHero />
                        </Center>
                    )}
                </LayoutContent>
            }
        />
    );
};

export default HomePage;
