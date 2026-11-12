import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, ChevronRight, Film, Layers, Play, Sparkles } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';

import type { MemoryMapVO, MemoryMapWordVO } from '@/common/types/memoryMap';
import type { WordStatus } from '@/common/types/vocabulary';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import { cn } from '@/fronted/lib/utils';

/** 记忆图谱在词汇工坊/语境工坊中的入参。 */
export interface MemoryMapSectionProps {
    /** 点击词条时跳转到该词的片段。 */
    onSelectWord: (word: string) => void;
    /**
     * 开始按主题顺序连续学习。
     *
     * 传入该主题代表词的有序列表；由调用方决定「连续学习」具体表现
     * （当前实现是按顺序筛选词表），图谱本身不复制一套学习流程。
     */
    onStartTopicQueue?: (words: string[]) => void;
    /** 是否默认展开（在独立画布视图中可设为 true）。 */
    defaultExpanded?: boolean;
    /** 是否隐藏外层折叠按钮与外层卡片边框（用于独立全屏视图中直接展示）。 */
    hideCollapseToggle?: boolean;
}

const STATUS_ORDER: readonly WordStatus[] = ['learning', 'familiar', 'known', 'ignored'];

const STATUS_I18N: Record<WordStatus, string> = {
    learning: 'wordStatusLearning',
    familiar: 'wordStatusFamiliar',
    known: 'wordStatusKnown',
    ignored: 'wordStatusIgnored',
};

const STATUS_BAR_CLASS: Record<WordStatus, string> = {
    learning: 'bg-warning-text/75',
    familiar: 'bg-accent/65',
    known: 'bg-success/75',
    ignored: 'bg-muted-foreground/30',
};

const STATUS_DOT_CLASS: Record<WordStatus, string> = {
    learning: 'bg-warning-text/80',
    familiar: 'bg-accent/70',
    known: 'bg-success/80',
    ignored: 'bg-muted-foreground/40',
};

/**
 * 主题显示名。
 *
 * 优先用视频文件名；没有文件名时用本地关键词拼一个可读的临时名字，
 * 仍然没有关键词才退回「未命名内容」。这里不生成假标题：关键词本身
 * 就是「这组词为什么在一起」的证据。
 */
const topicLabel = (
    topic: { label: string | null; keywords?: string[] },
    t: (key: string, options?: Record<string, unknown>) => string,
): string => {
    if (topic.label) {
        return topic.label;
    }
    if (topic.keywords && topic.keywords.length > 0) {
        return t('keywordTopic', { words: topic.keywords.slice(0, 2).join(' · ') });
    }
    return t('untitledTopic');
};

/**
 * 个人记忆图谱：按真实视频主题聚合词，并按记忆阶段分带。
 *
 * 只读取本地数据；没有词时整段隐藏，避免空面板噪声。
 */
