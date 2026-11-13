import { useEffect, useMemo, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Section } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
    Bookmark,
    BookmarkCheck,
    ChevronDown,
    ChevronUp,
    Eye,
    EyeOff,
    Lightbulb,
    NotebookPen,
    Play,
    Repeat,
    RotateCcw,
    Volume2,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setMiniStageTargetEl } from '@/fronted/features/chat/miniStageTarget';
import { tokenizeSentenceWithHighlights } from '@/fronted/features/chat/sentenceStudyHelpers';
import type { SentenceWordEntry } from '@/common/types/vo/SentenceVocabularyVO';
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
    resolveWordDetail: (word: string) => SentenceWordEntry | null;
    isFavorite: (word: string) => boolean;
    onToggleFavorite: (word: string, meaning: string) => void;
    onSpeak: (text: string) => void;
    onPlayOriginal: () => void;
    isLooping: boolean;
    onToggleLoop: () => void;
    onDeepDiveExpression: (expression: string) => void;
    onPreviewSubtitleLine?: (index: number) => void;
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

/**
 * 左侧原片精读画布：纯粹的确定性工作台（原片语境 + 句内词典微卡 + 前后对话 + 个人收获）。
 */
export default function SentenceStudyCanvas({
    sentence,
    neighbors,
    resolveWordDetail,
    isFavorite,
    onToggleFavorite,
    onSpeak,
    onPlayOriginal,
    isLooping,
    onToggleLoop,
    onDeepDiveExpression,
    onPreviewSubtitleLine,
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
    const [selectedWordState, setSelectedWordState] = useState<{ sentenceEn: string; word: string } | null>(null);
    const [noteExpandedFor, setNoteExpandedFor] = useState<string | null>(null);

    const selectedWord = selectedWordState?.sentenceEn === sentence.en ? selectedWordState.word : null;
    const noteExpanded = noteExpandedFor === sentence.en;

    useEffect(() => () => {
        setMiniStageTargetEl(null);
    }, []);

    const segments = useMemo(
        () => tokenizeSentenceWithHighlights(sentence.en),
        [sentence.en],
    );

    const activeWordDetail = selectedWord ? resolveWordDetail(selectedWord) : null;
    const selectedDisplayWord = activeWordDetail?.word ?? selectedWord ?? '';
    const selectedMeaning = activeWordDetail?.meaning ?? '';

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-body">
            {/* 顶部微画中画 + 轻量原声回放 */}
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
                    <HStack gap={1} vAlign="center">
                        <Button
                            label={t('learning.playOriginal')}
                            variant="primary"
                            size="sm"
                            icon={<Play className="h-3 w-3 fill-current" />}
                            onClick={onPlayOriginal}
                        />
                        <Button
                            label={t('learning.loopSentence')}
                            variant={isLooping ? 'secondary' : 'ghost'}
                            size="sm"
                            icon={<Repeat className={cn('h-3.5 w-3.5', isLooping && 'text-accent')} />}
                            onClick={onToggleLoop}
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

            {/* 可滚动主体：句内划词微卡 + 前后对话语境 + 本句收获 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                <section className="sticky top-0 z-10 -mx-4 border-b border-border/45 bg-body/95 px-4 pt-3 pb-3 backdrop-blur-md">
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-metadata font-mono text-secondary">
                            {sentence.position}
                        </span>
                    </div>

                    <p className="text-lg font-semibold leading-relaxed tracking-tight text-primary select-text">
                        {segments.map((seg, idx) => {
                            if (!seg.clickable || !seg.lookupKey || !seg.expression) {
                                return <span key={idx}>{seg.text}</span>;
                            }

                            const detail = resolveWordDetail(seg.expression);
                            const isPicked = selectedWord?.toLowerCase() === seg.lookupKey;
                            const isTrackedWord = Boolean(detail?.memoryTag && detail.memoryTag !== 'new');

                            return (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setSelectedWordState(
                                        isPicked
                                            ? null
                                            : { sentenceEn: sentence.en, word: seg.expression! },
                                    )}
                                    className={cn(
                                        'inline cursor-pointer rounded px-0.5 transition-colors underline underline-offset-4',
                                        isPicked
                                            ? 'bg-accent-bg/20 text-primary decoration-accent'
                                            : isTrackedWord
                                                ? 'decoration-accent/65 hover:bg-accent-bg/10'
                                                : 'decoration-transparent hover:bg-muted/50 hover:decoration-border/75',
                                    )}
                                >
                                    {seg.text}
                                </button>
                            );
                        })}
                    </p>

                    {sentence.zh && (
                        <p className="mt-1.5 text-sm leading-relaxed text-secondary select-text">
                            {sentence.zh}
                        </p>
                    )}

                    {selectedWord && (
                        <div
                            data-testid="inline-expression-popover"
                            className="mt-2.5 rounded-lg border border-border/55 bg-surface/75 p-2.5"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-base font-semibold text-primary">
                                            {selectedDisplayWord}
                                        </span>
                                        {activeWordDetail?.phonetic && (
                                            <span className="text-metadata font-mono text-secondary">
                                                /{activeWordDetail.phonetic}/
                                            </span>
                                        )}
                                        {activeWordDetail?.memoryTag && activeWordDetail.memoryTag !== 'new' && (
                                            <span className={cn('text-metadata font-medium', MEMORY_LABEL_CLASS[activeWordDetail.memoryTag].className)}>
                                                {MEMORY_LABEL_CLASS[activeWordDetail.memoryTag].label}
                                            </span>
                                        )}
                                    </div>

                                    {selectedMeaning && (
                                        <p className="mt-1 text-sm leading-snug text-secondary">
                                            {selectedMeaning}
                                        </p>
                                    )}
                                </div>

                                <HStack gap={0.5} vAlign="center" className="shrink-0">
                                    <IconButton
                                        label={t('learning.pronounceWord')}
                                        tooltip={t('learning.pronounceWord')}
                                        icon={<Volume2 className="h-3.5 w-3.5" />}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onSpeak(selectedDisplayWord)}
                                    />
                                    <IconButton
                                        label={isFavorite(selectedDisplayWord) ? t('learning.favorited') : t('learning.favorite')}
                                        tooltip={isFavorite(selectedDisplayWord) ? t('learning.favorited') : t('learning.favorite')}
                                        icon={isFavorite(selectedDisplayWord)
                                            ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" />
                                            : <Bookmark className="h-3.5 w-3.5" />}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onToggleFavorite(selectedDisplayWord, selectedMeaning)}
                                    />
                                    <IconButton
                                        label={t('learning.askImageAction')}
                                        tooltip={t('learning.askWordTooltip')}
                                        icon={<Lightbulb className="h-3.5 w-3.5 text-accent" />}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onDeepDiveExpression(selectedDisplayWord)}
                                    />
                                    <IconButton
                                        label={t('learning.close')}
                                        tooltip={t('learning.close')}
                                        icon={<X className="h-3.5 w-3.5" />}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedWordState(null)}
                                    />
                                </HStack>
                            </div>
                        </div>
                    )}
                </section>

                <div className="mt-4 space-y-4">
                    {/* 前后紧邻对话语境 */}
                    {neighbors.length > 1 && (
                        <Section variant="transparent" padding={0}>
                            <div className="mb-1.5">
                                <Text type="supporting" weight="semibold" color="secondary">
                                    {t('learning.nearbyDialogue')}
                                </Text>
                            </div>
                            <div className="space-y-1 rounded-lg bg-surface/55 p-2.5 text-sm leading-relaxed">
                                {neighbors.map((line) => (
                                    <button
                                        key={line.index}
                                        type="button"
                                        onClick={() => (line.isCurrent ? onPlayOriginal() : onPreviewSubtitleLine?.(line.index))}
                                        className={cn(
                                            'flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-muted/45 cursor-pointer',
                                            line.isCurrent ? 'font-medium text-primary bg-surface/80' : 'text-secondary/80',
                                        )}
                                    >
                                        <span className="shrink-0 font-mono text-metadata opacity-60">#{line.index + 1}</span>
                                        <span className="min-w-0 flex-1">{line.text}</span>
                                    </button>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* 默认折叠的「本句收获」沉淀条 */}
                    <Section variant="transparent" padding={0} className="border-t border-border/40 pt-3">
                        {!noteExpanded ? (
                            <button
                                type="button"
                                data-testid="takeaway-collapsed-bar"
                                onClick={() => setNoteExpandedFor(sentence.en)}
                                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface/65"
                            >
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                    <NotebookPen className="h-3.5 w-3.5 shrink-0 text-accent" />
                                    <span className="shrink-0 text-sm font-medium text-secondary">
                                        {t('learning.takeawayTitle')}
                                    </span>
                                    <span className={cn('truncate text-sm', noteSummary.trim() ? 'text-primary' : 'text-secondary/70')}>
                                        {noteSummary.trim() || t('learning.takeawayEmptyHint')}
                                    </span>
                                </span>
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-secondary" />
                            </button>
                        ) : (
                            <div>
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <HStack gap={1.5} vAlign="center">
                                        <NotebookPen className="h-3.5 w-3.5 text-accent" />
                                        <Text type="supporting" weight="semibold" color="secondary">
                                            {t('learning.takeawayTitle')}
                                        </Text>
                                    </HStack>
                                    <HStack gap={1} vAlign="center">
                                        <Button
                                            label={noteSaving ? t('learning.noteSaving') : t('learning.noteSaveShort')}
                                            size="sm"
                                            variant="ghost"
                                            isDisabled={noteSaving}
                                            onClick={onSaveNote}
                                        />
                                        <IconButton
                                            label={t('learning.close')}
                                            icon={<ChevronUp className="h-3.5 w-3.5" />}
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setNoteExpandedFor(null)}
                                        />
                                    </HStack>
                                </div>
                                <textarea
                                    value={noteSummary}
                                    onChange={(e) => onNoteChange(e.target.value)}
                                    onBlur={onSaveNote}
                                    rows={2}
                                    placeholder={t('learning.takeawayPlaceholder')}
                                    className="w-full resize-y rounded-lg border border-border/50 bg-body/70 p-2 text-sm leading-relaxed text-primary outline-none focus:border-accent-bg"
                                />
                            </div>
                        )}
                    </Section>
                </div>
            </div>
        </div>
    );
}
