/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { showNotification } from '@/fronted/components/shared/toasts/notification';
import useSWR from 'swr';
import {
    BookOpenCheck,
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
import useChatPanel from '@/fronted/features/chat/chatStore';
import { Button } from '@astryxdesign/core/Button';
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
import { isInteractiveTarget, isTextEntryTarget } from '@/fronted/lib/keyboard';
import { usePopover } from '@astryxdesign/core/Popover';
import { CONTROL_POPOVER_PANEL } from '@/fronted/features/player/components/ControlPopover';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayer } from '@/fronted/features/player/playerStore';
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
import type { RhythmTrendVO } from '@/common/learning/rhythmTrend';
import { describeAsrFailure } from '@/common/utils/practice/asr-error';
import WordSlotDictation from './WordSlotDictation';

const logger = getRendererLogger('PracticeDock');

interface SubStylePillOption<T extends string> {
    value: T;
    label: string;
}

/** 二级子模式切换：复用 Astryx SegmentedControl size="sm"，与主模式及顶栏按钮严格同高同字号。 */
function SubStylePills<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: SubStylePillOption<T>[];
    onChange: (next: T) => void;
}) {
    return (
        <div className="shrink-0">
            <SegmentedControl
                size="sm"
                label={label}
                value={value}
                onChange={(next) => onChange(next as T)}
            >
                {options.map((opt) => (
                    <SegmentedControlItem key={opt.value} value={opt.value} label={opt.label} />
                ))}
            </SegmentedControl>
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
        recorderPhase,
        openedFromLearning,
        setMode,
        setShadowingStyle,
        setDictationStyle,
        setFocusMode,
        setSoundCues,
        setSentenceFilter,
        setDictationRevealed,
        setPeekingSpoiler,
        setOpenedFromLearning,
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
            recorderPhase: s.recorderPhase,
            openedFromLearning: s.openedFromLearning,
            setMode: s.setMode,
            setShadowingStyle: s.setShadowingStyle,
            setDictationStyle: s.setDictationStyle,
            setFocusMode: s.setFocusMode,
            setSoundCues: s.setSoundCues,
            setSentenceFilter: s.setSentenceFilter,
            setDictationRevealed: s.setDictationRevealed,
            setPeekingSpoiler: s.setPeekingSpoiler,
            setOpenedFromLearning: s.setOpenedFromLearning,
        })),
    );
    const recorderBusy = recorderPhase !== 'idle';
    const recorderProcessing = recorderPhase === 'processing';

    const currentSentence = usePlayerState((s) => s.currentSentence);
    const sentences = usePlayer((s) => s.sentences);
    const srtTender = usePlayer((s) => s.srtTender);
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
    const filterPopover = usePopover({
        className: cn('w-48 p-1.5', CONTROL_POPOVER_PANEL),
        hasSurface: false,
        isModal: false,
        dialogLabel: t('filter.title', { defaultValue: '句子筛选' }),
    });
    const historyPopover = usePopover({
        className: cn('w-64 p-2', CONTROL_POPOVER_PANEL),
        hasSurface: false,
        isModal: false,
        dialogLabel: t('result.history'),
    });

    const audioRef = useRef<HTMLAudioElement | null>(null);

    const { data: resourceStatus } = useSWR(
        'settings/resource-status/detail',
        () => settingsApi.getResourceStatus(),
    );
    const asrReady = resourceStatus?.transcription?.ready ?? false;

    const units = useMemo(
        () => buildPracticeUnits(sentences, srtTender, currentSentence),
        [sentences, srtTender, currentSentence],
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
            ? ['practice/list-by-file', activeFileHash]
            : null,
        () => practiceApi.listByFile?.({ fileHash: activeFileHash })
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
        ? ['practice/list-by-sentence', activeUnit.fileHash, activeUnit.index]
        : null;
    const { data: rawHistory, mutate: mutateHistory } = useSWR(
        historyKey,
        () => practiceApi.listBySentence({
            fileHash: activeUnit!.fileHash,
            sentenceIndex: activeUnit!.index,
        }),
    );
    const history = Array.isArray(rawHistory) ? rawHistory : [];

    // 跨次节奏趋势：只有跟读录音才产生节奏快照，听写模式不必查询。
    const trendKey = activeUnit && visible && mode === 'shadowing'
        ? ['practice/rhythm-trend', activeUnit.fileHash, activeUnit.index]
        : null;
    const { data: rhythmTrend } = useSWR<RhythmTrendVO>(
        trendKey,
        () => practiceApi.getRhythmTrend({
            fileHash: activeUnit!.fileHash,
            sentenceIndex: activeUnit!.index,
        }),
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );

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
            audio,
            expectedText: activeUnit.text,
            referenceDurationSec: activeUnit.range.end - activeUnit.range.start,
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
    }, [activeUnit, mutateFileSummaries, mutateHistory]);

    const handleSubmitDictation = useCallback(async (typedSentence: string): Promise<boolean> => {
        if (!activeUnit) return false;
        const targetKey = activeUnit.key;
        try {
            const vo = await practiceApi.scoreDictation({
                fileHash: activeUnit.fileHash,
                sentenceIndex: activeUnit.index,
                typedText: typedSentence,
                expectedText: activeUnit.text,
            });
            if (latestUnitKeyRef.current !== targetKey) {
                return false;
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
            return true;
        } catch (error) {
            logger.error('听写评分失败', { error });
            // 与跟读评分失败共用同一条通道与去重键，避免同一错误弹两种样式的提示
            const message = describeAsrFailure(error);
            showNotification({ message, variant: 'error', dedupeKey: `ipc-error:${message}` });
            return false;
        }
    }, [activeUnit, mutateFileSummaries, mutateHistory, setDictationRevealed]);

    const handlePlayHistoryAudio = useCallback((audioPath: string) => {
        audioRef.current?.pause();
        const audio = new Audio(UrlUtil.toUrl(audioPath));
        audioRef.current = audio;
        void audio.play().catch((error) => {
            logger.error('跟读录音回放失败', { error });
            toast.error(t('recorder.playbackFailed'));
        });
    }, [t]);

    // 练习工作台主控快捷键：Esc 退出，Alt+R / Alt+Shift+R 试听，↑/↓ 切换队列句子，F 开关专注态，结果页 Enter 直接跳下一句
    useEffect(() => {
        if (!visible) return undefined;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented) return;
            const target = e.target as HTMLElement | null;
            const isEditable = isTextEntryTarget(target);
            const isInteractive = isInteractiveTarget(target);

            if (e.key === 'Escape') {
                if (filterPopover.isOpen || historyPopover.isOpen || recorderProcessing) return;
                e.preventDefault();
                exitOverlayView();
                return;
            }
            if ((e.key === 'r' || e.key === 'R') && e.altKey && !e.ctrlKey && !e.metaKey && !isEditable) {
                // 非空闲态（请求授权/录音/评分）禁止试听：外放原声会被正在采集的麦克风录进评分音频
                if (recorderBusy) return;
                e.preventDefault();
                if (e.shiftKey) handleSlowReplay();
                else handleReplay();
                return;
            }
            if (e.key === 'ArrowUp' && !isEditable && !isInteractive) {
                // 非空闲态禁止切句：切句会重挂载录音视图，静默丢弃整段录音
                if (recorderBusy) return;
                e.preventDefault();
                navigateOffset(-1, !(mode === 'shadowing' && shadowingStyle === 'beat'));
                return;
            }
            if (e.key === 'ArrowDown' && !isEditable && !isInteractive) {
                if (recorderBusy) return;
                e.preventDefault();
                navigateOffset(1, !(mode === 'shadowing' && shadowingStyle === 'beat'));
                return;
            }
            if ((e.key === 'f' || e.key === 'F') && !isEditable && !isInteractive && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
                && !isInteractive
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
        filterPopover.isOpen,
        focusMode,
        handleReplay,
        handleSlowReplay,
        historyPopover.isOpen,
        mode,
        navigateOffset,
        recorderBusy,
        recorderProcessing,
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
                { keys: 'alt+r', text: t('shortcut.replay', { defaultValue: '原音' }) },
                { keys: 'alt+shift+r', text: '0.75×' },
                { keys: '/', text: t('shortcut.hintChar', { defaultValue: '字母提示' }) },
                { keys: '\\', text: t('shortcut.peek', { defaultValue: '按住偷看' }) },
                { keys: 'space', text: t('shortcut.verifyWord', { defaultValue: '校验词' }) },
                { keys: 'enter', text: t('shortcut.submitNext', { defaultValue: '提交/下一句' }) },
            ]
            : [
                { keys: 'alt+r', text: t('shortcut.replay', { defaultValue: '原音' }) },
                { keys: 'alt+shift+r', text: '0.75×' },
                { keys: '\\', text: t('shortcut.peek', { defaultValue: '按住偷看' }) },
                { keys: 'enter', text: t('shortcut.submitNext', { defaultValue: '提交/下一句' }) },
            ]
        : shadowingStyle === 'record'
            ? [
                { keys: 'alt+r', text: t('shortcut.replay', { defaultValue: '原音' }) },
                { keys: 'alt+shift+r', text: '0.75×' },
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
            data-recorder-phase={recorderPhase}
            className="flex h-full w-full flex-col bg-surface/85 backdrop-blur-xl text-primary [--text-label-size:var(--text-supporting-size)] [--text-label-leading:var(--text-supporting-leading)]"
        >
            {/* 顶栏：一级模式 + 紧凑子模式 + 筛选进度导航 + 专注/声音/关闭 */}
            <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-4">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="shrink-0">
                        <SegmentedControl
                            size="sm"
                            label={t('panel.title')}
                            value={mode}
                            onChange={(next) => {
                                if (recorderProcessing) return;
                                setMode(next as SentencePracticeMode);
                            }}
                        >
                            <SegmentedControlItem value="shadowing" label={t('panel.tabShadowing')} />
                            <SegmentedControlItem value="dictation" label={t('panel.tabDictation')} />
                        </SegmentedControl>
                    </div>

                    <span className="h-3.5 w-px bg-border/55" aria-hidden />

                    {mode === 'shadowing' ? (
                        <SubStylePills<ShadowingStyle>
                            label={t('panel.tabShadowing')}
                            value={shadowingStyle}
                            onChange={(next) => {
                                if (recorderProcessing) return;
                                setShadowingStyle(next);
                            }}
                            options={[
                                { value: 'record', label: t('shadowing.styleRecord', { defaultValue: '录音对比' }) },
                                { value: 'beat', label: t('shadowing.styleBeat', { defaultValue: '节拍流' }) },
                            ]}
                        />
                    ) : (
                        <SubStylePills<DictationStyle>
                            label={t('panel.tabDictation')}
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
                    <div className="flex h-[var(--size-element-sm)] items-center rounded-lg border border-border/60 bg-muted/35 px-1 text-[length:var(--text-supporting-size)]">
                        <Tooltip content={t('panel.prevSentence', { defaultValue: '上一句 (↑)' })} placement="below">
                            <button
                                type="button"
                                aria-disabled={recorderBusy}
                                onClick={() => {
                                    if (recorderBusy) return;
                                    navigateOffset(-1, true);
                                }}
                                aria-label={t('panel.prevSentence', { defaultValue: '上一句 (↑)' })}
                                className="rounded p-1 text-secondary hover:text-primary hover:bg-muted/70 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed cursor-pointer"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>

                        <button
                            type="button"
                            ref={filterPopover.triggerRef}
                            aria-disabled={recorderBusy}
                            onClick={() => {
                                if (recorderBusy) return;
                                filterPopover.toggle();
                            }}
                            {...filterPopover.triggerProps}
                            className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono tabular-nums text-primary hover:bg-muted/60 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed cursor-pointer"
                        >
                            <span>
                                {currentFilteredPos >= 0 ? currentFilteredPos + 1 : 1}/{Math.max(1, filteredUnits.length)}
                            </span>
                            <span className="inline-flex items-center gap-0.5 font-sans text-secondary">
                                <Filter className="h-3 w-3" />
                                {filterLabelMap[sentenceFilter]}
                            </span>
                        </button>
                        {filterPopover.render(
                            <>
                                {(['all', 'unpracticed', 'weak', 'vocab'] as PracticeSentenceFilter[]).map((key) => (
                                    <label
                                        key={key}
                                        className={cn(
                                            'flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-focus-ring',
                                            sentenceFilter === key
                                                ? 'bg-accent-bg/15 text-accent font-medium'
                                                : 'text-primary hover:bg-muted/50',
                                        )}
                                    >
                                        <span>{filterLabelMap[key]}</span>
                                        <span className="flex items-center gap-2">
                                            <span className="font-mono text-metadata text-secondary tabular-nums">
                                                {filterCounts[key]}
                                            </span>
                                            <input
                                                type="radio"
                                                name="practice-sentence-filter"
                                                className="sr-only"
                                                checked={sentenceFilter === key}
                                                onChange={() => {
                                                    if (recorderBusy) return;
                                                    setSentenceFilter(key);
                                                    filterPopover.hide();
                                                }}
                                            />
                                        </span>
                                    </label>
                                ))}
                            </>,
                            { placement: 'below', alignment: 'end', offset: 6 },
                        )}

                        <Tooltip content={t('panel.nextSentence', { defaultValue: '下一句 (↓)' })} placement="below">
                            <button
                                type="button"
                                aria-disabled={recorderBusy}
                                onClick={() => {
                                    if (recorderBusy) return;
                                    navigateOffset(1, true);
                                }}
                                aria-label={t('panel.nextSentence', { defaultValue: '下一句 (↓)' })}
                                className="rounded p-1 text-secondary hover:text-primary hover:bg-muted/70 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed cursor-pointer"
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>
                    </div>

                    {/* 单句历史角标弹出层 */}
                    {history && history.length > 0 && (
                        <>
                            <button
                                type="button"
                                ref={historyPopover.triggerRef}
                                onClick={historyPopover.toggle}
                                {...historyPopover.triggerProps}
                                aria-label={`${t('result.history')} ${history.length}`}
                                className={cn(
                                    'inline-flex h-[var(--size-element-sm)] items-center gap-1 rounded-lg border border-border/60 px-2 text-[length:var(--text-supporting-size)] font-mono tabular-nums transition-colors cursor-pointer',
                                    summary && summary.bestScore >= PRACTICE_PASS_SCORE
                                        ? 'bg-success/10 text-success-text border-success/30'
                                        : 'bg-muted/40 text-secondary hover:text-primary',
                                )}
                            >
                                <History className="h-3 w-3" />
                                <span>{summary ? Math.round(summary.bestScore) : history.length}</span>
                            </button>
                            {historyPopover.render(
                                <>
                                    <div className="mb-1.5 px-1 text-metadata font-semibold text-secondary">
                                        {t('result.history')} ({history.length})
                                    </div>
                                    <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
                                        {history.slice(0, 12).map((record) => (
                                            <div key={record.id} className="flex items-center justify-between gap-2 py-1.5 px-1 text-sm">
                                                <span className="text-secondary">
                                                    {record.mode === 'shadowing' ? t('result.modeShadowing') : t('result.modeDictation')}
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    {record.audioPath && (
                                                        <button
                                                            type="button"
                                                            aria-label={t('result.playMine')}
                                                            onClick={() => handlePlayHistoryAudio(record.audioPath!)}
                                                            className="text-secondary hover:text-primary cursor-pointer"
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
                                                <span className="font-mono text-secondary/70">{record.createdAt.slice(5, 16)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </>,
                                { placement: 'below', alignment: 'end', offset: 6 },
                            )}
                        </>
                    )}

                    {openedFromLearning ? (
                        <Button
                            label={t('panel.returnToLearning', { defaultValue: '返回精读' })}
                            size="sm"
                            variant="secondary"
                            isDisabled={recorderBusy}
                            icon={<BookOpenCheck className="h-3.5 w-3.5 text-accent" />}
                            onClick={() => {
                                if (!activeUnit || recorderBusy) return;
                                const failedWords = (result?.words ?? [])
                                    .filter((w) => w.status === 'missing' || w.status === 'sub')
                                    .map((w) => w.expected);
                                setOpenedFromLearning(false);
                                if (failedWords.length > 0) {
                                    void useChatPanel.getState().openFromPracticeIssue(activeUnit.anchor, failedWords);
                                } else {
                                    void useChatPanel.getState().openSentenceSession(activeUnit.anchor);
                                }
                            }}
                        />
                    ) : (
                        <Tooltip content={t('panel.askAiAnalyze', { defaultValue: 'AI 精读拆解' })} placement="below">
                            <IconButton
                                label={t('panel.askAiAnalyze', { defaultValue: 'AI 精读拆解' })}
                                icon={<BookOpenCheck className="h-3.5 w-3.5 text-accent" />}
                                variant="ghost"
                                size="sm"
                                isDisabled={recorderBusy}
                                onClick={() => {
                                    if (!activeUnit || recorderBusy) return;
                                    const failedWords = (result?.words ?? [])
                                        .filter((w) => w.status === 'missing' || w.status === 'sub')
                                        .map((w) => w.expected);
                                    void useChatPanel.getState().openFromPracticeIssue(activeUnit.anchor, failedWords);
                                }}
                            />
                        </Tooltip>
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
                            isDisabled={recorderProcessing}
                            onClick={() => {
                                if (recorderProcessing) return;
                                exitOverlayView();
                            }}
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
                        trend={rhythmTrend}
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
                            setPeekingSpoiler(false);
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
                            setPeekingSpoiler(false);
                            setAttemptNonce((n) => n + 1);
                        }}
                        onNextSentence={() => navigateOffset(1, true)}
                    />
                )}
            </div>

            {/* 底部键盘流提示条 */}
            <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/40 bg-muted/20 px-4 text-metadata text-secondary overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex items-center gap-3 shrink-0">
                    {shortcutLegend.map((item) => (
                        <span key={item.keys + item.text} className="inline-flex items-center gap-1">
                            <Kbd keys={item.keys} />
                            <span>{item.text}</span>
                        </span>
                    ))}
                </div>
                <span className="hidden sm:inline text-secondary/75 shrink-0">
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
