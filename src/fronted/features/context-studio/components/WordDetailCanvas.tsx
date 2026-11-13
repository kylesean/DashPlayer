import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Badge } from '@astryxdesign/core/Badge';
import { BookOpenText, ExternalLink, Pencil, Sparkles, Trash2, Volume2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { WordItem } from '@/fronted/features/video-learning/components/WordSidebar';
import type { WordContextOccurrence } from '@/common/types/contextStudio';
import type { WordMemoryVO } from '@/common/types/wordMemory';
import type { WordStatus } from '@/common/types/vocabulary';
import type { ReviewRating } from '@/common/types/review';
import type { Sentence } from '@/common/types/SentenceC';
import type { SentenceStruct } from '@/common/types/SentenceStruct';
import TimeUtil from '@/common/utils/TimeUtil';
import { contextStudioApi } from '../contextStudioApi';
import { renderSentenceTokens } from '@/fronted/features/player/components/srt-layout/sentence-token-renderer';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { playContextAudio } from '@/fronted/infrastructure/audio/AudioPlayer';
import { cn } from '@/fronted/lib/utils';

function buildOccurrenceSentence(occ: WordContextOccurrence): Sentence {
    const fileHash = occ.fileHash || `context-${occ.videoId || occ.id}`;
    const index = occ.sentenceIndex ?? 0;
    const struct: SentenceStruct = {
        original: occ.context,
        blocks: [],
    };
    return {
        fileHash,
        index,
        start: occ.startTime ?? 0,
        end: occ.endTime ?? 0,
        adjustedStart: occ.startTime ?? null,
        adjustedEnd: occ.endTime ?? null,
        text: occ.context,
        textZH: occ.contextZh ?? '',
        key: occ.id,
        transGroup: 1,
        translationKey: `${fileHash}:${index}`,
        struct,
    };
}

export interface WordDetailCanvasProps {
    word: WordItem;
    isDueForReview: boolean;
    onEdit: (word: WordItem) => void;
    onDeleted: (wordText: string) => void;
    onStatusUpdated: (wordText: string, nextStatus: WordStatus) => void;
    onReviewRated: (wordText: string) => void;
}

const STATUS_OPTIONS: readonly WordStatus[] = ['learning', 'familiar', 'known', 'ignored'];

export default function WordDetailCanvas({
    word,
    isDueForReview,
    onEdit,
    onDeleted,
    onStatusUpdated,
    onReviewRated,
}: WordDetailCanvasProps) {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const [contexts, setContexts] = useState<WordContextOccurrence[]>([]);
    const [loadingContexts, setLoadingContexts] = useState(true);
    const [memory, setMemory] = useState<WordMemoryVO | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [currentStatus, setCurrentStatus] = useState<WordStatus>(word.status ?? 'learning');
    const [generatingDef, setGeneratingDef] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [ratingBusy, setRatingBusy] = useState(false);
    const [popEle, setPopEle] = useState<string | null>(null);

    const handleRequestPop = (nextKey: string) => {
        setPopEle((prev) => (prev === nextKey ? null : nextKey));
    };

    useEffect(() => {
        let cancelled = false;
        void Promise.allSettled([
            contextStudioApi.getWordContexts(word.word),
            videoLearningApi.getWordMemory(word.word),
        ]).then(([ctxRes, memRes]) => {
            if (cancelled) return;
            if (ctxRes.status === 'fulfilled') {
                setContexts(ctxRes.value);
            } else {
                setContexts([]);
            }
            if (memRes.status === 'fulfilled') {
                setMemory(memRes.value);
                if (memRes.value?.status) {
                    setCurrentStatus(memRes.value.status);
                }
            } else {
                setMemory(null);
            }
        }).finally(() => {
            if (!cancelled) {
                setLoadingContexts(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [word.word, word.status]);

    const handleSpeak = async (
        text: string,
        id: string,
        media?: { videoPath?: string; startTime?: number; endTime?: number },
    ) => {
        setPlayingId(id);
        try {
            await playContextAudio({
                text,
                videoPath: media?.videoPath,
                startTime: media?.startTime,
                endTime: media?.endTime,
            });
        } finally {
            setPlayingId(null);
        }
    };

    const handleStatusChange = async (nextStatus: string) => {
        const typed = nextStatus as WordStatus;
        setCurrentStatus(typed);
        try {
            await videoLearningApi.updateWordState(word.word, typed);
            onStatusUpdated(word.word, typed);
        } catch {
            setCurrentStatus(word.status ?? 'learning');
            toast.error(t('contextStudio.statusUpdateFailed', { defaultValue: '更新掌握阶段失败' }));
        }
    };

    const handleRateReview = async (rating: ReviewRating) => {
        setRatingBusy(true);
        try {
            await videoLearningApi.rateReview(word.word, rating);
            toast.success(t('contextStudio.reviewRated', { defaultValue: '已记录本次复习反馈' }));
            onReviewRated(word.word);
        } catch {
            toast.error(t('contextStudio.reviewRateFailed', { defaultValue: '提交复习结果失败' }));
        } finally {
            setRatingBusy(false);
        }
    };

    const handleGenerateDefinition = async () => {
        setGeneratingDef(true);
        try {
            const res = await videoLearningApi.generateDefinition(word.word);
            if (res.success && res.data) {
                toast.success(t('contextStudio.definitionGenerated', { defaultValue: '已生成 AI 释义' }));
                onEdit({ ...word, translate: res.data });
            } else {
                toast.error(res.error || t('contextStudio.definitionFailed', { defaultValue: '生成释义失败' }));
            }
        } catch {
            toast.error(t('contextStudio.definitionFailed', { defaultValue: '生成释义失败' }));
        } finally {
            setGeneratingDef(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const res = await videoLearningApi.deleteWord(word.word);
            if (res.success) {
                toast.success(t('contextStudio.wordDeleted', { defaultValue: '已移除词汇' }));
                onDeleted(word.word);
            } else {
                toast.error(res.error || t('contextStudio.deleteFailed', { defaultValue: '删除失败' }));
            }
        } catch {
            toast.error(t('contextStudio.deleteFailed', { defaultValue: '删除失败' }));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 overflow-y-auto p-6 gap-5">
            {/* 词头与核心控制区 */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/40 pb-5">
                <div className="flex flex-col gap-2 min-w-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-semibold tracking-tight text-primary">{word.word}</h2>
                        <Tooltip content={t('contextStudio.speakWord', { defaultValue: '朗读发音' })} placement="below">
                            <button
                                type="button"
                                onClick={() => void handleSpeak(word.word, 'word-head')}
                                className={cn(
                                    'p-1.5 rounded-lg transition-colors cursor-pointer',
                                    playingId === 'word-head'
                                        ? 'text-accent bg-accent-bg/15'
                                        : 'text-secondary hover:text-primary hover:bg-muted/80',
                                )}
                                aria-label={t('contextStudio.speakWord', { defaultValue: '朗读发音' })}
                            >
                                <Volume2 className="w-4 h-4" />
                            </button>
                        </Tooltip>
                        {isDueForReview && (
                            <Badge variant="warning" label={t('contextStudio.dueBadge', { defaultValue: '今日待复习' })} />
                        )}
                    </div>
                    <p className="text-base text-secondary whitespace-pre-wrap leading-relaxed">
                        {word.translate?.trim() || t('contextStudio.noTranslation', { defaultValue: '暂无释义' })}
                    </p>
                    {memory && (
                        <div className="flex items-center gap-3 text-metadata text-secondary">
                            <span>
                                {t('contextStudio.reviewCount', {
                                    count: memory.reviewCount,
                                    defaultValue: `累计复习 ${memory.reviewCount} 次`,
                                })}
                            </span>
                            {memory.lastReviewedAt && (
                                <span>
                                    {t('contextStudio.lastReviewed', {
                                        date: memory.lastReviewedAt.slice(0, 10),
                                        defaultValue: `上次复习 ${memory.lastReviewedAt.slice(0, 10)}`,
                                    })}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <div className="shrink-0">
                        <SegmentedControl
                            size="sm"
                            value={currentStatus}
                            onChange={(val) => void handleStatusChange(val)}
                            label={t('contextStudio.masteryStage', { defaultValue: '掌握阶段' })}
                        >
                            {STATUS_OPTIONS.map((status) => (
                                <SegmentedControlItem
                                    key={status}
                                    value={status}
                                    label={t(`contextStudio.status.${status}`, {
                                        defaultValue:
                                            status === 'learning'
                                                ? '待学'
                                                : status === 'familiar'
                                                    ? '有印象'
                                                    : status === 'known'
                                                        ? '已掌握'
                                                        : '忽略',
                                    })}
                                />
                            ))}
                        </SegmentedControl>
                    </div>

                    <Tooltip content={t('contextStudio.editWord', { defaultValue: '编辑词条与释义' })} placement="below">
                        <button
                            type="button"
                            onClick={() => onEdit(word)}
                            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-muted/80 transition-colors cursor-pointer"
                            aria-label={t('contextStudio.editWord', { defaultValue: '编辑词条与释义' })}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    </Tooltip>
                    <Tooltip content={t('contextStudio.aiDefine', { defaultValue: 'AI 补全释义' })} placement="below">
                        <button
                            type="button"
                            disabled={generatingDef}
                            onClick={() => void handleGenerateDefinition()}
                            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-muted/80 transition-colors cursor-pointer disabled:opacity-50"
                            aria-label={t('contextStudio.aiDefine', { defaultValue: 'AI 补全释义' })}
                        >
                            <Sparkles className="w-4 h-4" />
                        </button>
                    </Tooltip>
                    <Tooltip content={t('contextStudio.deleteWord', { defaultValue: '移除词条' })} placement="below">
                        <button
                            type="button"
                            disabled={deleting}
                            onClick={() => void handleDelete()}
                            className="p-1.5 rounded-lg text-secondary hover:text-error-text hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
                            aria-label={t('contextStudio.deleteWord', { defaultValue: '移除词条' })}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* 艾宾浩斯即时复习反馈条 */}
            {isDueForReview && (
                <Card variant="muted" padding={3}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                            <Text type="body" weight="medium">
                                {t('contextStudio.reviewPromptTitle', { defaultValue: '今日复习' })}
                            </Text>
                            <Text type="supporting" color="secondary">
                                {t('contextStudio.reviewPromptDesc', { defaultValue: '选择回忆程度，系统会自动安排下次复习' })}
                            </Text>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                                size="sm"
                                variant="secondary"
                                isDisabled={ratingBusy}
                                label={t('contextStudio.rateAgain', { defaultValue: '忘记了' })}
                                onClick={() => void handleRateReview('again')}
                            />
                            <Button
                                size="sm"
                                variant="secondary"
                                isDisabled={ratingBusy}
                                label={t('contextStudio.rateHard', { defaultValue: '有点模糊' })}
                                onClick={() => void handleRateReview('hard')}
                            />
                            <Button
                                size="sm"
                                variant="primary"
                                isDisabled={ratingBusy}
                                label={t('contextStudio.rateGood', { defaultValue: '想起来了' })}
                                onClick={() => void handleRateReview('good')}
                            />
                            <Button
                                size="sm"
                                variant="secondary"
                                isDisabled={ratingBusy}
                                label={t('contextStudio.rateEasy', { defaultValue: '秒记' })}
                                onClick={() => void handleRateReview('easy')}
                            />
                        </div>
                    </div>
                </Card>
            )}

            {/* 真实视频语境出处流 */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <Text type="body" weight="semibold">
                        {t('contextStudio.contextsHeading', { defaultValue: '视频语境' })}
                    </Text>
                    <span className="text-metadata text-secondary tabular-nums">
                        {contexts.length > 0
                            ? t('contextStudio.contextsCount', { count: contexts.length, defaultValue: `${contexts.length} 条` })
                            : ''}
                    </span>
                </div>

                {loadingContexts ? (
                    <div className="rounded-lg border border-border/40 bg-surface/50 p-6 text-center text-sm text-secondary">
                        {t('contextStudio.loadingContexts', { defaultValue: '加载语境中...' })}
                    </div>
                ) : contexts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-secondary">
                        {t('contextStudio.emptyContexts', {
                            defaultValue: '暂无视频语境，在播放器中点词查询后会自动关联。',
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {contexts.map((occ) => {
                            const hasNativeAudio = Boolean(occ.videoPath && typeof occ.startTime === 'number');
                            const speakLabel = hasNativeAudio
                                ? t('contextStudio.playNativeAudio', { defaultValue: '播放原声' })
                                : t('contextStudio.speakSentence', { defaultValue: '朗读' });
                            const playerUrl =
                                typeof occ.startTime === 'number' && occ.startTime > 0
                                    ? `/player/${occ.videoId}?t=${Math.floor(occ.startTime)}`
                                    : `/player/${occ.videoId}`;
                            return (
                            <Card key={occ.id} variant="muted" padding={3}>
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-metadata font-medium text-accent truncate">
                                                {occ.videoTitle}
                                            </span>
                                            {typeof occ.startTime === 'number' && (
                                                <span className="text-metadata font-mono text-secondary shrink-0">
                                                    {TimeUtil.secondToTimeStrCompact(occ.startTime)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <Tooltip content={speakLabel} placement="below">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void handleSpeak(occ.context, occ.id, {
                                                            videoPath: occ.videoPath,
                                                            startTime: occ.startTime,
                                                            endTime: occ.endTime,
                                                        })
                                                    }
                                                    className={cn(
                                                        'inline-flex items-center justify-center p-1.5 rounded-md transition-colors cursor-pointer',
                                                        playingId === occ.id
                                                            ? 'text-accent bg-accent-bg/15'
                                                            : 'text-secondary hover:text-primary hover:bg-body/60',
                                                    )}
                                                    aria-label={speakLabel}
                                                >
                                                    <Volume2 className="w-3.5 h-3.5" />
                                                </button>
                                            </Tooltip>
                                            {occ.videoId && (
                                                <>
                                                    <Tooltip content={t('contextStudio.openInReader', { defaultValue: '精读全文' })} placement="below">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const query = typeof occ.sentenceIndex === 'number'
                                                                    ? `?sentence=${occ.sentenceIndex}`
                                                                    : '';
                                                                navigate(`/reader/${occ.videoId}${query}`);
                                                            }}
                                                            className="p-1 rounded-md text-secondary hover:text-primary hover:bg-body/60 transition-colors cursor-pointer"
                                                            aria-label={t('contextStudio.openInReader', { defaultValue: '精读全文' })}
                                                        >
                                                            <BookOpenText className="w-3.5 h-3.5" />
                                                        </button>
                                                    </Tooltip>
                                                    <Tooltip content={t('contextStudio.openInPlayer', { defaultValue: '定位播放' })} placement="below">
                                                        <button
                                                            type="button"
                                                            onClick={() => navigate(playerUrl)}
                                                            className="p-1 rounded-md text-secondary hover:text-primary hover:bg-body/60 transition-colors cursor-pointer"
                                                            aria-label={t('contextStudio.openInPlayer', { defaultValue: '定位播放' })}
                                                        >
                                                            <ExternalLink className="w-3.5 h-3.5" />
                                                        </button>
                                                    </Tooltip>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <p className="text-sm text-primary leading-relaxed select-text break-words">
                                        {renderSentenceTokens({
                                            sentence: buildOccurrenceSentence(occ),
                                            text: occ.context,
                                            popEle,
                                            onRequestPop: handleRequestPop,
                                            alwaysDark: false,
                                            surface: 'transcript',
                                            sentenceHash: occ.id,
                                        })}
                                    </p>
                                    {occ.contextZh && (
                                        <p className="text-sm text-secondary leading-relaxed">{occ.contextZh}</p>
                                    )}
                                </div>
                            </Card>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
