import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';

import type { MemoryMapVO, MemoryMapWordVO } from '@/common/types/memoryMap';
import type { WordStatus } from '@/common/types/vocabulary';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import { cn } from '@/fronted/lib/utils';
import MemoryMapGraph from './MemoryMapGraph';

/** 记忆图谱在词汇工坊中的入参。 */
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
}

const STATUS_ORDER: readonly WordStatus[] = ['learning', 'familiar', 'known', 'ignored'];

/**
 * 个人记忆图谱：按真实视频主题聚合词，并按记忆阶段分带。
 *
 * 只读取本地数据；没有词时整段隐藏，避免空面板噪声。
 */
export default function MemoryMapSection({ onSelectWord, onStartTopicQueue }: MemoryMapSectionProps) {
    const { t } = useTranslation('memoryMap');
    const [expanded, setExpanded] = useState(false);
    const [view, setView] = useState<'cards' | 'graph'>('cards');
    const { data, error } = useSWR<MemoryMapVO>(
        'learning-data/memory-map',
        () => learningDataApi.getMemoryMap({ limit: 8 }),
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );

    const topics = useMemo(() => data?.topics ?? [], [data?.topics]);
    if (error || !data || data.totalWords === 0) {
        return null;
    }

    return (
        <section className="rounded-2xl border border-border/60 bg-card px-4 py-3">
            <HStack vAlign="center" hAlign="between" gap={3} width="100%">
                <HStack vAlign="center" gap={2}>
                    <Brain className="h-4 w-4 text-accent" />
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
                <Button
                    variant="ghost"
                    size="sm"
                    icon={expanded
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />}
                    label={expanded ? t('collapse') : t('expand')}
                    onClick={() => setExpanded((current) => !current)}
                />
            </HStack>

            {expanded && (
                <div className="mt-3">
                    <SegmentedControl
                        value={view}
                        onChange={(value) => setView(value === 'graph' ? 'graph' : 'cards')}
                        label={t('viewLabel')}
                        size="sm"
                    >
                        <SegmentedControlItem value="cards" label={t('viewCards')} />
                        <SegmentedControlItem value="graph" label={t('viewGraph')} />
                    </SegmentedControl>

                    {view === 'graph' ? (
                        <MemoryMapGraph data={data} onSelectWord={onSelectWord} />
                    ) : (
                        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                            {topics.map((topic) => (
                                <TopicCard
                                    key={topic.key}
                                    label={topic.label ?? t('untitledTopic')}
                                    counts={topic.counts}
                                    words={topic.words}
                                    onSelectWord={onSelectWord}
                                    onStartQueue={onStartTopicQueue}
                                />
                            ))}
                            {data.looseWords && (
                                <TopicCard
                                    label={t('looseTitle')}
                                    counts={data.looseWords.counts}
                                    words={data.looseWords.words}
                                    onSelectWord={onSelectWord}
                                    hint={t('looseHint')}
                                    onStartQueue={onStartTopicQueue}
                                />
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

/**
 * 单个主题卡：阶段分布 + 代表词。
 */
function TopicCard({
    label,
    counts,
    words,
    onSelectWord,
    onStartQueue,
    hint,
}: {
    label: string;
    counts: Record<WordStatus, number>;
    words: MemoryMapWordVO[];
    onSelectWord: (word: string) => void;
    onStartQueue?: (words: string[]) => void;
    hint?: string;
}) {
    const { t } = useTranslation('memoryMap');
    const total = STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);
    return (
        <div className="rounded-xl border border-border/50 bg-background/50 px-3 py-2.5">
            <HStack vAlign="end" hAlign="between" gap={2} width="100%">
                <Text type="body" weight="medium" maxLines={1}>{label}</Text>
                <HStack vAlign="center" gap={2} className="shrink-0">
                    <Text type="supporting" color="secondary" className="tabular-nums">
                        {t('wordCount', { count: total })}
                    </Text>
                    {onStartQueue && words.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            label={t('startQueue')}
                            onClick={() => onStartQueue(words.map((word) => word.word))}
                        />
                    )}
                </HStack>
            </HStack>
            {hint && (
                <Text type="supporting" color="secondary" className="mt-0.5">
                    {hint}
                </Text>
            )}
            <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                {STATUS_ORDER.map((status) => (
                    counts[status] > 0 && (
                        <span
                            key={status}
                            className={cn(
                                'h-full',
                                status === 'learning' && 'bg-accent',
                                status === 'familiar' && 'bg-accent/50',
                                status === 'known' && 'bg-success/60',
                                status === 'ignored' && 'bg-muted-foreground/30',
                            )}
                            style={{ width: `${(counts[status] / Math.max(1, total)) * 100}%` }}
                        />
                    )
                ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {words.map((word) => (
                    <button
                        key={word.word}
                        type="button"
                        title={[
                            word.context ?? word.translate ?? word.word,
                            word.neighbors && word.neighbors.length > 0
                                ? t('neighborsHint', {
                                    words: word.neighbors.map((neighbor) => neighbor.word).join(', '),
                                })
                                : null,
                        ].filter(Boolean).join('\n')}
                        onClick={() => onSelectWord(word.word)}
                        className={cn(
                            'rounded-md px-1.5 py-0.5 text-metadata transition-colors',
                            word.due
                                ? 'bg-warning-muted/60 text-warning-text hover:bg-warning-muted'
                                : word.status === 'known'
                                    ? 'bg-success/10 text-success-text hover:bg-success/20'
                                    : 'bg-muted/60 text-foreground hover:bg-muted',
                        )}
                    >
                        {word.word}
                    </button>
                ))}
            </div>
        </div>
    );
}
