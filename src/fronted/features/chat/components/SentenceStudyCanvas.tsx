import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Section } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
    Bookmark,
    BookmarkCheck,
    BookOpenCheck,
    ChevronDown,
    ChevronUp,
    CircleStop,
    Ear,
    Eye,
    EyeOff,
    Lightbulb,
    Loader2,
    MessageCircleQuestion,
    Play,
    RefreshCw,
    RotateCcw,
    Volume2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setMiniStageTargetEl } from '@/fronted/features/chat/miniStageTarget';
import type { DeepPartial } from '@/common/types/analysis';
import type { SentenceStudyCard } from '@/common/types/aiRes/AiUnifiedAnalysisRes';
import type { SentenceWordEntry } from '@/common/types/vo/SentenceVocabularyVO';
import type { AnalysisStatus } from '@/fronted/features/chat/types';
import { cn } from '@/fronted/lib/utils';

export interface StudyContextNeighbor {
    index: number;
    text: string;
    isCurrent: boolean;
}

export interface SentenceStudyCanvasProps {
    sentence: {
        en: string;
        zh: string;
        position: string;
    };
    neighbors: StudyContextNeighbor[];
    analysis: DeepPartial<SentenceStudyCard> | null;
    analysisStatus: AnalysisStatus;
    analysisError: string | null;
    sessionReady: boolean;
    cloudAvailable: boolean;
    vocabWords: SentenceWordEntry[];
    resolveWordDetail: (word: string) => SentenceWordEntry | null;
    isFavorite: (word: string) => boolean;
    onToggleFavorite: (word: string, meaning: string) => void;
    onSpeak: (text: string) => void;
    onPlayOriginal: (rate?: number) => void;
    onRequestAnalysis: () => void;
    onStopAnalysis: () => void;
    onDeepDiveExpression: (expression: string) => void;
    miniVideoCollapsed: boolean;
    onToggleMiniCollapsed: () => void;
    previewingEvidenceIndex: number | null;
    onReturnToAnchorClip: () => void;
    noteSummary: string;
    noteSaving: boolean;
    onNoteChange: (value: string) => void;
    onSaveNote: () => void;
}

const MEMORY_LABEL_CLASS: Record<NonNullable<SentenceWordEntry['memoryTag']>, { label: string; className: string }> = {
    due: { label: '待复习', className: 'text-warning-text' },
    learning: { label: '在学', className: 'text-accent' },
    lookup: { label: '常查', className: 'text-secondary' },
    new: { label: '重点', className: 'text-secondary' },
};

