import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useSWR from 'swr';
import {
    ChevronLeft,
    ChevronRight,
    Filter,
    History,
    Maximize2,
    Minimize2,
    Volume2,
    VolumeX,
    X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type {
    SentencePracticeMode,
    SentencePracticeResultVO,
    SentencePracticeSummaryVO,
} from '@/common/contracts/sentence-practice';
import UrlUtil from '@/common/utils/UrlUtil';
import { cn } from '@/fronted/lib/utils';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { Popover, PopoverContent, PopoverTrigger } from '@/fronted/components/ui/popover';
import { CONTROL_POPOVER_PANEL } from '@/fronted/features/player/components/ControlPopover';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import useTranslationStore from '@/fronted/features/player/translationStore';
import { useVocabularyState } from '@/fronted/features/player/vocabularyStore';
import { exitOverlayView } from '@/fronted/features/player/lib/player-view-controller';
import { practiceApi } from '../practiceApi';
import usePracticePanel, {
    type DictationStyle,
    type PracticeSentenceFilter,
    type ShadowingStyle,
} from '../practiceStore';
import {
    buildPracticeUnits,
    matchesPracticeFilter,
    PRACTICE_PASS_SCORE,
    type PracticeUnit,
} from '../practiceUnit';
import { recordPracticeWordEvidence } from '../practiceWordEvidence';
import BlindDictation from './BlindDictation';
import ShadowingStudio from './ShadowingStudio';
import WordSlotDictation from './WordSlotDictation';

const logger = getRendererLogger('PracticeDock');

interface SubStylePillOption<T extends string> {
    value: T;
    label: string;
}

/** 紧凑二级风格胶囊切换器（避免顶栏堆两排大 Tab）。 */
function SubStylePills<T extends string>({
    value,
    options,
    onChange,
}: {
    value: T;
    options: SubStylePillOption<T>[];
    onChange: (next: T) => void;
}) {
    return (
        <div className="inline-flex items-center rounded-lg border border-border/60 bg-muted/50 p-0.5">
            {options.map((opt) => {
                const active = value === opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            'rounded-md px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer',
                            active
                                ? 'bg-surface text-foreground shadow-xs'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * 句子跟读与听写工坊主停靠台：原位接管播放器底栏主字幕区。
 *
 * 布局与体验特征：
 * - 不覆盖视频舞台，保留口型与剧情线索；
 * - 统一收口节拍跟读、录音对比、词槽即时听写与整句盲听；
 * - 全程使用受控片段试听（`playPracticeClip`），绝不滑进下一句丢失当前输入；
 * - 驱动整集筛选队列（全部/未练/低分/含生词）与全键盘零鼠标工作流。
 */
export default function PracticeDock() {
    const { t } = useTranslation('practice');

    const {
        visible,
        mode,
        shadowingStyle,
        dictationStyle,
        focusMode,
        soundCues,
        sentenceFilter,
        peekingSpoiler,
        recording,
        setMode,
        setShadowingStyle,
        setDictationStyle,
        setFocusMode,
        setSoundCues,
        setSentenceFilter,
        setDictationRevealed,
        setPeekingSpoiler,
    } = usePracticePanel(
        useShallow((s) => ({
            visible: s.visible,
            mode: s.mode,
            shadowingStyle: s.shadowingStyle,
            dictationStyle: s.dictationStyle,
            focusMode: s.focusMode,
            soundCues: s.soundCues,
            sentenceFilter: s.sentenceFilter,
            peekingSpoiler: s.peekingSpoiler,
            recording: s.recording,
            setMode: s.setMode,
            setShadowingStyle: s.setShadowingStyle,
            setDictationStyle: s.setDictationStyle,
            setFocusMode: s.setFocusMode,
            setSoundCues: s.setSoundCues,
            setSentenceFilter: s.setSentenceFilter,
            setDictationRevealed: s.setDictationRevealed,
            setPeekingSpoiler: s.setPeekingSpoiler,
        })),
    );

    const currentSentence = usePlayerState((s) => s.currentSentence);
    const sentences = usePlayer((s) => s.sentences);
    const srtTender = usePlayer((s) => s.srtTender);
    const srtResegmented = usePlaybackSession((s) => s.srtResegmented);
    const sentenceBlockMode = usePlayerUi((s) => s.sentenceBlockMode);
    const translations = useTranslationStore((s) => s.translations);
    const { isVocabularyWord, getBaseWord } = useVocabularyState(
        useShallow((s) => ({
            isVocabularyWord: s.isVocabularyWord,
            getBaseWord: s.getBaseWord,
            version: s.version,
        })),
    );

    const [result, setResult] = useState<SentencePracticeResultVO | null>(null);
    const [attemptNonce, setAttemptNonce] = useState(0);
    const [filterOpen, setFilterOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    const { data: resourceStatus } = useSWR(
        'settings/resource-status/detail',
        () => settingsApi.getResourceStatus(),
    );
    const asrReady = resourceStatus?.transcription?.ready ?? false;

    const units = useMemo(
        () => buildPracticeUnits(sentences, srtTender, sentenceBlockMode, currentSentence),
        [sentences, srtTender, sentenceBlockMode, currentSentence],
    );

    const activeUnit: PracticeUnit | null = useMemo(() => {
        if (!currentSentence) return units[0] ?? null;
        return units.find((u) => u.key === currentSentence.key || u.sentences.some((s) => s.key === currentSentence.key))
            ?? units[0]
            ?? null;
    }, [currentSentence, units]);

    const unitKey = activeUnit?.key ?? null;
    const latestUnitKeyRef = useRef<string | null>(unitKey);
    const activeFileHash = activeUnit?.fileHash ?? currentSentence?.fileHash ?? '';

    const { data: fileSummaries, mutate: mutateFileSummaries } = useSWR(
        visible && activeFileHash
            ? ['practice/list-by-file', activeFileHash, srtResegmented]
            : null,
        () => practiceApi.listByFile?.({ fileHash: activeFileHash, resegmented: srtResegmented })
            ?? Promise.resolve([] as SentencePracticeSummaryVO[]),
    );

    const summaryByIndex = useMemo(() => {
        const map = new Map<number, SentencePracticeSummaryVO>();
        const list = Array.isArray(fileSummaries) ? fileSummaries : [];
        for (const item of list) {
            map.set(item.sentenceIndex, item);
        }
        return map;
    }, [fileSummaries]);

    const vocabChecker = useMemo(
        () => ({ isVocabularyWord, getBaseWord }),
        [isVocabularyWord, getBaseWord],
    );

    const filterCounts = useMemo(() => {
        const counts: Record<PracticeSentenceFilter, number> = {
            all: units.length,
            unpracticed: 0,
            weak: 0,
            vocab: 0,
        };
        for (const unit of units) {
            if (matchesPracticeFilter(unit, 'unpracticed', summaryByIndex, vocabChecker)) counts.unpracticed += 1;
            if (matchesPracticeFilter(unit, 'weak', summaryByIndex, vocabChecker)) counts.weak += 1;
            if (matchesPracticeFilter(unit, 'vocab', summaryByIndex, vocabChecker)) counts.vocab += 1;
        }
        return counts;
    }, [units, summaryByIndex, vocabChecker]);

    const filteredUnits = useMemo(() => {
        if (sentenceFilter === 'all') return units;
        const matched = units.filter((u) => matchesPracticeFilter(u, sentenceFilter, summaryByIndex, vocabChecker));
        return matched.length > 0 ? matched : units;
    }, [units, sentenceFilter, summaryByIndex, vocabChecker]);

    const currentFilteredPos = useMemo(() => {
        if (!activeUnit) return -1;
        const idx = filteredUnits.findIndex((u) => u.key === activeUnit.key);
        return idx;
    }, [filteredUnits, activeUnit]);

    const historyKey = activeUnit && visible
        ? ['practice/list-by-sentence', activeUnit.fileHash, activeUnit.index, srtResegmented]
        : null;
    const { data: rawHistory, mutate: mutateHistory } = useSWR(
        historyKey,
        () => practiceApi.listBySentence({
            fileHash: activeUnit!.fileHash,
            sentenceIndex: activeUnit!.index,
            resegmented: srtResegmented,
        }),
    );
    const history = Array.isArray(rawHistory) ? rawHistory : [];

    // 换句或切换跟读/听写主模式时重置单次局部结果；Zustand 跨组件防剧透标记放到副作用中同步
    const resetStamp = `${unitKey ?? ''}:${mode}`;
    const [lastResetStamp, setLastResetStamp] = useState(resetStamp);
    if (resetStamp !== lastResetStamp) {
        setLastResetStamp(resetStamp);
        setResult(null);
    }

    useEffect(() => {
        latestUnitKeyRef.current = unitKey;
        audioRef.current?.pause();
        audioRef.current = null;
        playerActions.clearPracticeClip?.();
        setDictationRevealed(false);
        setPeekingSpoiler(false);
    }, [unitKey, mode, setDictationRevealed, setPeekingSpoiler]);

    // 关闭练习工作台时清理音轨与历史回放，不把片段倍速/暂停边界泄漏回观影模式
    useEffect(() => {
        if (!visible) {
            audioRef.current?.pause();
            audioRef.current = null;
            playerActions.clearPracticeClip?.();
        }
    }, [visible]);

    useEffect(() => () => {
        audioRef.current?.pause();
        audioRef.current = null;
        playerActions.clearPracticeClip?.();
    }, []);

    const translationText = useMemo(() => {
        if (!activeUnit) return '';
        const aiLines = activeUnit.sentences
            .map((s) => translations.get(s.translationKey)?.trim() ?? '')
            .filter((line) => line.length > 0);
        if (aiLines.length > 0) return aiLines.join(' ');
        return activeUnit.textZH;
    }, [activeUnit, translations]);

    const playClip = useCallback((unit: PracticeUnit, rate?: number) => {
        if (playerActions.playPracticeClip) {
            playerActions.playPracticeClip(unit.range, unit.anchor, rate !== undefined ? { rate } : undefined);
            return;
        }
        playerActions.gotoSentence(unit.anchor);
        playerActions.play();
    }, []);

    const handleReplay = useCallback(() => {
        if (!activeUnit) return;
        playClip(activeUnit);
    }, [activeUnit, playClip]);

    const handleSlowReplay = useCallback(() => {
        if (!activeUnit) return;
        playClip(activeUnit, 0.75);
    }, [activeUnit, playClip]);

    const navigateOffset = useCallback((delta: number, autoPlay: boolean) => {
        if (filteredUnits.length === 0) return;
        const basePos = currentFilteredPos >= 0 ? currentFilteredPos : 0;
        const nextPos = basePos + delta;
        if (nextPos < 0 || nextPos >= filteredUnits.length) {
            toast(delta > 0
                ? t('panel.reachedLast', { defaultValue: '已是当前队列最后一句' })
                : t('panel.reachedFirst', { defaultValue: '已是当前队列第一句' }));
            return;
        }
        const targetUnit = filteredUnits[nextPos];
        if (!targetUnit) return;
        if (autoPlay) {
            playClip(targetUnit);
        } else {
            playerActions.seekToTarget?.({ time: targetUnit.range.start, target: targetUnit.anchor, play: false });
        }
    }, [currentFilteredPos, filteredUnits, playClip, t]);

    const handleScoreShadowing = useCallback(async (audio: Uint8Array): Promise<SentencePracticeResultVO | null> => {
        if (!activeUnit) return null;
        const targetKey = activeUnit.key;
        const vo = await practiceApi.scoreShadowing({
            fileHash: activeUnit.fileHash,
            sentenceIndex: activeUnit.index,
            resegmented: srtResegmented,
            audio,
            expectedText: activeUnit.text,
        });
        if (latestUnitKeyRef.current !== targetKey) {
            return null;
        }
        setResult(vo);
        void mutateHistory();
        void mutateFileSummaries();
        recordPracticeWordEvidence(vo, 'shadowing', {
            fileHash: activeUnit.fileHash,
            sentenceIndex: activeUnit.index,
            sentenceHash: activeUnit.key,
            text: activeUnit.text,
        });
        return vo;
    }, [activeUnit, mutateFileSummaries, mutateHistory, srtResegmented]);

    const handleSubmitDictation = useCallback(async (typedSentence: string): Promise<void> => {
        if (!activeUnit) return;
        const targetKey = activeUnit.key;
        try {
            const vo = await practiceApi.scoreDictation({
                fileHash: activeUnit.fileHash,
                sentenceIndex: activeUnit.index,
                resegmented: srtResegmented,
                typedText: typedSentence,
                expectedText: activeUnit.text,
            });
            if (latestUnitKeyRef.current !== targetKey) {
                return;
            }
            setResult(vo);
            setDictationRevealed(true);
            void mutateHistory();
            void mutateFileSummaries();
            recordPracticeWordEvidence(vo, 'dictation', {
                fileHash: activeUnit.fileHash,
                sentenceIndex: activeUnit.index,
                sentenceHash: activeUnit.key,
                text: activeUnit.text,
            });
        } catch (error) {
            logger.error('听写评分失败', { error });
            toast.error(error instanceof Error ? error.message : String(error));
        }
    }, [activeUnit, mutateFileSummaries, mutateHistory, setDictationRevealed, srtResegmented]);

    const handlePlayHistoryAudio = useCallback((audioPath: string) => {
        audioRef.current?.pause();
        const audio = new Audio(UrlUtil.toUrl(audioPath));
        audioRef.current = audio;
        void audio.play().catch((error) => {
            logger.error('跟读录音回放失败', { error });
            toast.error(t('recorder.playbackFailed'));
        });
    }, [t]);

    // 练习工作台主控快捷键：Esc 退出，Tab/Shift+Tab 试听，↑/↓ 切换队列句子，F 开关专注态，结果页 Enter 直接跳下一句
    useEffect(() => {
        if (!visible) return undefined;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented) return;
            const target = e.target as HTMLElement | null;
            const isEditable = target
                ? target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
                : false;

            if (e.key === 'Escape') {
                if (filterOpen || historyOpen) return;
                e.preventDefault();
                exitOverlayView();
                return;
            }
            if (e.key === 'Tab') {
                if (filterOpen || historyOpen) return;
                e.preventDefault();
                if (e.shiftKey) handleSlowReplay();
                else handleReplay();
                return;
            }
            if (e.key === 'ArrowUp' && (!isEditable || target?.tagName === 'INPUT')) {
                e.preventDefault();
                navigateOffset(-1, !(mode === 'shadowing' && shadowingStyle === 'beat'));
                return;
            }
            if (e.key === 'ArrowDown' && (!isEditable || target?.tagName === 'INPUT')) {
                e.preventDefault();
                navigateOffset(1, !(mode === 'shadowing' && shadowingStyle === 'beat'));
                return;
            }
            if ((e.key === 'f' || e.key === 'F') && !isEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                setFocusMode(!focusMode);
                return;
            }
            if (
                e.key === 'Enter'
                && !e.shiftKey
                && !e.ctrlKey
                && !e.metaKey
                && !isEditable
                && mode === 'dictation'
                && result !== null
            ) {
                e.preventDefault();
                navigateOffset(1, true);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [
        filterOpen,
        focusMode,
        handleReplay,
        handleSlowReplay,
        historyOpen,
        mode,
        navigateOffset,
        result,
        setFocusMode,
        shadowingStyle,
        visible,
    ]);

    if (!visible || !activeUnit) return null;

    const summary = summaryByIndex.get(activeUnit.index);
    const filterLabelMap: Record<PracticeSentenceFilter, string> = {
        all: t('filter.all', { defaultValue: '全部' }),
        unpracticed: t('filter.unpracticed', { defaultValue: '未练' }),
        weak: t('filter.weak', { defaultValue: '低分' }),
        vocab: t('filter.vocab', { defaultValue: '生词' }),
    };

    const shortcutLegend = mode === 'dictation'
        ? dictationStyle === 'slots'
            ? [
                { keys: 'tab', text: t('shortcut.replay', { defaultValue: '原音' }) },
                { keys: 'shift+tab', text: '0.75×' },
                { keys: '/', text: t('shortcut.hintChar', { defaultValue: '字母提示' }) },
                { keys: '\\', text: t('shortcut.peek', { defaultValue: '按住偷看' }) },
                { keys: 'space', text: t('shortcut.verifyWord', { defaultValue: '校验词' }) },
                { keys: 'enter', text: t('shortcut.submitNext', { defaultValue: '提交/下一句' }) },
            ]
            : [
                { keys: 'tab', text: t('shortcut.replay', { defaultValue: '原音' }) },
                { keys: 'shift+tab', text: '0.75×' },
                { keys: '\\', text: t('shortcut.peek', { defaultValue: '按住偷看' }) },
                { keys: 'enter', text: t('shortcut.submitNext', { defaultValue: '提交/下一句' }) },
            ]
        : shadowingStyle === 'record'
            ? [
                { keys: 'tab', text: t('shortcut.replay', { defaultValue: '原音' }) },
                { keys: 'shift+tab', text: '0.75×' },
                { keys: 'space', text: t('shortcut.ptt', { defaultValue: '对讲/启停' }) },
                { keys: 'v', text: t('shortcut.abCompare', { defaultValue: 'A/B 对比' }) },
                { keys: 'enter', text: t('shortcut.next', { defaultValue: '下一句' }) },
            ]
            : [
                { keys: '↑', text: t('shortcut.prev', { defaultValue: '上一句' }) },
                { keys: '↓', text: t('shortcut.next', { defaultValue: '下一句' }) },
                { keys: 'esc', text: t('shortcut.exit', { defaultValue: '退出' }) },
            ];

    return (
        <div
            data-practice-dock="true"
            className="flex h-full w-full flex-col bg-surface/85 backdrop-blur-xl text-foreground [--text-label-size:var(--text-supporting-size)] [--text-label-leading:var(--text-supporting-leading)]"
        >
            {/* 顶栏：一级模式 + 紧凑子模式 + 筛选进度导航 + 专注/声音/关闭 */}
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-4">
                <div className="flex items-center gap-2.5 min-w-0">
                    <SegmentedControl
                        size="sm"
                        label={t('panel.title')}
                        value={mode}
                        onChange={(next) => setMode(next as SentencePracticeMode)}
                    >
                        <SegmentedControlItem value="shadowing" label={t('panel.tabShadowing')} />
                        <SegmentedControlItem value="dictation" label={t('panel.tabDictation')} />
                    </SegmentedControl>

                    {mode === 'shadowing' ? (
                        <SubStylePills<ShadowingStyle>
                            value={shadowingStyle}
                            onChange={setShadowingStyle}
                            options={[
                                { value: 'record', label: t('shadowing.styleRecord', { defaultValue: '录音对比' }) },
                                { value: 'beat', label: t('shadowing.styleBeat', { defaultValue: '节拍流' }) },
                            ]}
                        />
                    ) : (
                        <SubStylePills<DictationStyle>
                            value={dictationStyle}
                            onChange={setDictationStyle}
                            options={[
                                { value: 'slots', label: t('dictation.styleSlots', { defaultValue: '词槽即时' }) },
                                { value: 'blind', label: t('dictation.styleBlind', { defaultValue: '整句盲听' }) },
                            ]}
                        />
                    )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {/* 句序导航 + 范围筛选 */}
                    <div className="flex items-center rounded-lg border border-border/60 bg-muted/35 px-1 py-0.5 text-xs">
                        <Tooltip content={t('panel.prevSentence', { defaultValue: '上一句 (↑)' })} placement="below">
                            <button
                                type="button"
                                disabled={recording}
                                onClick={() => navigateOffset(-1, true)}
                                aria-label={t('panel.prevSentence', { defaultValue: '上一句 (↑)' })}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/70 disabled:opacity-40 cursor-pointer"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>

                        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono tabular-nums text-foreground hover:bg-muted/60 cursor-pointer"
                                >
                                    <span>
                                        {currentFilteredPos >= 0 ? currentFilteredPos + 1 : 1}/{Math.max(1, filteredUnits.length)}
                                    </span>
                                    <span className="inline-flex items-center gap-0.5 font-sans text-muted-foreground">
                                        <Filter className="h-3 w-3" />
                                        {filterLabelMap[sentenceFilter]}
                                    </span>
                                </button>
                            </PopoverTrigger>
                            <PopoverContent
                                side="bottom"
                                align="end"
                                sideOffset={6}
                                className={cn('w-48 p-1.5', CONTROL_POPOVER_PANEL)}
                            >
                                {(['all', 'unpracticed', 'weak', 'vocab'] as PracticeSentenceFilter[]).map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => {
                                            setSentenceFilter(key);
                                            setFilterOpen(false);
                                        }}
                                        className={cn(
                                            'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors cursor-pointer',
                                            sentenceFilter === key
                                                ? 'bg-accent/15 text-accent font-medium'
                                                : 'text-foreground hover:bg-muted/50',
                                        )}
                                    >
                                        <span>{filterLabelMap[key]}</span>
                                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                            {filterCounts[key]}
                                        </span>
                                    </button>
                                ))}
                            </PopoverContent>
                        </Popover>

                        <Tooltip content={t('panel.nextSentence', { defaultValue: '下一句 (↓)' })} placement="below">
                            <button
                                type="button"
                                disabled={recording}
                                onClick={() => navigateOffset(1, true)}
                                aria-label={t('panel.nextSentence', { defaultValue: '下一句 (↓)' })}
                                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/70 disabled:opacity-40 cursor-pointer"
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>
                    </div>

                    {/* 单句历史角标弹出层 */}
                    {history && history.length > 0 && (
                        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className={cn(
                                        'inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs font-mono tabular-nums transition-colors cursor-pointer',
                                        summary && summary.bestScore >= PRACTICE_PASS_SCORE
                                            ? 'bg-success/10 text-success-text border-success/30'
                                            : 'bg-muted/40 text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <History className="h-3 w-3" />
                                    <span>{summary ? Math.round(summary.bestScore) : history.length}</span>
                                </button>
                            </PopoverTrigger>
                            <PopoverContent
                                side="bottom"
                                align="end"
                                sideOffset={6}
                                className={cn('w-64 p-2', CONTROL_POPOVER_PANEL)}
                            >
                                <div className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">
                                    {t('result.history')} ({history.length})
                                </div>
                                <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
                                    {history.slice(0, 12).map((record) => (
                                        <div key={record.id} className="flex items-center justify-between gap-2 py-1.5 px-1 text-xs">
                                            <span className="text-muted-foreground">
                                                {record.mode === 'shadowing' ? t('result.modeShadowing') : t('result.modeDictation')}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                {record.audioPath && (
                                                    <button
                                                        type="button"
                                                        aria-label={t('result.playMine')}
                                                        onClick={() => handlePlayHistoryAudio(record.audioPath!)}
                                                        className="text-muted-foreground hover:text-foreground cursor-pointer"
                                                    >
                                                        <Volume2 className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                                <span
                                                    className={cn(
                                                        'font-mono font-semibold tabular-nums',
                                                        record.score >= 80
                                                            ? 'text-success-text'
                                                            : record.score >= 50
                                                                ? 'text-warning-text'
                                                                : 'text-error-text',
                                                    )}
                                                >
                                                    {Math.round(record.score)}
                                                </span>
                                            </div>
                                            <span className="font-mono text-muted-foreground/70">{record.createdAt.slice(5, 16)}</span>
                                        </div>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                    )}

                    <Tooltip
                        content={soundCues
                            ? t('panel.soundOn', { defaultValue: '反馈音效已开启' })
                            : t('panel.soundOff', { defaultValue: '反馈音效已静音' })}
                        placement="below"
                    >
                        <IconButton
                            label={t('panel.soundToggle', { defaultValue: '切换反馈音效' })}
                            icon={soundCues ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                            variant="ghost"
                            size="sm"
                            onClick={() => setSoundCues(!soundCues)}
                        />
                    </Tooltip>

                    <Tooltip
                        content={focusMode
                            ? t('panel.exitFocus', { defaultValue: '退出专注模式 (F)' })
                            : t('panel.enterFocus', { defaultValue: '专注精练模式：收起右侧文稿防剧透 (F)' })}
                        placement="below"
                    >
                        <IconButton
                            label={t('panel.focusToggle', { defaultValue: '切换专注模式' })}
                            icon={focusMode ? <Minimize2 className="h-3.5 w-3.5 text-accent" /> : <Maximize2 className="h-3.5 w-3.5" />}
                            variant="ghost"
                            size="sm"
                            onClick={() => setFocusMode(!focusMode)}
                        />
                    </Tooltip>

                    <Tooltip content={t('common:close', { defaultValue: '关闭 (Esc)' })} placement="below">
                        <IconButton
                            label={t('common:close', { defaultValue: '关闭' })}
                            icon={<X className="h-4 w-4" />}
                            variant="ghost"
                            size="sm"
                            onClick={() => exitOverlayView()}
                        />
                    </Tooltip>
                </div>
            </div>

            {/* 中央核心练习区 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 flex flex-col justify-center">
                {mode === 'shadowing' ? (
                    <ShadowingStudio
                        unit={activeUnit}
                        style={shadowingStyle}
                        asrReady={asrReady}
                        translationText={translationText}
                        result={result}
                        onScoreRecording={handleScoreShadowing}
                        onReplay={handleReplay}
                        onSlowReplay={handleSlowReplay}
                        onNextSentence={() => navigateOffset(1, shadowingStyle !== 'beat')}
                    />
                ) : dictationStyle === 'slots' ? (
                    <WordSlotDictation
                        key={`slots-${activeUnit.key}-${attemptNonce}`}
                        unit={activeUnit}
                        result={result}
                        peekingSpoiler={peekingSpoiler}
                        translationText={translationText}
                        onPeekChange={setPeekingSpoiler}
                        onReplay={handleReplay}
                        onSlowReplay={handleSlowReplay}
                        onSubmitSentence={handleSubmitDictation}
                        onRetry={() => {
                            setResult(null);
                            setDictationRevealed(false);
                            setAttemptNonce((n) => n + 1);
                        }}
                        onNextSentence={() => navigateOffset(1, true)}
                    />
                ) : (
                    <BlindDictation
                        key={`blind-${activeUnit.key}-${attemptNonce}`}
                        unit={activeUnit}
                        result={result}
                        peekingSpoiler={peekingSpoiler}
                        translationText={translationText}
                        onPeekChange={setPeekingSpoiler}
                        onReplay={handleReplay}
                        onSlowReplay={handleSlowReplay}
                        onSubmitSentence={handleSubmitDictation}
                        onRetry={() => {
                            setResult(null);
                            setDictationRevealed(false);
                            setAttemptNonce((n) => n + 1);
                        }}
                        onNextSentence={() => navigateOffset(1, true)}
                    />
                )}
            </div>

            {/* 底部键盘流提示条 */}
            <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/40 bg-muted/20 px-4 text-xs text-muted-foreground overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex items-center gap-3 shrink-0">
                    {shortcutLegend.map((item) => (
                        <span key={item.keys + item.text} className="inline-flex items-center gap-1">
                            <Kbd keys={item.keys} />
                            <span>{item.text}</span>
                        </span>
                    ))}
                </div>
                <span className="hidden sm:inline text-muted-foreground/75 shrink-0">
                    {t('panel.totalPracticed', {
                        defaultValue: '本片已练 {{done}}/{{total}} 句',
                        done: summaryByIndex.size,
                        total: units.length,
                    })}
                </span>
            </div>
        </div>
    );
}