export default function MemoryMapSection({
    onSelectWord,
    onStartTopicQueue,
    defaultExpanded = false,
    hideCollapseToggle = false,
}: MemoryMapSectionProps) {
    const { t } = useTranslation(['memoryMap', 'common']);
    const [expanded, setExpanded] = useState(defaultExpanded);
    const { data, error } = useSWR<MemoryMapVO>(
        'learning-data/memory-map',
        () => learningDataApi.getMemoryMap({ limit: 8 }),
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );

    const topics = useMemo(() => data?.topics ?? [], [data?.topics]);
    if (error || !data || data.totalWords === 0) {
        return null;
    }

    const isExpanded = hideCollapseToggle || expanded;

    return (
        <section
            className={cn(
                hideCollapseToggle
                    ? 'flex flex-col gap-4'
                    : 'rounded-2xl border border-border/60 bg-card px-4 py-3',
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <HStack vAlign="center" gap={3}>
                    <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                        <Brain className="h-4 w-4" />
                    </div>
                    <VStack gap={0.5}>
                        <HStack vAlign="center" gap={2}>
                            <Text type="body" weight="semibold">{t('title')}</Text>
                            <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-metadata font-medium text-muted-foreground">
                                {t('localBadge')}
                            </span>
                        </HStack>
                        <Text type="supporting" color="secondary">
                            {t('summary', {
                                total: data.totalWords,
                                active: data.activeWords,
                                topics: topics.length,
                            })}
                        </Text>
                    </VStack>
                </HStack>

                <div className="flex items-center gap-3 shrink-0">
                    {isExpanded && (
                        <div className="hidden sm:flex items-center gap-3 text-metadata text-muted-foreground">
                            {(['learning', 'familiar', 'known'] as const).map((st) => (
                                <span key={st} className="inline-flex items-center gap-1.5">
                                    <span className={cn('w-2 h-2 rounded-full', STATUS_DOT_CLASS[st])} />
                                    <span>{t(`common:${STATUS_I18N[st]}`)}</span>
                                </span>
                            ))}
                        </div>
                    )}
                    {!hideCollapseToggle && (
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={expanded
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                            label={expanded ? t('collapse') : t('expand')}
                            onClick={() => setExpanded((current) => !current)}
                        />
                    )}
                </div>
            </div>

            {isExpanded && (
                <div className={cn(!hideCollapseToggle && 'mt-3')}>
                    <div className="flex flex-col gap-4">
                        <div
                            className={cn(
                                'grid grid-cols-1 gap-3.5',
                                hideCollapseToggle ? 'md:grid-cols-2 xl:grid-cols-3' : 'lg:grid-cols-2',
                            )}
                        >
                            {topics.map((topic) => (
                                <TopicCard
                                    key={topic.key}
                                    label={topicLabel(topic, t)}
                                    isVideoTopic={Boolean(topic.label)}
                                    keywords={topic.keywords}
                                    counts={topic.counts}
                                    words={topic.words}
                                    onSelectWord={onSelectWord}
                                    onStartQueue={onStartTopicQueue}
                                />
                            ))}
                        </div>

                        {data.looseWords && (
                            <LooseWordsBanner
                                label={t('looseTitle')}
                                hint={t('looseHint')}
                                counts={data.looseWords.counts}
                                words={data.looseWords.words}
                                onSelectWord={onSelectWord}
                                onStartQueue={onStartTopicQueue}
                            />
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

/**
 * 单个主题卡：来源类型 + 阶段分布 + 代表词 + 队列学习入口。
 */
function TopicCard({
    label,
    isVideoTopic,
    keywords,
    counts,
    words,
    onSelectWord,
    onStartQueue,
}: {
    label: string;
    isVideoTopic: boolean;
    keywords?: string[];
    counts: Record<WordStatus, number>;
    words: MemoryMapWordVO[];
    onSelectWord: (word: string) => void;
    onStartQueue?: (words: string[]) => void;
}) {
    const { t } = useTranslation(['memoryMap', 'common']);
    const total = STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);
    const statusLabel = (status: WordStatus) => t(`common:${STATUS_I18N[status]}`);
    const distributionLabel = STATUS_ORDER
        .filter((status) => counts[status] > 0)
        .map((status) => `${statusLabel(status)} ${counts[status]}`)
        .join(' · ');

    return (
        <div className="h-full rounded-lg border border-border/50 bg-surface/50 hover:border-border/90 hover:bg-surface/80 transition-colors p-3.5 flex flex-col justify-between gap-3">
            <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span
                            className={cn(
                                'w-6 h-6 rounded-md flex items-center justify-center shrink-0',
                                isVideoTopic ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground',
                            )}
                        >
                            {isVideoTopic ? <Film className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                        </span>
                        <Text type="body" weight="semibold" maxLines={1}>
                            {label}
                        </Text>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted/70 px-2 py-0.5 text-metadata font-medium text-muted-foreground tabular-nums">
                        {t('wordCount', { count: total })}
                    </span>
                </div>

                {isVideoTopic && keywords && keywords.length > 0 && (
                    <Text type="supporting" color="secondary" maxLines={1}>
                        {t('topicKeywords', { words: keywords.join(' · ') })}
                    </Text>
                )}

                <div className="flex flex-col gap-1">
                    {distributionLabel && (
                        <div className="text-metadata text-muted-foreground tabular-nums truncate">
                            {distributionLabel}
                        </div>
                    )}
                    <div
                        className="flex h-1 w-full overflow-hidden rounded-full bg-muted/60"
                        role="img"
                        aria-label={distributionLabel}
                    >
                        {STATUS_ORDER.map((status) => (
                            counts[status] > 0 && (
                                <span
                                    key={status}
                                    className={cn('h-full transition-all', STATUS_BAR_CLASS[status])}
                                    style={{ width: `${(counts[status] / Math.max(1, total)) * 100}%` }}
                                />
                            )
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {words.map((word) => (
                        <WordChip
                            key={word.word}
                            word={word}
                            statusLabel={statusLabel(word.status)}
                            neighborsLabel={
                                word.neighbors && word.neighbors.length > 0
                                    ? t('neighborsHint', {
                                        words: word.neighbors.map((neighbor) => neighbor.word).join(', '),
                                    })
                                    : null
                            }
                            onClick={() => onSelectWord(word.word)}
                        />
                    ))}
                </div>
            </div>

            {onStartQueue && words.length > 0 && (
                <div className="pt-2 border-t border-border/30 flex items-center justify-end">
                    <Button
                        variant="secondary"
                        size="sm"
                        icon={<Play className="w-3 h-3" />}
                        label={t('startQueue')}
                        onClick={() => onStartQueue(words.map((word) => word.word))}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * 零散/无上下文词汇的降噪横幅：不与真实视频语义主题混占同等卡片权位。
 */
function LooseWordsBanner({
    label,
    hint,
    counts,
    words,
    onSelectWord,
    onStartQueue,
}: {
    label: string;
    hint: string;
    counts: Record<WordStatus, number>;
    words: MemoryMapWordVO[];
    onSelectWord: (word: string) => void;
    onStartQueue?: (words: string[]) => void;
}) {
    const { t } = useTranslation(['memoryMap', 'common']);
    const total = STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);
    const statusLabel = (status: WordStatus) => t(`common:${STATUS_I18N[status]}`);

    return (
        <div className="rounded-lg border border-dashed border-border/60 bg-surface/30 px-4 py-3 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Layers className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Text type="body" weight="medium">{label}</Text>
                    <span className="rounded-full bg-muted/70 px-2 py-0.5 text-metadata font-medium text-muted-foreground tabular-nums">
                        {t('wordCount', { count: total })}
                    </span>
                </div>
                {onStartQueue && words.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Play className="w-3 h-3" />}
                        label={t('startQueue')}
                        onClick={() => onStartQueue(words.map((word) => word.word))}
                    />
                )}
            </div>
            <Text type="supporting" color="secondary">
                {hint}
            </Text>
            <div className="flex flex-wrap items-center gap-1.5">
                {words.map((word) => (
                    <WordChip
                        key={word.word}
                        word={word}
                        statusLabel={statusLabel(word.status)}
                        neighborsLabel={null}
                        onClick={() => onSelectWord(word.word)}
                    />
                ))}
            </div>
        </div>
    );
}

function WordChip({
    word,
    statusLabel,
    neighborsLabel,
    onClick,
}: {
    word: MemoryMapWordVO;
    statusLabel: string;
    neighborsLabel: string | null;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            title={[word.context ?? word.translate ?? word.word, neighborsLabel].filter(Boolean).join('\n')}
            onClick={onClick}
            aria-label={`${word.word} · ${statusLabel}`}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-metadata transition-colors cursor-pointer',
                word.due
                    ? 'border-warning-text/30 bg-warning-muted/50 text-warning-text hover:bg-warning-muted'
                    : word.status === 'known'
                        ? 'border-success/25 bg-success/10 text-success-text hover:bg-success/20'
                        : 'border-border/40 bg-background/70 text-foreground hover:border-accent/50 hover:bg-accent/5',
            )}
        >
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT_CLASS[word.status])} />
            <span>{word.word}</span>
        </button>
    );
}
