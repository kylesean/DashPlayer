import { create } from 'zustand';
import type { SentencePracticeMode } from '@/common/contracts/sentence-practice';
import type { PracticeRecorderPhase } from './lib/recorder-phase';

/** 跟读工坊子流派：节拍跟读(无录音节奏留白) / 录音对比(波形+A/B听辨+ASR对齐)。 */
export type ShadowingStyle = 'beat' | 'record';

/** 听写工坊子流派：词槽即时(心流填空) / 整句盲听(考场挑战)。 */
export type DictationStyle = 'slots' | 'blind';

/** 整集练习句子筛选范围。 */
export type PracticeSentenceFilter = 'all' | 'unpracticed' | 'weak' | 'vocab';

const STORAGE_KEYS = {
    dictationStyle: 'refrain.practice.dictation_style',
    shadowingStyle: 'refrain.practice.shadowing_style',
    soundCues: 'refrain.practice.sound_cues',
    autoRecordFlow: 'refrain.practice.auto_record_flow',
} as const;

function readStorage<T extends string>(key: string, fallback: T, valid?: readonly string[]): T {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw && (!valid || valid.includes(raw))) {
            return raw as T;
        }
    } catch {
        // 沙盒/单测环境 localStorage 不可用时回退默认值
    }
    return fallback;
}

function readBooleanStorage(key: string, fallback: boolean): boolean {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
    } catch {
        // 沙盒/单测环境 localStorage 不可用时回退默认值
    }
    return fallback;
}
function writeStorage(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // 忽略写存储失败
    }
}

interface PracticePanelState {
    /** 练习工作台是否可见（替代底栏主字幕区）。 */
    visible: boolean;
    /** 当前一级练习模式:跟读 / 听写。 */
    mode: SentencePracticeMode;
    /** 跟读子模式：节拍流 / 录音对比。 */
    shadowingStyle: ShadowingStyle;
    /** 听写子模式：词槽即时 / 整句盲听。 */
    dictationStyle: DictationStyle;
    /** 专注精练态：临时收起右侧文稿并让底部练习台获得更大呼吸空间。 */
    focusMode: boolean;
    /** 是否启用轻微 Web Audio 反馈音效。 */
    soundCues: boolean;
    /** 录音对比下的自动流水线（播完原音自动滴声开麦 + VAD 静音停麦）。 */
    autoRecordFlow: boolean;
    /** 整集连刷筛选范围。 */
    sentenceFilter: PracticeSentenceFilter;
    /** 当前句听写是否已揭晓原文（用于控制右侧字幕防剧透幕布）。 */
    dictationRevealed: boolean;
    /** 用户按住偷看键临时揭开右侧字幕防剧透与提示。 */
    peekingSpoiler: boolean;
    /** 跟读录音机精确阶段（含 requesting / recording / processing）；录音是否进行中由 `recorderPhase === 'recording'` 派生。 */
    recorderPhase: PracticeRecorderPhase;
    /** 从「整句学习」工作台跳来练习时为 true，方便练习顶栏直接一键退回精读页。 */
    openedFromLearning: boolean;
    setVisible: (visible: boolean) => void;
    setMode: (mode: SentencePracticeMode) => void;
    setShadowingStyle: (style: ShadowingStyle) => void;
    setDictationStyle: (style: DictationStyle) => void;
    setFocusMode: (focusMode: boolean) => void;
    setSoundCues: (enabled: boolean) => void;
    setAutoRecordFlow: (enabled: boolean) => void;
    setSentenceFilter: (filter: PracticeSentenceFilter) => void;
    setDictationRevealed: (revealed: boolean) => void;
    setPeekingSpoiler: (peeking: boolean) => void;
    setRecorderPhase: (phase: PracticeRecorderPhase) => void;
    setOpenedFromLearning: (fromLearning: boolean) => void;
    toggle: () => void;
}

/**
 * 句子跟读/听写工作台全局状态。
 *
 * 面板由播放布局底部原位接管主字幕区，与整句学习页、播客全屏覆盖层互斥。
 */
const usePracticePanel = create<PracticePanelState>((set) => ({
    visible: false,
    mode: 'shadowing',
    shadowingStyle: readStorage<ShadowingStyle>(STORAGE_KEYS.shadowingStyle, 'record', ['beat', 'record']),
    dictationStyle: readStorage<DictationStyle>(STORAGE_KEYS.dictationStyle, 'slots', ['slots', 'blind']),
    focusMode: false,
    soundCues: readBooleanStorage(STORAGE_KEYS.soundCues, true),
    autoRecordFlow: readBooleanStorage(STORAGE_KEYS.autoRecordFlow, false),
    sentenceFilter: 'all',
    dictationRevealed: false,
    peekingSpoiler: false,
    recorderPhase: 'idle',
    openedFromLearning: false,
    setVisible: (visible) => set((state) => ({
        visible,
        ...(visible ? {} : { peekingSpoiler: false, dictationRevealed: false, openedFromLearning: false }),
        mode: state.mode,
    })),
    setMode: (mode) => set({ mode, dictationRevealed: false, peekingSpoiler: false }),
    setShadowingStyle: (shadowingStyle) => {
        writeStorage(STORAGE_KEYS.shadowingStyle, shadowingStyle);
        set({ shadowingStyle });
    },
    setDictationStyle: (dictationStyle) => {
        writeStorage(STORAGE_KEYS.dictationStyle, dictationStyle);
        set({ dictationStyle });
    },
    setFocusMode: (focusMode) => set({ focusMode }),
    setSoundCues: (soundCues) => {
        writeStorage(STORAGE_KEYS.soundCues, String(soundCues));
        set({ soundCues });
    },
    setAutoRecordFlow: (autoRecordFlow) => {
        writeStorage(STORAGE_KEYS.autoRecordFlow, String(autoRecordFlow));
        set({ autoRecordFlow });
    },
    setSentenceFilter: (sentenceFilter) => set({ sentenceFilter }),
    setDictationRevealed: (dictationRevealed) => set({ dictationRevealed }),
    setPeekingSpoiler: (peekingSpoiler) => set({ peekingSpoiler }),
    setRecorderPhase: (recorderPhase) => set({ recorderPhase }),
    setOpenedFromLearning: (openedFromLearning) => set({ openedFromLearning }),
    toggle: () => set((state) => ({ visible: !state.visible })),
}));

export default usePracticePanel;
