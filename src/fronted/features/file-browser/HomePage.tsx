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
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Center } from '@astryxdesign/core/Center';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import useSWR from 'swr';
import { apiPath } from '@/fronted/lib/swr-util';
import {
    BookOpen,
    ChevronsDown,
    Clock,
    Settings,
} from 'lucide-react';
import FolderSelector, { FolderSelectAction } from '@/fronted/features/file-browser/components/FolderSelector';
import FileSelector, { FileAction } from '@/fronted/features/file-browser/components/FileSelector';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import YoutubeImportButton from '@/fronted/features/youtube-import/YoutubeImportButton';
import YoutubeImportHero from '@/fronted/features/youtube-import/YoutubeImportHero';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { NAV_TESTIDS } from '@/common/constants/qa-testids';

const logger = getRendererLogger('HomePage');

/**
 * 应用主页：展示最近观看记录、快速文件导入入口与功能导航。
 */
const HomePage = () => {
    const { t } = useI18nTranslation('nav');
    const { t: tc } = useI18nTranslation('common');
    const navigate = useNavigate();
    const changeSideBar = useLayout((s) => s.changeSideBar);

    async function handleClickById(vId: string) {
        await fileBrowserApi.changeWindowSize('player');
        changeSideBar(false);
        navigate(`/player/${vId}`);
    }

    const { data: vpsBasic } = useSWR(apiPath('watch-history/list/basic'), fileBrowserApi.listBasicWatchHistory);
    const [vpsFull, setVpsFull] = React.useState<typeof vpsBasic>(undefined);
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
        let cancelled = false;
        let idleId: number | null = null;

        const loadFullList = async () => {
            try {
                const full = await fileBrowserApi.listWatchHistory();
                if (!cancelled) {
                    setVpsFull(full);
                }
            } catch (error) {
                logger.warn('failed to load full watch history list', { error: error instanceof Error ? error.message : String(error) });
            }
        };

        idleId = window.requestIdleCallback(() => {
            void loadFullList();
        }, { timeout: 1500 });

        return () => {
            cancelled = true;
            if (idleId !== null && 'cancelIdleCallback' in window) {
                window.cancelIdleCallback(idleId);
            }
        };
    }, []);

    const navItems = [
        { title: t('vocabularyStudio'), path: '/vocabulary', icon: BookOpen, testId: NAV_TESTIDS.vocabulary },
        { title: t('settingsCenter'), path: '/settings', icon: Settings, testId: NAV_TESTIDS.settings },
    ];

    const hasHistory = vps && vps.length > 0;

    return (
        <Layout
            height="fill"
            header={
                <LayoutHeader height={36} hasDivider={false}>
                    <TitleBar maximizable={false} className="w-full h-full" />
                </LayoutHeader>
            }
            start={
                <LayoutPanel width={220} padding={3} hasDivider={false}>
                    <VStack gap={6} height="100%" justify="between">
                        <VStack gap={4}>
                            {/* 品牌字标固定用正文字体：主题标题字体（如 Matcha 的 Playwrite）
                                字宽很大，放进 220px 侧栏会折成两行 */}
                            <Heading level={1} weight="bold" className="font-sans px-2">
                                DashPlayer
                            </Heading>
                            {/* SideNav 默认固定 260px，而侧栏内容区只有 196px，
                                直接用会撑出横向滚动条；这里让导航填满侧栏宽度 */}
                            <div className="w-full [&_.astryx-side-nav]:!w-full">
                                <SideNav>
                                    {navItems.map((item) => (
                                        <SideNavItem
                                            key={item.path}
                                            data-testid={item.testId}
                                            label={item.title}
                                            icon={<Icon icon={item.icon as unknown as IconType} size="sm" />}
                                            href={item.path}
                                            onClick={() => fileBrowserApi.changeWindowSize('player')}
                                        />
                                    ))}
                                </SideNav>
                            </div>
                        </VStack>
                    </VStack>
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

                            {/* 最近观看区 */}
                            <VStack gap={3} width="100%">
                                <HStack vAlign="center" hAlign="between" width="100%">
                                    <HStack vAlign="center" gap={2}>
                                        <Clock className="h-4 w-4 text-secondary" />
                                        <Heading level={3}>
                                            {tc('recentWatch')}
                                        </Heading>
                                    </HStack>
                                    <Text type="supporting" color="secondary">
                                        {tc('pickUpWhereLeftOff')}
                                    </Text>
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
