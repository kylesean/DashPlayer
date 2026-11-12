import React from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { Compass, Film, Play, X } from 'lucide-react';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';

import type {
    ContentCompassItemVO,
    ContentCompassVO,
} from '@/common/types/contentCompass';
import { contentCompassApi } from '@/fronted/features/content-compass/contentCompassApi';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import useInView from '@/fronted/hooks/useInView';
import { cn } from '@/fronted/lib/utils';
import PathUtil from '@/common/utils/PathUtil';
import UrlUtil from '@/common/utils/UrlUtil';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { useReviewDockStore } from '@/fronted/features/player/components/learning-toolbar/reviewDockStore';

const logger = getRendererLogger('ContentCompassSection');
const IMPRESSION_STORAGE_PREFIX = 'dashplayer:content-compass:shown';

export interface ContentCompassSectionProps {
    excludeVideoIds?: string[];
    onSelected: (videoId: string) => void;
}

/**
 * 首页内容指南针：在用户主动浏览媒体库时给出三段低干扰推荐。
 *
 * 不自动播放、不弹窗；推荐失败或没有可用字幕时整段静默隐藏。
 */
export default function ContentCompassSection({
    excludeVideoIds = [],
    onSelected,
}: ContentCompassSectionProps) {
    const { t } = useTranslation('compass');
    const excludeKey = React.useMemo(
        () => [...excludeVideoIds].sort().join('|'),
        [excludeVideoIds],
    );
    const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(() => new Set());
    const { data, error } = useSWR<ContentCompassVO>(
        ['content-compass/list', excludeKey],
        () => contentCompassApi.list({ excludeVideoIds, limit: 3 }),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    );

    React.useEffect(() => {
        if (error) {
            logger.warn('content compass load failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }, [error]);

    const visible = React.useMemo(
        () => (data?.items ?? []).filter((item) => !dismissedIds.has(item.videoId)),
        [data, dismissedIds],
    );

    React.useEffect(() => {
        for (const item of visible) {
            if (!markImpressionOnce(item.videoId)) {
                continue;
            }
            void contentCompassApi.recordEvent({
                videoId: item.videoId,
                action: 'shown',
                score: item.score,
                reasonCode: item.reason.code,
                surface: 'home',
            }).catch((reason) => {
                logger.warn('content compass impression failed', {
                    videoId: item.videoId,
                    error: reason instanceof Error ? reason.message : String(reason),
                });
            });
        }
    }, [visible]);

    if (error || visible.length === 0) {
        return null;
    }

    const handleOpen = (item: ContentCompassItemVO) => {
        void contentCompassApi.recordEvent({
            videoId: item.videoId,
            action: 'opened',
            score: item.score,
            reasonCode: item.reason.code,
            surface: 'home',
        }).catch((reason) => {
            logger.warn('content compass open event failed', {
                videoId: item.videoId,
                error: reason instanceof Error ? reason.message : String(reason),
            });
        });
        onSelected(item.videoId);
    };

    const handleDismiss = (item: ContentCompassItemVO) => {
        setDismissedIds((current) => {
            const next = new Set(current);
            next.add(item.videoId);
            return next;
        });
        void contentCompassApi.recordEvent({
            videoId: item.videoId,
            action: 'dismissed',
            score: item.score,
            reasonCode: item.reason.code,
            surface: 'home',
        }).catch((reason) => {
            logger.warn('content compass dismiss event failed', {
                videoId: item.videoId,
                error: reason instanceof Error ? reason.message : String(reason),
            });
        });
    };

    /**
     * 从推荐直接进入到期复习：跳转到推荐视频并打开播放器的复习坞。
     *
     * 必须导航：只挂起「打开复习坞」请求时，用户停留在首页点击后界面毫无
     * 反应，而这次点击已经被记为一次 `reviewed`（reviewRate 的分子），统计
     * 的是从未发生的复习。跟随推荐进入视频后，延迟打开的复习坞在播放器内
     * 兑现，推荐到复习的闭环才算接上。
     */
    const handleReviewDue = (item: ContentCompassItemVO) => {
        void contentCompassApi.recordEvent({
            videoId: item.videoId,
            action: 'reviewed',
            score: item.score,
            reasonCode: item.reason.code,
            surface: 'home',
        }).catch((reason) => {
            logger.warn('content compass review event failed', {
                videoId: item.videoId,
                error: reason instanceof Error ? reason.message : String(reason),
            });
        });
        useReviewDockStore.getState().open();
        onSelected(item.videoId);
    };

    return (
        <VStack gap={3} width="100%">
            <HStack vAlign="center" gap={2} width="100%">
                <Compass className="h-4 w-4 text-accent" />
                <VStack gap={0.5}>
                    <HStack vAlign="center" gap={2}>
                        <Heading level={3}>{t('title')}</Heading>
                        <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-metadata font-medium text-secondary">
                            {t('localBadge')}
                        </span>
                    </HStack>
                    <Text type="supporting" color="secondary">
                        {t('subtitle')}
                    </Text>
                </VStack>
            </HStack>
            <Grid columns={{ minWidth: 240, max: 3 }} gap={5}>
                {visible.map((item) => (
                    <CompassCard
                        key={item.videoId}
                        item={item}
                        onOpen={() => handleOpen(item)}
                        onDismiss={() => handleDismiss(item)}
                        onReviewDue={() => handleReviewDue(item)}
                    />
                ))}
            </Grid>
        </VStack>
    );
}

function CompassCard({
    item,
    onOpen,
    onDismiss,
    onReviewDue,
}: {
    item: ContentCompassItemVO;
    onOpen: () => void;
    onDismiss: () => void;
    onReviewDue: () => void;
}) {
    const { t } = useTranslation('compass');
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const inView = useInView(containerRef);
    const { data: thumbnail } = useSWR(
        inView
            ? ['content-compass-thumbnail', item.basePath, item.fileName, item.currentPosition]
            : null,
        async ([, basePath, fileName, position]) => fileBrowserApi.getThumbnail(
            PathUtil.join(String(basePath), String(fileName)),
            Number(position) > 0 ? Number(position) : 12,
        ),
    );
    const reason = resolveReasonText(t, item);
    const displayName = item.fileName.replace(/\.[^.]+$/u, '');

    return (
        <div ref={containerRef} className="group relative min-w-0">
            <button
                type="button"
                aria-label={t('open', { name: displayName })}
                onClick={onOpen}
                className="w-full text-left outline-none rounded-2xl focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-body"
            >
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xs transition-[border-color,box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-border group-hover:shadow-md">
                    {thumbnail ? (
                        <img
                            src={UrlUtil.toUrl(thumbnail)}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted/70 via-card to-muted/30">
                            <Film className="h-8 w-8 stroke-1 text-secondary/45" />
                        </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-media-bg/60 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-media-bg/75 px-2 py-1 text-metadata font-medium text-media-fg/95 backdrop-blur-md">
                        {t('comprehension', { percent: Math.round(item.comprehension * 100) })}
                    </span>
                    <span className="absolute bottom-2.5 right-2.5 flex h-7 w-7 translate-y-1 items-center justify-center rounded-full bg-media-bg/80 text-media-fg opacity-0 backdrop-blur-md transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                        <Play className="h-3.5 w-3.5 fill-current" />
                    </span>
                </div>
                <VStack gap={1} width="100%" className="pt-2.5">
                    <Text type="body" weight="medium" maxLines={2}>
                        {displayName}
                    </Text>
                    <Text type="supporting" color="secondary" maxLines={2}>
                        {reason}
                    </Text>
                </VStack>
            </button>
            <IconButton
                label={t('dismiss')}
                tooltip={t('dismiss')}
                icon={<X className="h-3.5 w-3.5" />}
                variant="ghost"
                size="sm"
                className={cn(
                    'absolute right-2 top-2 bg-media-bg/65 text-media-fg/90 opacity-0 backdrop-blur-md',
                    'transition-opacity duration-200 hover:bg-media-bg/90 group-hover:opacity-100 focus-visible:opacity-100',
                )}
                onClick={onDismiss}
            />
            {item.reason.dueCount > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={onReviewDue}
                        className="inline-flex h-6 items-center rounded-md bg-warning-muted/60 px-2 text-metadata font-medium text-warning-text transition-colors hover:bg-warning-muted"
                    >
                        {t('reviewDue', { count: item.reason.dueCount })}
                    </button>
                    {item.reason.words.length > 0 && (
                        <span className="truncate text-metadata text-secondary">
                            {item.reason.words.join(' · ')}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

type Translate = ReturnType<typeof useTranslation>['t'];

/**
 * 将结构化推荐理由渲染为短句，文案只解释证据，不暴露内部分数。
 */
function resolveReasonText(t: Translate, item: ContentCompassItemVO): string {
    const words = item.reason.words.join(' · ');
    if (item.reason.code === 'due_review') {
        return t('reasonDue', { words, count: item.reason.dueCount });
    }
    if (item.reason.code === 'learning_words') {
        return t('reasonLearning', { words, count: item.reason.learningCount });
    }
    if (item.reason.code === 'interest_match') {
        return t('reasonInterest');
    }
    return t('reasonNext');
}

/**
 * 同一视频同一自然日只上报一次曝光，避免打开首页就刷高曝光量。
 */
function markImpressionOnce(videoId: string): boolean {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${IMPRESSION_STORAGE_PREFIX}:${day}:${videoId}`;
    try {
        if (window.localStorage.getItem(key)) {
            return false;
        }
        window.localStorage.setItem(key, '1');
        return true;
    } catch {
        return true;
    }
}