const splitSentenceTokens = (text: string): Array<{ text: string; lookupKey: string | null }> => {
    return text.split(/([A-Za-z][A-Za-z'’-]*)/g).filter(Boolean).map((segment) => {
        if (/^[A-Za-z]/.test(segment)) {
            return { text: segment, lookupKey: segment.toLowerCase() };
        }
        return { text: segment, lookupKey: null };
    });
};

/**
 * 左侧原片精读画布：使用 Astryx Section 分层与 ghost 动作，去除冗杂椭圆标签与嵌套描边盒。
 */
export default function SentenceStudyCanvas({
    sentence,
    neighbors,
    analysis,
    analysisStatus,
    analysisError,
    sessionReady,
    cloudAvailable,
    vocabWords,
    resolveWordDetail,
    isFavorite,
    onToggleFavorite,
    onSpeak,
    onPlayOriginal,
    onRequestAnalysis,
    onStopAnalysis,
    onDeepDiveExpression,
    miniVideoCollapsed,
    onToggleMiniCollapsed,
    previewingEvidenceIndex,
    onReturnToAnchorClip,
    noteSummary,
    noteSaving,
    onNoteChange,
    onSaveNote,
}: SentenceStudyCanvasProps) {
    const { t } = useTranslation('common');
    const [selectedToken, setSelectedToken] = useState<string | null>(null);
    const [showContextNeighbors, setShowContextNeighbors] = useState(false);

    useEffect(() => () => {
        setMiniStageTargetEl(null);
    }, []);

    const activeDetail = selectedToken ? resolveWordDetail(selectedToken) : null;
    const chunks = (analysis?.sentence?.chunks ?? []).filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    const focalPoints = (analysis?.focalPoints ?? []).filter(
        (item): item is NonNullable<typeof item> => Boolean(item && (item.expression || item.coreImage || item.meaningInContext)),
    );
    const listeningLens = (analysis?.listeningLens ?? []).filter(
        (item): item is NonNullable<typeof item> => Boolean(item && (item.span || item.tip)),
    );
    const structureInsight = analysis?.sentenceLens?.structureInsight?.trim();
    const subtext = analysis?.sentenceLens?.subtext?.trim();

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-body">
            {/* 顶部微画中画 + 舒展的音频条 */}
            <div className="shrink-0 border-b border-border/45 bg-surface/35 px-4 pt-3 pb-2.5">
                {!miniVideoCollapsed && (
                    <div
                        ref={setMiniStageTargetEl}
                        data-testid="mini-pip-slot"
                        className="mb-2.5 aspect-video w-full max-h-48 overflow-hidden rounded-xl border border-border/45 bg-transparent"
                    />
                )}

                {previewingEvidenceIndex !== null && (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-accent-bg/10 px-2.5 py-1 text-sm">
                        <span className="font-medium text-accent">
                            {t('learning.previewingEvidenceShort', { index: previewingEvidenceIndex + 1 })}
                        </span>
                        <Button
                            label={t('learning.returnToCurrentSentence')}
                            size="sm"
                            variant="ghost"
                            icon={<RotateCcw className="h-3 w-3" />}
                            onClick={onReturnToAnchorClip}
                        />
                    </div>
                )}

                <div className="flex items-center justify-between gap-2">
                    <HStack gap={1.5} vAlign="center">
                        <Button
                            label={t('learning.playOriginal')}
                            variant="primary"
                            size="sm"
                            icon={<Play className="h-3 w-3 fill-current" />}
                            onClick={() => onPlayOriginal(1)}
                        />
                        <Button
                            label="0.75x"
                            variant="ghost"
                            size="sm"
                            icon={<Ear className="h-3.5 w-3.5" />}
                            onClick={() => onPlayOriginal(0.75)}
                        />
                        <IconButton
                            label={t('learning.ttsVoice')}
                            tooltip={t('learning.ttsVoice')}
                            variant="ghost"
                            size="sm"
                            icon={<Volume2 className="h-3.5 w-3.5" />}
                            onClick={() => onSpeak(sentence.en)}
                        />
                    </HStack>

                    <IconButton
                        label={miniVideoCollapsed ? t('learning.showMiniVideo') : t('learning.hideMiniVideo')}
                        tooltip={miniVideoCollapsed ? t('learning.showMiniVideo') : t('learning.hideMiniVideo')}
                        variant="ghost"
                        size="sm"
                        icon={miniVideoCollapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        onClick={onToggleMiniCollapsed}
                    />
                </div>
            </div>

            {/* 可滚动精读主体 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                {/* Sticky 锁定主句 */}
                <section className="sticky top-0 z-10 -mx-4 border-b border-border/45 bg-body/95 px-4 pt-3 pb-3 backdrop-blur-md">
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-metadata font-mono text-secondary">
                            {sentence.position}
                        </span>
                        {neighbors.length > 1 && (
                            <Button
                                label={t('learning.contextShort')}
                                variant="ghost"
                                size="sm"
                                endContent={showContextNeighbors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                onClick={() => setShowContextNeighbors((prev) => !prev)}
                            />
                        )}
                    </div>

                    {showContextNeighbors && (
                        <div className="mb-2.5 space-y-1 rounded-lg bg-surface/65 p-2.5 text-sm leading-relaxed">
                            {neighbors.map((line) => (
                                <p
                                    key={line.index}
                                    className={cn(line.isCurrent ? 'font-medium text-primary' : 'text-secondary/75')}
                                >
                                    <span className="mr-1.5 font-mono text-metadata opacity-60">#{line.index + 1}</span>
                                    {line.text}
                                </p>
                            ))}
                        </div>
                    )}

                    <p className="text-lg font-semibold leading-relaxed tracking-tight text-primary select-text">
                        {splitSentenceTokens(sentence.en).map((tok, idx) => {
                            const detail = tok.lookupKey ? resolveWordDetail(tok.lookupKey) : null;
                            if (!detail) {
                                return <span key={idx}>{tok.text}</span>;
                            }
                            const isPicked = selectedToken === tok.lookupKey;
                            return (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setSelectedToken(isPicked ? null : tok.lookupKey)}
                                    className={cn(
                                        'mx-px inline rounded px-0.5 transition-colors cursor-pointer underline decoration-dotted underline-offset-4',
                                        isPicked
                                            ? 'bg-accent-bg/20 text-primary decoration-accent'
                                            : detail.memoryTag && detail.memoryTag !== 'new'
                                                ? 'decoration-accent/70 hover:bg-accent-bg/10'
                                                : 'decoration-border/80 hover:bg-muted/60',
                                    )}
                                >
                                    {tok.text}
                                </button>
                            );
                        })}
                    </p>

                    {sentence.zh && (
                        <p className="mt-1.5 text-sm leading-relaxed text-secondary select-text">
                            {sentence.zh}
                        </p>
                    )}

                    {/* 意群拆分采用轻巧斜线分隔排版，避免一串椭圆遮挡视线 */}
                    {chunks.length > 0 && (
                        <p className="mt-2 text-metadata leading-relaxed text-secondary/90">
                            {chunks.map((chunk, index) => (
                                <span key={`${chunk}-${index}`}>
                                    {index > 0 && <span className="mx-1.5 text-border">/</span>}
                                    <span>{chunk}</span>
                                </span>
                            ))}
                        </p>
                    )}

                    {activeDetail && (
                        <div className="mt-2.5 flex items-start justify-between gap-2 border-t border-border/40 pt-2.5">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-base font-semibold text-primary">{activeDetail.word}</span>
                                    {activeDetail.phonetic && (
                                        <span className="text-metadata font-mono text-secondary">/{activeDetail.phonetic}/</span>
                                    )}
                                    {activeDetail.memoryTag && activeDetail.memoryTag !== 'new' && (
                                        <span className={cn('text-metadata font-medium', MEMORY_LABEL_CLASS[activeDetail.memoryTag].className)}>
                                            {MEMORY_LABEL_CLASS[activeDetail.memoryTag].label}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-0.5 text-sm text-secondary leading-snug">{activeDetail.meaning}</p>
                            </div>
                            <HStack gap={0.5} vAlign="center">
                                <IconButton
                                    label={t('learning.pronounceWord')}
                                    icon={<Volume2 className="h-3.5 w-3.5" />}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onSpeak(activeDetail.word)}
                                />
                                <IconButton
                                    label={isFavorite(activeDetail.word) ? t('learning.favorited') : t('learning.favorite')}
                                    icon={isFavorite(activeDetail.word)
                                        ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" />
                                        : <Bookmark className="h-3.5 w-3.5" />}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onToggleFavorite(activeDetail.word, activeDetail.meaning)}
                                />
                                <IconButton
                                    label={t('learning.askImageAction')}
                                    tooltip={t('learning.askImageAction')}
                                    icon={<Lightbulb className="h-3.5 w-3.5 text-accent" />}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onDeepDiveExpression(activeDetail.word)}
                                />
                            </HStack>
                        </div>
                    )}
                </section>

                <div className="mt-4 space-y-4">
                    {/* 精读分区 */}
                    <Section variant="transparent" padding={0}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <HStack gap={1.5} vAlign="center">
                                <BookOpenCheck className="h-3.5 w-3.5 text-accent" />
                                <Text type="supporting" weight="semibold" color="secondary">
                                    {t('learning.studyTitleShort')}
                                </Text>
                                {analysisStatus === 'streaming' && (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                                )}
                            </HStack>

                            {sessionReady && cloudAvailable && analysisStatus === 'streaming' && (
                                <IconButton
                                    label={t('learning.stopAnalysis')}
                                    tooltip={t('learning.stopAnalysis')}
                                    icon={<CircleStop className="h-3.5 w-3.5" />}
                                    variant="ghost"
                                    size="sm"
                                    onClick={onStopAnalysis}
                                />
                            )}
                            {sessionReady && cloudAvailable && analysisStatus !== 'streaming' && (
                                <IconButton
                                    label={analysisStatus === 'done' ? t('learning.regenerateCard') : t('learning.generateCardNow')}
                                    tooltip={analysisStatus === 'done' ? t('learning.regenerateCard') : t('learning.generateCardNow')}
                                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                                    variant="ghost"
                                    size="sm"
                                    onClick={onRequestAnalysis}
                                />
                            )}
                        </div>

                        {analysisStatus === 'idle' && focalPoints.length === 0 && !structureInsight && (
                            <div className="flex items-center justify-between gap-3 py-2 text-sm text-secondary">
                                <span>{cloudAvailable ? t('learning.studyIdleCompact') : t('learning.aiOfflineCompact')}</span>
                                {sessionReady && cloudAvailable && (
                                    <Button
                                        label={t('learning.generateCardNow')}
                                        variant="secondary"
                                        size="sm"
                                        icon={<BookOpenCheck className="h-3.5 w-3.5 text-accent" />}
                                        onClick={onRequestAnalysis}
                                    />
                                )}
                            </div>
                        )}

                        {analysisStatus === 'aborted' && (
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 p-2.5 text-sm text-secondary">
                                <span>
                                    {t('learning.analysisAborted')}
                                    {focalPoints.length > 0 || structureInsight
                                        ? t('learning.analysisAbortedPartial')
                                        : ''}
                                </span>
                                {sessionReady && cloudAvailable && (
                                    <Button
                                        label={t('learning.regenerateCard')}
                                        size="sm"
                                        variant="secondary"
                                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                                        onClick={onRequestAnalysis}
                                    />
                                )}
                            </div>
                        )}

                        {analysisStatus === 'error' && analysisError && (
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-error/40 bg-error/10 p-2.5 text-sm text-error-text">
                                <span>{analysisError}</span>
                                <Button label={t('learning.retry')} size="sm" variant="secondary" onClick={onRequestAnalysis} />
                            </div>
                        )}

                        {analysisStatus === 'streaming' && focalPoints.length === 0 && !structureInsight && (
                            <div className="space-y-2">
                                <div className="h-14 animate-pulse rounded-lg bg-muted/40" />
                                <div className="h-10 animate-pulse rounded-lg bg-muted/25" />
                            </div>
                        )}

                        {focalPoints.length > 0 && (
                            <div className="space-y-2.5">
                                {focalPoints.map((fp, idx) => (
                                    <Card key={`${fp.expression ?? idx}`} variant="muted" padding={3}>
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-base font-semibold text-primary">{fp.expression}</span>
                                                {fp.tag && (
                                                    <span className="text-metadata font-medium text-accent">{fp.tag}</span>
                                                )}
                                            </div>
                                            {fp.expression && (
                                                <HStack gap={0.5} vAlign="center">
                                                    <IconButton
                                                        label={t('learning.pronounceWord')}
                                                        icon={<Volume2 className="h-3.5 w-3.5" />}
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => onSpeak(fp.expression!)}
                                                    />
                                                    <IconButton
                                                        label={t('learning.askImageAction')}
                                                        tooltip={t('learning.askImageAction')}
                                                        icon={<Lightbulb className="h-3.5 w-3.5 text-accent" />}
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => onDeepDiveExpression(fp.expression!)}
                                                    />
                                                </HStack>
                                            )}
                                        </div>
                                        {fp.coreImage && (
                                            <p className="mt-1.5 text-sm leading-relaxed text-primary/90">
                                                <span className="mr-1.5 font-semibold text-accent">
                                                    {t('learning.physicalImageShort')}
                                                </span>
                                                {fp.coreImage}
                                            </p>
                                        )}
                                        {fp.meaningInContext && (
                                            <p className="mt-1 text-sm leading-relaxed text-secondary">
                                                {fp.meaningInContext}
                                            </p>
                                        )}
                                    </Card>
                                ))}
                            </div>
                        )}

                        {listeningLens.length > 0 && (
                            <div className="mt-3 space-y-1.5 border-t border-border/35 pt-3">
                                <HStack gap={1.5} vAlign="center">
                                    <Ear className="h-3.5 w-3.5 text-accent" />
                                    <Text type="supporting" weight="semibold" color="secondary">
                                        {t('learning.listeningShort')}
                                    </Text>
                                </HStack>
                                {listeningLens.map((cue, idx) => (
                                    <button
                                        key={`${cue.span ?? idx}`}
                                        type="button"
                                        onClick={() => onPlayOriginal(0.75)}
                                        className="flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/45 transition-colors cursor-pointer"
                                    >
                                        <span className="font-mono text-sm font-semibold text-primary">{cue.span}</span>
                                        <span className="flex-1 text-sm text-secondary">
                                            {cue.phenomenon ? `[${cue.phenomenon}] ` : ''}{cue.tip}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {(structureInsight || subtext) && (
                            <div className="mt-3 space-y-1.5 border-t border-border/35 pt-3 text-sm leading-relaxed">
                                {structureInsight && (
                                    <p className="text-primary/90">
                                        <span className="mr-1.5 font-semibold text-accent">{t('learning.framingShort')}</span>
                                        {structureInsight}
                                    </p>
                                )}
                                {subtext && (
                                    <p className="text-secondary">
                                        <span className="mr-1.5 font-semibold text-primary/75">{t('learning.subtextShort')}</span>
                                        {subtext}
                                    </p>
                                )}
                            </div>
                        )}
                    </Section>

                    {/* 记忆焦点词列表：用极细分割线分隔，取消逐个椭圆胶囊 */}
                    {vocabWords.length > 0 && (
                        <Section variant="transparent" padding={0} className="border-t border-border/40 pt-3">
                            <div className="mb-1.5">
                                <Text type="supporting" weight="semibold" color="secondary">
                                    {t('learning.vocabShort')}
                                </Text>
                            </div>
                            <div className="divide-y divide-border/35">
                                {vocabWords.map((item) => {
                                    const saved = isFavorite(item.word);
                                    const badge = item.memoryTag ? MEMORY_LABEL_CLASS[item.memoryTag] : null;
                                    return (
                                        <div key={item.word} className="flex items-start justify-between gap-2 py-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-base font-semibold text-primary">{item.word}</span>
                                                    {item.phonetic && (
                                                        <span className="text-metadata font-mono text-secondary">/{item.phonetic}/</span>
                                                    )}
                                                    {badge && item.memoryTag !== 'new' && (
                                                        <span className={cn('text-metadata font-medium', badge.className)}>
                                                            {badge.label}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-0.5 text-sm text-secondary leading-snug">{item.meaning}</p>
                                            </div>
                                            <HStack gap={0.5} vAlign="center">
                                                <IconButton
                                                    label={t('learning.pronounceWord')}
                                                    icon={<Volume2 className="h-3.5 w-3.5" />}
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => onSpeak(item.word)}
                                                />
                                                <IconButton
                                                    label={saved ? t('learning.favorited') : t('learning.favorite')}
                                                    icon={saved
                                                        ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" />
                                                        : <Bookmark className="h-3.5 w-3.5" />}
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => onToggleFavorite(item.word, item.meaning)}
                                                />
                                                <IconButton
                                                    label={t('learning.askImageAction')}
                                                    tooltip={t('learning.askWordTooltip')}
                                                    icon={<MessageCircleQuestion className="h-3.5 w-3.5 text-accent" />}
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => onDeepDiveExpression(item.word)}
                                                />
                                            </HStack>
                                        </div>
                                    );
                                })}
                            </div>
                        </Section>
                    )}

                    {/* 本句笔记区 */}
                    <Section variant="transparent" padding={0} className="border-t border-border/40 pt-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                            <Text type="supporting" weight="semibold" color="secondary">
                                {t('learning.noteShort')}
                            </Text>
                            <Button
                                label={noteSaving ? t('learning.noteSaving') : t('learning.noteSaveShort')}
                                size="sm"
                                variant="ghost"
                                isDisabled={noteSaving}
                                onClick={onSaveNote}
                            />
                        </div>
                        <textarea
                            value={noteSummary}
                            onChange={(e) => onNoteChange(e.target.value)}
                            onBlur={onSaveNote}
                            rows={2}
                            placeholder={t('learning.notePlaceholderShort')}
                            className="w-full resize-y rounded-lg border border-border/50 bg-body/70 p-2 text-sm leading-relaxed text-primary outline-none focus:border-accent-bg"
                        />
                    </Section>
                </div>
            </div>
        </div>
    );
}
