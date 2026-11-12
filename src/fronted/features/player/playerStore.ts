/**
 * 管理播放器的核心状态、播放控制、字幕定位和句子级跳转能力。
 */
import { create } from 'zustand';
import type { Sentence } from '@/common/types/SentenceC';
import { type SrtTender, SrtTenderImpl } from '@/fronted/features/player/lib/SrtTender';
import StrUtil from '@/common/utils/str-util';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import { useTrainingModeStore } from '@/fronted/features/player/trainingStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import { padPracticeClipRange } from '@/fronted/features/player/lib/practice-clip-range';
import {
    findSentenceBlock,
    groupSentencesIntoBlocks,
    type SentenceBlock,
} from '@/fronted/features/player/lib/sentence-grouping';
import {
  clearSentenceEndModes,
  enableSentenceEndMode,
  resolveSentenceEndStage,
  type SentenceEndBooleanMode,
} from '@/fronted/features/player/lib/sentence-end-mode';

/**
 * seek 请求：目标时间与是否继续播放的意图。
 */
export type SeekRequest = {
  /** 目标时间（秒）。 */
  time: number;
  /** 是否在 seek 后继续播放；缺省视为 true，false 表示保持暂停。 */
  play?: boolean;
  /** 请求序号：由 store 生成，PlayerEngine 在 seeked 时原样回传，用于丢弃过期落点。 */
  requestId?: number;
};

/**
 * seek 动作：可直接传目标请求，或传函数形式基于上一次 seek 计算。
 */
export type SeekAction =
    | SeekRequest
    | ((prev: SeekRequest) => SeekRequest);
type Range = { start: number; end: number };

/**
 * 瞬态播放计划：在锚定句子的播放区间上连续播放固定遍数，完成后按"跳过句间空隙"开关
 * 决定立即跳下一句还是自然播放过渡。用于"本句 ×N 后下一句""递进倍速精听"等组合动作；
 * 执行期间覆盖一切全局模式，用户手动跳转（currentSentence 与锚点不符）即视为放弃计划并回归全局模式。
 */
type TransientPlan = {
    /** 锚定句 key（fileHash-index）；currentSentence 与之不符时计划作废。 */
    anchorKey: string;
    /** 锚定句：循环 seek 时作为高亮目标（虚拟组时为组内第一句）。 */
    anchor: Sentence;
    /** 循环区间：单句为该句区间，虚拟组为组整体区间。 */
    range: Range;
    /** 总播放遍数。 */
    loopTotal: number;
    /** 已完成遍数（0 表示正在播放第 1 遍）。 */
    loopDone: number;
    /** 每一遍的倍速（下标 = 遍数）；缺省表示全程沿用当前倍速。 */
    rates?: number[];
    /** 计划开始前的倍速，计划结束/作废时恢复。 */
    prevRate: number;
    /** 遍数已完成、未跳过句间空隙：等待自然播放进入下一句后再续开新一轮。 */
    completed?: boolean;
};

/**
 * seek 落点后的高亮锁宽限：seeked 到达后仍允许目标句保持高亮的时长。
 * 用于覆盖"目标时间恰在两句边界、getByTime 可能回退到上一句"的一个采样周期。
 */
const LOCK_GRACE_MS = 250;

interface TailPreviewState {
  active: boolean;
  untilTs: number;
  returnTarget: Sentence | null;
  /** 进入预览前的播放意图：预览必须起播才能听到尾部，结束后按此恢复（暂停中校准不破坏暂停态）。 */
  resumePlaying: boolean;
}

interface TimeOverrideState {
  active: boolean;
  time: number;
}

interface CurrentLockState {
  active: boolean;
  untilTs: number;
  key: string | null; // 锁定的句子 key（用于调试/核对），不参与逻辑判断
}

interface InternalState {
  exactPlayTime: number;
  onPlaySeekTime: number | null;
  /**
   * 是否有 seek 尚未落地。
   *
   * 由 seek 请求置位、由 PlayerEngine 的 seeked 事件（或超时兜底）清除；
   * 期间 onTimeUpdate 不做任何句末判定，避免把旧播放位置当成新状态。
   */
  seekInFlight: boolean;
  tailPreview: TailPreviewState | null;
  /** seek 在途期间把有效时间钉在目标值；落点到达后立即释放，由真实播放时间接管。 */
  timeOverride: TimeOverrideState | null;
  currentLock: CurrentLockState | null;
  /** 瞬态播放计划；非空时 onTimeUpdate 优先按计划驱动。 */
  transientPlan: TransientPlan | null;

  // 新增：只读选择器的索引缓存
  indexing: IndexingCache | null;
}

// 高效只读选择器所需：一次性构建 key -> position 与 index -> position 的索引缓存
type IndexingCache = {
  posMap: Map<string, number>;
  // 若 index 在当前上下文中唯一（单文件字幕），可直接 O(1) 跳转
  indexPos: Map<number, number>;
  count: number;
};

type NavUnit =
  | { type: 'sentence'; s: Sentence }
  | { type: 'vg'; sentences: Sentence[]; repr: Sentence };

interface VirtualGroupState {
  active: boolean;
  sentences: Sentence[];
}

/**
 * 播放器核心状态：媒体源、播放态、字幕定位与句子级跳转能力。
 */
interface PlayerState {
  // 媒体源与基础播放态
  /** 当前媒体源路径（null 表示无源）。 */
  src: string | null;
  /** 期望播放状态（用户意图）；实际播放由 PlayerEngine 驱动。 */
  playing: boolean;
  muted: boolean;
  volume: number;
  duration: number;
  playbackRate: number;
  /** 最近一次 seek 请求（含播放意图）。 */
  seekTime: SeekRequest;

  /** 播放请求计数：每次显式请求播放 +1，供 PlayerEngine 强制执行原生 play()；source 级计数，切换源时重置。 */
  playRequestId: number;
  /** 最近一次"解码失败/格式不支持"类媒体错误码（MediaError code）；切换源时重置，null 表示无此类错误。 */
  mediaErrorCode: number | null;
  /** 看门狗判定播放卡死的次数：每次判定 +1，切换源时重置；UI 据此弹出卡死提示（同 id toast 不叠加）。 */
  playbackStallCount: number;

  // 模式
  autoPause: boolean;
  singleRepeat: boolean;
  /** 悬停临时单句循环：鼠标悬停主字幕胶囊区期间生效，离开即还原，不改动用户既有的句末模式。 */
  hoverRepeat: boolean;

  // 训练模式（组合播放行为）
  /** 影子跟读：句末暂停留白（时长按本句时长自适应），留白结束后按"跳过句间空隙"开关直跳下一句或自然过渡。 */
  shadowing: boolean;
  /** 影子跟读留白暂停状态（若在留白倒计时中，包含总时长与结束时间戳，用于 UI 倒计时环等展现） */
  shadowingPause: { durationMs: number; untilTs: number } | null;
  /** 常开的逐句循环模式：每句连播 N 遍后自动下一句（rates 为每遍倍速表）；null 表示关闭。 */
  sentenceLoop: { times: number; rates?: number[]; prevRate: number } | null;
  /** 当前进行中的计划状态（已完成遍数、总遍数、每遍倍速等，供 UI 展示精细进度） */
  activePlan: { loopDone: number; loopTotal: number; rates?: number[] } | null;

  // 字幕
  srtTender: SrtTender<Sentence> | null;
  sentences: Sentence[];
  currentSentence: Sentence | null;

  // 虚拟组
  virtualGroup: VirtualGroupState;

  // 内部状态
  internal: InternalState;

  // 源与字幕
  setSource: (src: string | null) => void;
  loadSubtitles: (sentences: Sentence[], tender?: SrtTender<Sentence>) => void;
  clearSubtitles: () => void;

  // 播放控制
  play: () => void;
  pause: () => void;
  togglePlay: () => void;

  /**
   * 上报"解码失败/格式不支持"类媒体错误（由 PlayerEngine 调用）。
   * @param code MediaError 错误码
   */
  reportMediaError: (code: number) => void;

  /** 上报一次播放卡死判定（由 PlayerEngine 看门狗调用），计数递增通知 UI 弹提示。 */
  reportPlaybackStall: () => void;

  // 基础 seek（保留）：按时间立即匹配高亮（用于进度条等）
  seekTo: (seekTime: SeekAction) => void;

  // 新：带目标句的 seek，立即设定 currentSentence 并在落点到达后释放锁定
  seekToTarget: (opts: { time: number; target?: Sentence; play?: boolean }) => void;

  /**
   * 通知 store 一次 seek 已经落地（由 PlayerEngine 在原生 seeked 事件或超时兜底时调用）。
   *
   * 这是"请求时刻"与"落点时刻"之间唯一的同步点：调用后释放时间覆盖与在途标记，
   * 由真实播放时间接管高亮；目标锁定再保留一小段宽限后释放。
   *
   * @param actualTime 媒体元素的实际落点时间（秒）
   * @param requestId 发起该 seek 时请求携带的序号；与当前在途请求不一致时忽略（过期落点）
   */
  resolveSeek: (actualTime: number, requestId?: number) => void;

  /**
   * 练习片段受控播放：仅在 `[range.start, range.end]` 区间内试听当前练习单元，
   * 到达句尾时精确暂停并锁死 `currentSentence` 不滑向下一句；中断或结束时自动恢复原倍速。
   */
  playPracticeClip: (
    range: { start: number; end: number },
    target: Sentence,
    options?: { rate?: number; onEnded?: () => void },
  ) => void;
  /** 取消受控片段播放并恢复暂存倍速。 */
  clearPracticeClip: () => void;

  setDuration: (duration: number) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  cyclePlaybackRate: () => void;

  // 模式控制
  setAutoPause: (v: boolean) => void;
  setSingleRepeat: (v: boolean) => void;
  setHoverRepeat: (v: boolean) => void;

  // 训练模式控制
  setShadowing: (v: boolean) => void;
  /** 开启/关闭常开逐句循环模式（每句 ×N 后自动下一句）；传 null 关闭并恢复倍速。 */
  setSentenceLoop: (config: { times: number; rates?: number[] } | null) => void;

  // 时间同步
  updateExactPlayTime: (currentTime: number) => void;
  getExactPlayTime: () => number;

  // 范围辅助
  mapCurrentRange: () => Range;
  getVirtualGroupRange: () => Range | null;
  getLoopRange: () => Range;

  /**
   * 当前句所在的意群块（整句模式）。
   *
   * 供渲染层按块展示双语字幕；整句模式关闭、无字幕或当前句无所属块时返回 null。
   * 返回引用在块内移动时保持稳定，避免渲染层频繁重算。
   */
  getCurrentBlock: () => SentenceBlock | null;

  // 播放起点延迟（配合 autoPause）
  onPlaySeek: (time: number | null) => void;

  // 虚拟组
  setVirtualGroupBySentences: (ss: Sentence[]) => void;
  setVirtualGroupByIndexRange: (startIndex: number, endIndex: number) => void;
  clearVirtualGroup: () => void;

  // 高级 API —— 跳转/重复/调校
  nextSentence: (step?: number) => void;
  prevSentence: (step?: number) => void;
  gotoSentenceIndex: (index: number) => void;
  gotoSentence: (s: Sentence) => void;
  repeatCurrent: (options?: { loop?: boolean; play?: boolean }) => void;
  /**
   * 清除时间轴调整。
   *
   * @param sentence 目标句；缺省为当前句。文稿里逐行复位时必须传句，
   *                 否则会复位用户正在看的那一句而不是他点的那一句。
   */
  clearAdjust: (sentence?: Sentence) => Promise<void>;
  seekToCurrentStart: () => void;
  seekToCurrentEnd: (epsilon?: number) => void;

  adjustCurrentBegin: (deltaSeconds: number) => void;
  adjustCurrentEnd: (deltaSeconds: number, options?: { previewMs?: number }) => void;

  // 便捷别名
  bumpBegin: (deltaSeconds: number) => void;
  bumpEnd: (deltaSeconds: number) => void;

  // 只读选择器（高效）
  getFocusedSentencePublic: () => Sentence | null;
  getFocusedIndex: () => number;       // 0..count-1；无聚焦返回 -1
  getSentenceCount: () => number;      // 总句数
  isAtFirstSentence: () => boolean;
  isAtLastSentence: () => boolean;
  getFocusedLogicalIndex: () => number;   // 逻辑行索引（虚拟组压缩）
  getLogicalCount: () => number;          // 逻辑行数量
  isAtFirstLogical: () => boolean;
  isAtLastLogical: () => boolean;
}

// 模块内定时器（不放入 Zustand）
let currentLockTimer: ReturnType<typeof setTimeout> | null = null;
// seek 请求序号：每次请求 +1，PlayerEngine 在 seeked 时回传，用于丢弃过期落点
let seekRequestCounter = 0;
// 影子跟读：句末暂停后的自动下一句定时器
let shadowTimer: ReturnType<typeof setTimeout> | null = null;
// 影子跟读：已给过留白的句子 key；防止留白结束自然续播时，在句间空隙内再次触发暂停（手动跳转/切源/模式开关时重置）
let shadowedSentenceKey: string | null = null;
// 播放时间采样间隔的 EMA（毫秒）：前台 rAF ≈45ms，后台标签页退化为原生 timeupdate ≈250ms。
// 循环提前量按它动态放大，否则后台循环会在回跳前听到下一句开头（过冲 ≈ 采样粒度 × 倍速）。
let lastSampleTs = 0;
let sampleIntervalMs = 45;

/** 练习工坊单句/块试听的硬停区间约束。 */
interface ClipStopBound {
  start: number;
  end: number;
  anchor: Sentence;
  restoreRate: number | null;
  /** seek 落点进入区间后才允许按句尾截停；避免旧播放位置误触发。 */
  settled: boolean;
  onEnded?: () => void;
}
let clipStopBound: ClipStopBound | null = null;

export const usePlayer = create<PlayerState>((set, get) => {
  // 工具：句子 key
  const sentenceKey = (s: Sentence) => `${s.fileHash}-${s.index}`;

  // O(n) 快路径：若 sentences 已按 index 非递减，则直接线性构建
  const isNonDecreasingByIndex = (arr: Sentence[]) => {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i - 1].index > arr[i].index) return false;
    }
    return true;
  };

  // 构建索引缓存：key -> position、index -> position、总数
  const buildIndexingCache = (sentences: Sentence[]): IndexingCache => {
    const n = sentences.length;
    if (n === 0) return { posMap: new Map(), indexPos: new Map(), count: 0 };

    // 注意：posMap/indexPos 均以"当前 sentences 数组的位置"为准（不依赖排序结果）
    const posMap = new Map<string, number>();
    const indexPos = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const s = sentences[i];
      posMap.set(sentenceKey(s), i);
      // 假设 index 在当前上下文中唯一（单一文件/源）
      if (!indexPos.has(s.index)) {
        indexPos.set(s.index, i);
      }
    }
    return { posMap, indexPos, count: n };
  };

  // 覆盖某个句子（根据 key）
  const patchSentenceInStore = (updated: Sentence) => {
    const keyU = sentenceKey(updated);
    set((prev) => {
      const pos = prev.internal.indexing?.posMap.get(keyU);
      if (pos === undefined) {
        // 兜底：退化为 O(n) 替换
        const sentences = prev.sentences.map((s) => sentenceKey(s) === keyU ? updated : s);
        const isCurrent = prev.currentSentence && sentenceKey(prev.currentSentence) === keyU;
        return { sentences, currentSentence: isCurrent ? updated : prev.currentSentence };
      }
      const sentences = prev.sentences.slice();
      sentences[pos] = updated;
      const isCurrent = prev.currentSentence && sentenceKey(prev.currentSentence) === keyU;
      return { sentences, currentSentence: isCurrent ? updated : prev.currentSentence };
    });
    // 循环计划进行中调整锚点句边界：同步更新计划区间，
    // 否则本遍循环仍按旧边界回跳（新句尾被提前截停或旧句尾多播一段）。
    const plan = get().internal.transientPlan;
    if (plan?.anchorKey === keyU) {
      const { range } = resolvePlanRange(get().currentSentence ?? updated);
      set((prev) => ({
        internal: {
          ...prev.internal,
          transientPlan: prev.internal.transientPlan ? { ...prev.internal.transientPlan, range } : null,
        }
      }));
    }
  };

  /**
   * 按播放时间挑选应高亮的句子。
   * @returns 该时间所在的句子；无有效进度（含 0/NaN）或查找失败时退回第一句；无句子时返回 null
   */
  const pickSentenceAtTime = (srt: SrtTender<Sentence>, list: Sentence[], time: number): Sentence | null => {
    if (list.length === 0) return null;
    if (time > 0) {
      try {
        return srt.getByTime(time) ?? list[0];
      } catch {
        return list[0];
      }
    }
    return list[0];
  };

  // 多句范围
  const calcRangeForSentences = (srt: SrtTender<Sentence>, arr: Sentence[]): Range => {
    if (!arr || arr.length === 0) return { start: 0, end: 0 };
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const s of arr) {
      const r = srt.mapSeekTime(s);
      if (r.start < start) start = r.start;
      if (r.end > end) end = r.end;
    }
    if (!isFinite(start)) start = 0;
    return { start, end };
  };

  /** 意群归并结果的引用缓存：loadSubtitles 换入新 sentences 数组时自动失效重建。 */
  let sentenceBlocksCache: { source: Sentence[]; blocks: SentenceBlock[] } | null = null;
  const getSentenceBlocks = (sentences: Sentence[]): SentenceBlock[] => {
    if (sentenceBlocksCache?.source === sentences) {
      return sentenceBlocksCache.blocks;
    }
    const blocks = groupSentencesIntoBlocks(sentences);
    sentenceBlocksCache = { source: sentences, blocks };
    return blocks;
  };

  /**
   * 当前句所在的意群块。
   *
   * 无字幕或当前句不在任何块内时返回 null，调用方回退到行级行为。
   * 返回的是缓存中的块对象（引用稳定）：当前句在块内移动不会产生新引用。
   */
  const getCurrentBlock = (): SentenceBlock | null => {
    const { sentences, currentSentence } = get();
    if (sentences.length === 0) {
      return null;
    }
    return findSentenceBlock(getSentenceBlocks(sentences), currentSentence);
  };

  // 清理尾部预览
  const clearTailPreview = () => {
    set((prev) => ({ internal: { ...prev.internal, tailPreview: null } }));
  };

  // 清除影子跟读定时器（手动播放/暂停/seek 均取消待触发的自动下一句）
  const clearShadowTimer = () => {
    if (shadowTimer) {
      clearTimeout(shadowTimer);
      shadowTimer = null;
    }
    if (get().shadowingPause) {
      set({ shadowingPause: null });
    }
  };

  const clearClipStopBound = (restoreRate = true) => {
    const activeBound = clipStopBound;
    clipStopBound = null;
    if (restoreRate && activeBound && activeBound.restoreRate !== null && get().playbackRate !== activeBound.restoreRate) {
      set({ playbackRate: activeBound.restoreRate });
    }
  };

  const applyTargetedSeek = ({
    time,
    target,
    play = true,
  }: {
    time: number;
    target?: Sentence;
    play?: boolean;
  }) => {
    clearShadowTimer();
    shadowedSentenceKey = null;
    const requestId = ++seekRequestCounter;
    set((prev) => ({
      playing: play,
      playRequestId: play ? prev.playRequestId + 1 : prev.playRequestId,
      seekTime: { time, play, requestId },
      currentSentence: target ?? prev.currentSentence,
      internal: {
        ...prev.internal,
        onPlaySeekTime: null,
        seekInFlight: true,
      },
    }));
    pinSeekTime(time);
    activateCurrentLock(target);
  };

  /**
   * 清除瞬态播放计划。
   * @param restoreRate 是否恢复计划开始前的倍速（默认恢复）
   */
  const clearTransientPlan = (restoreRate = true) => {
    const plan = get().internal.transientPlan;
    if (!plan) return;
    if (restoreRate && plan.prevRate !== get().playbackRate) {
      set({ playbackRate: plan.prevRate });
    }
    set((prev) => ({
      activePlan: null,
      internal: { ...prev.internal, transientPlan: null }
    }));
  };

  /**
   * 关闭常开逐句循环模式并恢复倍速。
   * 计划可能已被 seek/切源清除（倍速残留），因此除清除计划外再按模式基准倍速兜底恢复。
   */
  const clearSentenceLoopMode = () => {
    const mode = get().sentenceLoop;
    if (!mode) return;
    clearTransientPlan();
    if (get().playbackRate !== mode.prevRate) {
      set({ playbackRate: mode.prevRate });
    }
    set({ sentenceLoop: null });
  };

  /**
   * 互斥地启用一个布尔句末模式（自动暂停 / 单句循环 / 影子跟读）。
   *
   * 句末模式同一时刻只能有一个生效，这是本 store 的不变量。此前每个 setter 各自
   * 罗列「把别人置 false」，`repeatCurrent` 这类旁路入口就会漏掉，留下两个模式同时为真。
   * 现在统一从这里写入，规则只存在一处。
   *
   * @param mode 目标模式。
   */
  const applyBooleanSentenceMode = (mode: SentenceEndBooleanMode) => {
    clearSentenceLoopMode();
    // 模式切换可能关掉 shadowing（互斥），此时影子留白与定时器必须一并撤除：
    // 否则残留的 shadowingPause/shadowTimer 构成 {shadowing:false, 留白非null, 定时器活}
    // 的非法组合态，UI 倒计时条会继续空转。
    clearShadowTimer();
    shadowedSentenceKey = null;
    // 显式选择优先：任何持久模式的切换都取消悬停临时循环
    set({ ...enableSentenceEndMode(mode), hoverRepeat: false });
  };

  /**
   * 获取相对当前聚焦句偏移 offset 个的导航单元及其播放区间（虚拟组视为一个单元）。
   * @param offset 偏移量（1 = 下一单元，-1 = 上一单元）
   * @returns 目标单元与区间；越界或无法定位时返回 null
   */
  const getNavUnitAtOffset = (offset: number): { unit: NavUnit; range: Range } | null => {
    const { srtTender } = get();
    if (!srtTender) return null;
    const units = buildNavUnits();
    const pos = findFocusedNavIndex();
    if (pos < 0) return null;
    const idx = pos + offset;
    if (idx < 0 || idx >= units.length) return null;
    const unit = units[idx];
    const range = unit.type === 'sentence'
      ? srtTender.mapSeekTime(unit.s)
      : (get().getVirtualGroupRange() ?? srtTender.mapSeekTime(unit.repr));
    return { unit, range };
  };

  // 取导航单元的 seek 目标（虚拟组用代表句）
  const navUnitTarget = (unit: NavUnit): Sentence => unit.type === 'sentence' ? unit.s : unit.repr;

  /**
   * 在 seek 在途期间把有效时间钉在目标值。
   *
   * 这里不设过期时间：覆盖的释放完全由落点事件（`resolveSeek`）决定，
   * 避免"从请求时刻起算 500ms"导致落点后窗口缩水。
   */
  const pinSeekTime = (time: number) => {
    set((prev) => ({
      internal: {
        ...prev.internal,
        exactPlayTime: time,
        timeOverride: { active: true, time },
      }
    }));
  };

  /**
   * 设定"当前句锁定"：禁止按时间回写 currentSentence。
   *
   * 用于 seek 时不在请求时刻计时，而是在落点到达后由 `releaseCurrentLock` 释放；
   * 影子跟读等非 seek 场景可传入 `ms` 直接指定锁定时长。
   * 未指定目标句时（普通进度条拖动）不锁定，落点即可按真实时间回写。
   */
  const activateCurrentLock = (target: Sentence | undefined, ms?: number) => {
    if (currentLockTimer) {
      clearTimeout(currentLockTimer);
      currentLockTimer = null;
    }
    set((prev) => ({
      currentSentence: target ?? prev.currentSentence,
      internal: {
        ...prev.internal,
        currentLock: target
          ? {
              active: true,
              untilTs: ms === undefined ? Number.POSITIVE_INFINITY : Date.now() + ms,
              key: sentenceKey(target),
            }
          : null
      }
    }));
    if (target && ms !== undefined) {
      currentLockTimer = setTimeout(() => {
        set((prev) => ({
          internal: { ...prev.internal, currentLock: null }
        }));
        currentLockTimer = null;
      }, ms);
    }
  };

  // 落点到达后再保留一小段高亮锁，覆盖两句边界处的查询歧义
  const releaseCurrentLock = (ms = LOCK_GRACE_MS) => {
    if (currentLockTimer) {
      clearTimeout(currentLockTimer);
    }
    set((prev) => ({
      internal: {
        ...prev.internal,
        currentLock: prev.internal.currentLock
          ? { ...prev.internal.currentLock, untilTs: Date.now() + ms }
          : null
      }
    }));
    currentLockTimer = setTimeout(() => {
      set((prev) => ({
        internal: { ...prev.internal, currentLock: null }
      }));
      currentLockTimer = null;
    }, ms);
  };

  // 有效时间：seek 在途时优先使用目标时间
  const getEffectiveTime = (): number => {
    const { internal } = get();
    const ov = internal.timeOverride;
    if (ov?.active) {
      return ov.time;
    }
    return internal.exactPlayTime;
  };

  const buildNavUnits = (): NavUnit[] => {
    const { sentences, virtualGroup } = get();
    if (sentences.length === 0) return [];

    // 避免不必要的排序：若本身已按 index 非递减，直接使用原数组
    const ordered = isNonDecreasingByIndex(sentences)
      ? sentences
      : [...sentences].sort((a, b) => a.index - b.index);
    if (!virtualGroup.active || virtualGroup.sentences.length === 0) {
      // 意群块整体作为一个导航单位（复用 vg 语义，跳转/循环以块为单位）；
      // 用户手动拖选的虚拟组优先级更高，激活时维持既有行为。
      const blocks = getSentenceBlocks(ordered);
      if (blocks.length > 0) {
        return blocks.map((block) => ({ type: 'vg' as const, sentences: block.sentences, repr: block.repr }));
      }
      return ordered.map((s) => ({ type: 'sentence' as const, s }));
    }

    const vgSet = new Set(virtualGroup.sentences.map((s) => sentenceKey(s)));
    const groupAll = ordered.filter((s) => vgSet.has(sentenceKey(s)));
    const fallbackRepr = virtualGroup.sentences.slice().sort((a, b) => a.index - b.index)[0];
    const repr = groupAll[0] ?? fallbackRepr;
    const units: NavUnit[] = [];
    let placed = false;

    for (const s of ordered) {
      if (vgSet.has(sentenceKey(s))) {
        if (!placed && repr) {
          units.push({ type: 'vg', sentences: groupAll.length > 0 ? groupAll : [repr], repr });
          placed = true;
        }
        continue;
      }
      units.push({ type: 'sentence', s });
    }

    if (!placed && repr) {
      units.push({ type: 'vg', sentences: groupAll.length > 0 ? groupAll : [repr], repr });
    }

    return units;
  };

  const findFocusedNavIndex = (): number => {
    const units = buildNavUnits();
    if (units.length === 0) return -1;
    const focus = getFocusedSentence();
    if (!focus) return -1;
    const key = sentenceKey(focus);
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (unit.type === 'sentence') {
        if (sentenceKey(unit.s) === key) return i;
      } else if (unit.sentences.some((s) => sentenceKey(s) === key)) {
        return i;
      }
    }
    return -1;
  };

  const isFocusInVirtualGroup = (): boolean => {
    const idx = findFocusedNavIndex();
    if (idx < 0) return false;
    const units = buildNavUnits();
    return units[idx]?.type === 'vg';
  };

  const getLogicalCountInternal = (): number => buildNavUnits().length;
  const getFocusedLogicalIndexInternal = (): number => findFocusedNavIndex();

  /**
   * 循环类模式的句末判定：用一个采样周期的提前量抵消 rAF 45ms 采样带来的"听到下一句开头"的过冲。
   * 仅用于需要回跳的模式（瞬态计划 / 单句循环 / 悬停循环）；autoPause 与影跟读仍以句尾为准，避免吞字。
   *
   * 区间下限守卫：循环 seek 的落点是句首 start。当句长不超过提前量（畸形 SRT
   * 的几十毫秒行，或高倍速下的短句）时，落点自身就满足「到达句末」判定，
   * 每个采样周期都会再触发一次 seek——约 20 次/秒的忙循环。此时退回严格
   * 判定 `time >= end`，只有真正越过句末才结算回跳。
   */
  const LOOP_END_EPSILON_SEC = 0.06;
  const reachedLoopEnd = (time: number, start: number, end: number, rate: number): boolean => {
    // 提前量 = max(基础提前量, 采样间隔 × 0.75)：前台 rAF 45ms 时 0.06s 生效（行为不变）；
    // 后台 timeupdate ~250ms 时提前量放大到 ~0.19s×倍速，把过冲从最多 0.25s×倍速压到 ~0.06s×倍速。
    const lead = rate * Math.max(LOOP_END_EPSILON_SEC, Math.min((sampleIntervalMs / 1000) * 0.75, 0.2));
    if (end - start <= lead) {
      return time >= end;
    }
    return time >= end - lead;
  };

  /**
   * 句末后处理：影子跟读留白 / 跳过句间空隙。
   * 返回 true 表示本轮已产生暂停或跳转，不再继续回写高亮。
   */
  const handleSentenceTail = (skipGap: boolean): boolean => {
    const state = get();
    const { playing, currentSentence, shadowing, srtTender } = state;
    if (!playing || !currentSentence || !srtTender) return false;
    const effectiveTime = getEffectiveTime();
    const { start, end } = srtTender.mapSeekTime(currentSentence);
    if (effectiveTime <= end) return false;

    if (shadowing && shadowedSentenceKey !== sentenceKey(currentSentence)) {
      // 影子跟读：原地停在句尾暂停留白（供跟读），留白结束后再过渡到下一句续播
      state.pause();
      clearShadowTimer();
      shadowedSentenceKey = sentenceKey(currentSentence);
      // 留白时长按本句时长 × 留白倍率（默认 1.5），钳制在 0.5~15s
      const ratio = useTrainingModeStore.getState().config.shadowingRatio || 1.5;
      const pauseMs = Math.min(Math.max((end - start) * ratio * 1000, 500), 15000);
      set({ shadowingPause: { durationMs: pauseMs, untilTs: Date.now() + pauseMs } });
      // 暂停生效前播放头可能滑入下一句区间并触发一次时间回写，把高亮锁到留白结束以防字幕提前跳句
      activateCurrentLock(currentSentence, pauseMs + 1500);
      shadowTimer = setTimeout(() => {
        shadowTimer = null;
        set({ shadowingPause: null });
        const s = get();
        if (s.shadowing && !s.playing) {
          if (useTrainingModeStore.getState().skipGap) {
            // 跳过空隙：直接跳到下一句开头并继续播放
            s.nextSentence();
          } else {
            // 不跳过空隙：原地恢复播放，让句间空隙自然播过去进入下一句
            // （不走 startPlayback，避免 rewindOnResume 把播放头退回本句开头）
            set((prev) => ({ playing: true, playRequestId: prev.playRequestId + 1 }));
          }
        }
      }, pauseMs);
      return true;
    }

    if (skipGap) {
      // 正常连播但跳过空隙：已过当前句结尾且尚未到达下一句开头时，直接 seek 过去
      const next = getNavUnitAtOffset(1);
      if (next && effectiveTime < next.range.start) {
        get().seekToTarget({ time: next.range.start, target: navUnitTarget(next.unit) });
        return true;
      }
    }
    return false;
  };

  // 时间驱动：尾部预览 → 练习片段 → 瞬态播放计划 → 句末模式 → 正常回写
  const onTimeUpdate = () => {
    const state = get();
    const { playing, currentSentence, srtTender, sentenceLoop } = state;
    // 跳过句间空隙属于持久化的训练偏好，每轮实时读取以保证弹窗/菜单改动即时生效
    const skipGap = useTrainingModeStore.getState().skipGap;
    const { seekInFlight, onPlaySeekTime, tailPreview, currentLock, transientPlan } = state.internal;

    // 1) 尾部预览优先
    if (tailPreview?.active) {
      const now = Date.now();
      if (now >= tailPreview.untilTs) {
        set((prev) => ({
          internal: { ...prev.internal, tailPreview: null }
        }));
        // 统一：预览结束后回到目标句（或当前句）开头，并恢复预览前的播放意图
        // （暂停中校准句尾 → 预览试听 → 回到暂停态，而不是永远被预览拉成播放态）
        const target = tailPreview.returnTarget ?? currentSentence ?? null;
        let startTime = 0;
        if (srtTender && target) {
          startTime = srtTender.mapSeekTime(target).start;
        }
        state.seekToTarget({ time: startTime, target: target ?? undefined, play: tailPreview.resumePlaying });
      }
      return;
    }

    // 1.5) 练习工坊受控试听区间：严格用真实播放时间截断在句末
    if (clipStopBound) {
      if (!playing) {
        return;
      }
      const { start, end, anchor } = clipStopBound;
      // 落点未到达前不做任何截停判定：此时的播放时间仍属于 seek 之前的位置
      if (seekInFlight) {
        return;
      }
      const t = state.internal.exactPlayTime;
      if (!clipStopBound.settled) {
        if (t >= start - 0.25 && t < end) {
          clipStopBound.settled = true;
        } else {
          return;
        }
      }
      if (clipStopBound.settled && t >= end) {
        const onEnded = clipStopBound.onEnded;
        clearClipStopBound(true);
        set((prev) => ({
          playing: false,
          currentSentence: anchor,
          internal: { ...prev.internal, onPlaySeekTime: start },
        }));
        onEnded?.();
        return;
      }
      if (currentSentence !== anchor) {
        set({ currentSentence: anchor });
      }
      return;
    }

    if (!srtTender) return;
    // seek 在途 / 自动暂停待续播：播放时间尚不代表"本句已播完"，不做任何句末判定
    if (seekInFlight || onPlaySeekTime !== null) return;

    const effectiveTime = getEffectiveTime();
    const rate = state.playbackRate || 1;

    // 2) 瞬态播放计划：覆盖一切全局模式
    if (transientPlan) {
      // 遍数已完成且不跳过空隙：等待自然播放进入下一句再续开新一轮
      // （等待期间计划分支会拦截常规回写，这里按时间回写高亮）
      if (transientPlan.completed) {
        const at = srtTender.getByTime(effectiveTime);
        // 末句逃逸：getByTime 首尾钳制会让锚点之后的采样永远返回锚点句，
        // 「进入下一句」的判定在最后一句永不成立，completed 计划会永久滞留并
        // 拦截全部句末模式。播放头越过锚点句末（留出句尾缓冲）即视为空隙已过。
        const gapPassed = (at && sentenceKey(at) !== transientPlan.anchorKey)
          || effectiveTime >= transientPlan.range.end + 0.2;
        if (gapPassed) {
          set({ currentSentence: at });
          if (sentenceLoop) {
            beginSentencePlan(sentenceLoop, true);
          } else {
            clearTransientPlan();
          }
        } else if (skipGap && sentenceLoop) {
          // 等待期间打开了跳过空隙：补一次直跳下一句并续开一轮
          set((prev) => ({
            activePlan: null,
            internal: { ...prev.internal, transientPlan: null }
          }));
          get().nextSentence();
          beginSentencePlan(sentenceLoop, false);
        }
        return;
      }
      if (currentSentence && sentenceKey(currentSentence) !== transientPlan.anchorKey) {
        // 锚点句已变化（用户手动跳转）：常开模式为新高亮句续开一轮，否则放弃计划
        if (sentenceLoop) {
          beginSentencePlan(sentenceLoop, true);
        } else {
          clearTransientPlan();
        }
        return;
      }
      if (playing && reachedLoopEnd(effectiveTime, transientPlan.range.start, transientPlan.range.end, rate)) {
        const done = transientPlan.loopDone + 1;
        if (done >= transientPlan.loopTotal) {
          if (sentenceLoop && !skipGap) {
            // 不跳过空隙：标记计划完成，恢复基准倍速后让空隙自然播过去，进入下一句再续开新一轮
            if (transientPlan.prevRate !== get().playbackRate) {
              set({ playbackRate: transientPlan.prevRate });
            }
            set((prev) => ({
              activePlan: null,
              internal: { ...prev.internal, transientPlan: { ...transientPlan, loopDone: done, completed: true } }
            }));
          } else {
            // 跳过空隙（或一次性计划）：直接跳下一句开头；常开模式续开一轮，否则恢复倍速
            set((prev) => ({
              activePlan: null,
              internal: { ...prev.internal, transientPlan: null }
            }));
            get().nextSentence();
            if (sentenceLoop) {
              beginSentencePlan(sentenceLoop, false);
            } else if (transientPlan.prevRate !== get().playbackRate) {
              set({ playbackRate: transientPlan.prevRate });
            }
          }
        } else {
          set((prev) => ({
            activePlan: {
              loopDone: done,
              loopTotal: transientPlan.loopTotal,
              rates: transientPlan.rates
            },
            internal: { ...prev.internal, transientPlan: { ...transientPlan, loopDone: done } }
          }));
          const plan = get().internal.transientPlan;
          if (plan?.rates && plan.rates[done] !== undefined) {
            set({ playbackRate: plan.rates[done] });
          }
          get().seekToTarget({ time: transientPlan.range.start, target: transientPlan.anchor });
        }
      }
      return;
    }

    // 3) 句末模式：优先级由 sentence-end-mode 单点裁决，执行分支只负责各自副作用
    const stage = resolveSentenceEndStage(
      {
        autoPause: state.autoPause,
        singleRepeat: state.singleRepeat,
        hoverRepeat: state.hoverRepeat,
        shadowing: state.shadowing,
      },
      sentenceLoop !== null,
    );
    const { virtualGroup } = state;

    switch (stage) {
      // 常开逐句循环：模式开着但没有进行中的计划（切源/进度条拖动后清除），为当前句补开一轮
      case 'sentenceLoop': {
        if (playing) {
          beginSentencePlan(sentenceLoop!, true);
          return;
        }
        break;
      }
      // AutoPause（整句模式在意群末尾暂停，否则基于当前句）
      case 'autoPause': {
        if (currentSentence && playing) {
          const block = getCurrentBlock();
          const { start, end } = block
            ? calcRangeForSentences(srtTender, block.sentences)
            : srtTender.mapSeekTime(currentSentence);
          if (effectiveTime > end) {
            state.pause();
            state.onPlaySeek(start);
          }
        }
        return;
      }
      // SingleRepeat：组优先（单句冻结，虚拟组/意群块内允许高亮随时间移动）
      case 'singleRepeat': {
        if (playing) {
          const { start, end } = state.getLoopRange();
          const focusInGroup = isFocusInVirtualGroup();
          const block = getCurrentBlock();
          const focusInBlock = block !== null;
          if (reachedLoopEnd(effectiveTime, start, end, rate)) {
            if (focusInGroup && virtualGroup.active && virtualGroup.sentences.length > 0) {
              const first = virtualGroup.sentences.slice().sort((a, b) => a.index - b.index)[0];
              state.seekToTarget({ time: start, target: first });
            } else if (focusInBlock) {
              // 整句模式：回到意群块首句，块内高亮随播放自然流动
              state.seekToTarget({ time: start, target: block!.repr });
            } else {
              state.seekToTarget({ time: start, target: currentSentence ?? undefined });
            }
          }
          // 仅在焦点位于虚拟组内时：允许高亮随时间在组内流动；单句循环保持冻结
          if (focusInGroup && virtualGroup.active && virtualGroup.sentences.length > 0) {
            const vgSet = new Set(virtualGroup.sentences.map((s) => `${s.fileHash}-${s.index}`));
            const next = srtTender.getByTime(effectiveTime);
            const nextKey = `${next.fileHash}-${next.index}`;
            if (vgSet.has(nextKey) && next !== currentSentence) {
              set({ currentSentence: next });
            }
          } else if (focusInBlock && block) {
            const next = srtTender.getByTime(effectiveTime);
            if (block.sentences.some((s) => s.key === next.key) && next !== currentSentence) {
              set({ currentSentence: next });
            }
          }
        }
        return;
      }
      // 悬停临时单句循环：鼠标悬停主字幕胶囊区期间只循环当前句本身（不套用虚拟组）
      case 'hoverRepeat': {
        if (playing && currentSentence) {
          const { start, end } = srtTender.mapSeekTime(currentSentence);
          if (reachedLoopEnd(effectiveTime, start, end, rate)) {
            state.seekToTarget({ time: start, target: currentSentence });
          }
        }
        return;
      }
      // 影子跟读 / 正常播放：共享"句末后处理 + 跳过空隙 + 回写"路径
      case 'shadowing':
      case 'off':
      default: {
        if (handleSentenceTail(skipGap)) {
          return;
        }
        break;
      }
    }

    // 7) 正常模式：按时间回写 currentSentence（若当前未锁定）
    if (currentLock?.active && Date.now() < currentLock.untilTs) {
      // 锁定期内，不回写，保持 UI 高亮为用户刚选中的句子
      return;
    }
    const next = srtTender.getByTime(effectiveTime);
    if (next !== currentSentence) {
      set({ currentSentence: next });
    }
  };

  // 当前聚焦句（优先 currentSentence，否则按有效时间查找）
  const getFocusedSentence = (): Sentence | null => {
    const { currentSentence, srtTender } = get();
    if (currentSentence) return currentSentence;
    if (srtTender) {
      try {
        const s = srtTender.getByTime(getEffectiveTime());
        return s ?? null;
      } catch {
        return null;
      }
    }
    return null;
  };

  /**
   * 为当前聚焦句构建瞬态循环计划（虚拟组/意群块时以整组为循环单元）。
   * @param mode 常开的逐句循环配置（遍数、每遍倍速、基准倍速）
   * @param seekToStart 是否 seek 到循环区间开头（开启模式/续接新锚点句时需要；
   *                    句间续接时 nextSentence 已定位到下一句开头，传 false 避免重复 seek）
   */
  /**
   * 解析瞬态计划的循环单元与区间：虚拟组优先，其次意群块，最后单句。
   * beginSentencePlan 与 patchSentenceInStore（锚点句边界被调整时）共用，保证两处口径一致。
   */
  const resolvePlanRange = (focus: Sentence): { anchor: Sentence; range: Range } => {
    const { srtTender, virtualGroup } = get();
    if (!srtTender) return { anchor: focus, range: { start: 0, end: 0 } };
    let anchor = focus;
    let range = srtTender.mapSeekTime(focus);
    if (virtualGroup.active && virtualGroup.sentences.length > 0 && isFocusInVirtualGroup()) {
      const first = virtualGroup.sentences.slice().sort((a, b) => a.index - b.index)[0];
      if (first) {
        anchor = first;
        range = get().getVirtualGroupRange() ?? range;
      }
    } else {
      // 导航以意群块为单位，循环单元必须与导航一致：
      // 否则块首句循环 N 遍后就跳到下一块，块内其余行整段漏播。
      const block = getCurrentBlock();
      if (block) {
        anchor = block.repr;
        range = calcRangeForSentences(srtTender, block.sentences);
      }
    }
    return { anchor, range };
  };

  const beginSentencePlan = (mode: { times: number; rates?: number[]; prevRate: number }, seekToStart: boolean) => {
    const state = get();
    const { srtTender } = state;
    if (!srtTender) return;
    const focus = state.currentSentence ?? getFocusedSentence();
    if (!focus || mode.times < 1) return;

    const { anchor, range } = resolvePlanRange(focus);

    set((prev) => ({
      activePlan: {
        loopDone: 0,
        loopTotal: mode.times,
        rates: mode.rates
      },
      internal: { ...prev.internal, transientPlan: {
        anchorKey: sentenceKey(anchor),
        anchor,
        range,
        loopTotal: mode.times,
        loopDone: 0,
        rates: mode.rates,
        prevRate: mode.prevRate
      } }
    }));
    if (mode.rates?.[0] !== undefined) {
      set({ playbackRate: mode.rates[0] });
    }
    if (seekToStart) {
      get().seekToTarget({ time: range.start, target: anchor });
    }
  };

  /**
   * 统一的恢复播放入口：取消待触发的影子跟读自动下一句，并按 rewindOnResume 决定是否回退句首。
   */
  const startPlayback = () => {
    clearShadowTimer();
    const { onPlaySeekTime, exactPlayTime } = get().internal;
    if (onPlaySeekTime !== null) {
      get().seekToTarget({ time: onPlaySeekTime, target: get().currentSentence ?? undefined });
      return;
    }
    const { currentSentence, srtTender } = get();
    if (useTrainingModeStore.getState().rewindOnResume && currentSentence && srtTender) {
      const { start } = srtTender.mapSeekTime(currentSentence);
      // 已进入本句超过 0.3s 才回退，避免句首续播被误判为需要回退
      if (exactPlayTime > start + 0.3) {
        get().seekToTarget({ time: start, target: currentSentence });
        return;
      }
    }
    set((prev) => ({ playing: true, playRequestId: prev.playRequestId + 1 }));
  };

  return {
    // 初始
    src: null,
    playing: false,
    muted: false,
    volume: 1,
    duration: 0,
    playbackRate: 1,
    seekTime: { time: 0 },
    playRequestId: 0,
    mediaErrorCode: null,
    playbackStallCount: 0,

    autoPause: false,
    singleRepeat: false,
    hoverRepeat: false,

    shadowing: false,
    shadowingPause: null,
    sentenceLoop: null,
    activePlan: null,

    srtTender: null,
    sentences: [],
    currentSentence: null,

    virtualGroup: {
      active: false,
      sentences: []
    },

    internal: {
      exactPlayTime: 0,
      onPlaySeekTime: null,
      seekInFlight: false,
      tailPreview: null,
      timeOverride: null,
      currentLock: null,
      transientPlan: null,
      indexing: null // 新增
    },

    // 源与字幕
    setSource: (src) => {
      if (currentLockTimer) { clearTimeout(currentLockTimer); currentLockTimer = null; }
      clearShadowTimer();
      clearTransientPlan();
      clearClipStopBound(false);
      shadowedSentenceKey = null;
      set({
        src,
        playing: false,
        duration: 0,
        seekTime: { time: 0 },
        playRequestId: 0,
        mediaErrorCode: null,
        playbackStallCount: 0,
        shadowingPause: null,
        activePlan: null,
        // 旧视频的高亮句不能带进新视频：字幕异步解析完成前 UI 不得停留在旧句上
        currentSentence: null,
        virtualGroup: { active: false, sentences: [] },
        internal: {
          exactPlayTime: 0,
          onPlaySeekTime: null,
          seekInFlight: false,
          tailPreview: null,
          timeOverride: null,
          currentLock: null,
          transientPlan: null,
          indexing: null // 清理索引
        }
      });
    },

    loadSubtitles: (sentences, tender) => {
      clearTransientPlan();
      clearClipStopBound(false);
      // 与 clearSubtitles 对称：换字幕意味着影子留白契约同样作废，
      // 否则留白定时器到期回调会在新字幕上自动跳句/起播。
      clearShadowTimer();
      shadowedSentenceKey = null;
      // 换字幕/换视频意味着上一轮的 seek 契约全部作废，否则残留的在途标记会一直挡住时间驱动
      if (currentLockTimer) { clearTimeout(currentLockTimer); currentLockTimer = null; }
      const srt = tender ?? new SrtTenderImpl(sentences);
      const indexing = buildIndexingCache(sentences);

      // 如果当前已有播放进度且 srt 能找到对应句，保留当前播放位置对应的句子；否则默认使用第一句
      const targetCurrentSentence = pickSentenceAtTime(srt, sentences, get().internal.exactPlayTime);

      set((prev) => ({
        srtTender: srt,
        sentences,
        currentSentence: targetCurrentSentence,
        virtualGroup: { active: false, sentences: [] },
        internal: {
          ...prev.internal,
          seekInFlight: false,
          timeOverride: null,
          currentLock: null,
          indexing // 构建索引
        }
      }));
    },

    clearSubtitles: () => {
      clearTransientPlan();
      clearShadowTimer();
      clearClipStopBound(false);
      shadowedSentenceKey = null;
      set((prev) => ({
        srtTender: null,
        sentences: [],
        currentSentence: null,
        shadowingPause: null,
        activePlan: null,
        virtualGroup: { active: false, sentences: [] },
        internal: {
          ...prev.internal,
          indexing: null // 清理索引
        }
      }));
    },

    /**
     * 开始播放：统一走 startPlayback（处理延迟播放起点与回退句首）。
     */
    play: () => {
      startPlayback();
    },

    /**
     * 暂停播放：同时取消待触发的影子跟读自动下一句。
     */
    pause: () => {
      clearShadowTimer();
      clearClipStopBound(true);
      set({ playing: false });
    },

    /**
     * 切换播放/暂停：开启时走统一启动逻辑，关闭时取消影子跟读定时器。
     */
    togglePlay: () => {
      const next = !get().playing;
      if (next) {
        startPlayback();
      } else {
        clearShadowTimer();
        clearClipStopBound(true);
        set({ playing: false });
      }
    },

    // 相同错误码重复上报时值不变，订阅方不会重复触发
    reportMediaError: (code) => set({ mediaErrorCode: code }),

    reportPlaybackStall: () => set((s) => ({ playbackStallCount: s.playbackStallCount + 1 })),

    /**
     * 基础 seek：按时间匹配高亮，用于进度条拖动等通用场景。
     * @param seekTime 目标时间（可传函数形式读取上一次 seek）
     */
    /**
     * 基础 seek：按时间匹配高亮，用于进度条拖动等通用场景。
     *
     * 默认保持当前播放态：暂停中拖动进度条只移动播放头，不应突然起播。
     * 需要「seek 后起播」的入口（如首次加载定位到上次进度）显式传 `play: true`。
     *
     * @param seekTime 目标时间（可传函数形式读取上一次 seek）
     */
    seekTo: (seekTime) => {
      clearShadowTimer();
      clearTransientPlan();
      clearClipStopBound(true);
      shadowedSentenceKey = null;
      if (currentLockTimer) { clearTimeout(currentLockTimer); currentLockTimer = null; }
      const srtTender = get().srtTender;
      const currentSeek = get().seekTime;
      const next = typeof seekTime === 'function' ? seekTime(currentSeek) : seekTime;
      const wantPlay = next.play ?? get().playing;
      const requestId = ++seekRequestCounter;

      set((prev) => ({
        playing: wantPlay,
        playRequestId: wantPlay ? prev.playRequestId + 1 : prev.playRequestId,
        seekTime: { ...next, requestId },
        currentSentence: srtTender ? srtTender.getByTime(next.time) : prev.currentSentence,
        internal: {
          ...prev.internal,
          onPlaySeekTime: null,
          seekInFlight: true,
          currentLock: null
        }
      }));

      pinSeekTime(next.time);
    },

    /**
     * 带目标句的 seek：立即设定 currentSentence + 落点前的时间覆盖 + 高亮锁定（上一句/下一句/跳转推荐入口）。
     * @param time 目标时间（秒）
     * @param target 目标句子，用于高亮锁定
     * @param play 是否在 seek 后继续播放
     */
    seekToTarget: (opts) => {
      clearClipStopBound(true);
      applyTargetedSeek(opts);
    },

    playPracticeClip: (range, target, options) => {
      /*
        练习片段必须包含「完整的一句话」，而不是紧贴字幕边界。
        字幕边界是估算值，贴边起停会切掉首尾音——用户听到半截开头/被掐断的结尾，
        跟读与精听都没法进行。这里统一加首尾留白，且只放宽播放区间，
        不影响字幕高亮（高亮仍按原边界）。
      */
      const padded = padPracticeClipRange(range, get().duration);
      const safeStart = padded.start;
      const safeEnd = padded.end;
      const prevRestore = clipStopBound?.restoreRate ?? null;
      clearTransientPlan();
      clearTailPreview();
      // 连按慢速试听时沿用最初保存的正常倍速,避免恢复错基准
      const restoreRate = options?.rate !== undefined
        ? (prevRestore ?? get().playbackRate)
        : prevRestore;
      if (options?.rate !== undefined) {
        set({ playbackRate: options.rate });
      } else if (restoreRate !== null && get().playbackRate !== restoreRate) {
        set({ playbackRate: restoreRate });
      }
      clipStopBound = {
        start: safeStart,
        end: safeEnd,
        anchor: target,
        restoreRate: options?.rate !== undefined ? restoreRate : null,
        settled: false,
        onEnded: options?.onEnded,
      };
      // 立即按目标句高亮；是否能截停由 seek 落点结算（resolveSeek）决定，不依赖请求时刻的墙钟
      applyTargetedSeek({ time: safeStart, target, play: true });
    },

    /**
     * seek 落点结算：唯一的"请求 → 落地"同步点。
     *
     * 清除在途标记与时间覆盖，把真实播放时间写回 exactPlayTime；
     * 目标句锁定再保留一小段宽限，随后由时间回写接管。
     * 若落在进行中的练习片段内，则结算片段（此后才允许按句尾截停）。
     */
    resolveSeek: (actualTime, requestId) => {
      const state = get();
      const currentRequestId = state.seekTime?.requestId;
      // 过期落点（例如上一次 seek 的 seeked 迟到）：忽略，避免提前解除新一轮的覆盖。
      // 在途契约已不存在时（setSource 清空了 seekTime），带序号的迟到结算同样拒绝：
      // 它属于旧源/旧契约，不得把旧视频的落点写进新源。
      if (requestId !== undefined && requestId !== currentRequestId) {
        return;
      }
      const hadLock = state.internal.currentLock?.active === true;
      set((prev) => ({
        internal: {
          ...prev.internal,
          seekInFlight: false,
          timeOverride: null,
          exactPlayTime: actualTime,
        }
      }));
      if (clipStopBound && !clipStopBound.settled) {
        if (actualTime >= clipStopBound.start - 0.4 && actualTime <= clipStopBound.end + 0.05) {
          clipStopBound.settled = true;
        }
      }
      // 锁定中的目标句保持不变，宽限期结束后再交给时间回写；无锁定时立即按落点校正高亮
      if (hadLock) {
        releaseCurrentLock();
      } else {
        onTimeUpdate();
      }
    },

    clearPracticeClip: () => {
      clearClipStopBound(true);
    },

    setDuration: (duration) => set({ duration }),
    setMuted: (muted) => set({ muted }),
    setVolume: (volume) => set({ volume }),
    setPlaybackRate: (rate) => set({ playbackRate: rate }),
    cyclePlaybackRate: () => {
      const stack = useSetting.getState().setting('userSelect.playbackRateStack')
        .split(',')
        .map((v) => parseFloat(v))
        .filter((v) => !Number.isNaN(v));
      if (stack.length === 0) {
        return;
      }
      set((prev) => {
        const current = prev.playbackRate;
        const currentIdx = stack.indexOf(current) === -1 ? 0 : stack.indexOf(current);
        const nextIdx = (currentIdx + 1) % stack.length;
        return { playbackRate: stack[nextIdx] };
      });
    },

    // 模式控制（句末行为互斥：开启任一会关闭其他句末模式）
    /**
     * 句末自动暂停：本句播完暂停，续播从句首开始。
     * 开启时自动关闭其他句末模式（单句循环/影子跟读/逐句循环计划）。
     */
    setAutoPause: (v) => {
      if (!v) {
        set({ autoPause: false });
        return;
      }
      applyBooleanSentenceMode('autoPause');
    },
    /**
     * 单句循环：当前句（虚拟组为整组）无限循环。
     * 开启时自动关闭其他句末模式（句末暂停/影子跟读/逐句循环计划）。
     */
    setSingleRepeat: (v) => {
      if (!v) {
        set({ singleRepeat: false, hoverRepeat: false });
        return;
      }
      applyBooleanSentenceMode('singleRepeat');
    },
    /**
     * 悬停临时单句循环：鼠标悬停主字幕胶囊区期间临时循环当前句。
     * 只翻转本标志，不改动用户既有的句末模式；离开胶囊区时置回 false 即完整还原。
     * 用户在悬停期间显式切换任一句末模式时，由对应 setter 顺手清掉本标志（显式选择优先）。
     */
    setHoverRepeat: (v) => set({ hoverRepeat: v }),

    // 训练模式控制
    /**
     * 影子跟读：句末暂停留白后自动下一句。
     * 开启时自动关闭其他句末模式（单句循环/句末暂停/逐句循环计划）。
     */
    setShadowing: (v) => {
      shadowedSentenceKey = null;
      if (!v) {
        clearShadowTimer();
        set({ shadowing: false });
        return;
      }
      applyBooleanSentenceMode('shadowing');
    },

    /**
     * 开启/关闭常开逐句循环模式：开启时立即为当前句开启第一轮计划；
     * 关闭时取消进行中的计划并恢复模式开启前的倍速。
     * 开启时自动关闭其他句末模式（单句循环/句末暂停/影子跟读）。
     */
    setSentenceLoop: (config) => {
      clearTailPreview();
      clearShadowTimer();
      if (!config) {
        clearSentenceLoopMode();
        return;
      }
      if (config.times < 1) return;
      // 切换配置时保留最初开启前的倍速作为恢复基准
      const prevRate = get().sentenceLoop?.prevRate ?? get().playbackRate;
      set({
        ...clearSentenceEndModes(),
        sentenceLoop: { times: config.times, rates: config.rates, prevRate },
        hoverRepeat: false,
      });
      beginSentencePlan(get().sentenceLoop!, true);
    },

    // 时间同步
    updateExactPlayTime: (currentTime: number) => {
      // 记录采样间隔（EMA 平滑），供 reachedLoopEnd 的动态提前量感知前台/后台采样粒度
      const now = Date.now();
      if (lastSampleTs > 0) {
        const dt = now - lastSampleTs;
        if (dt > 0 && dt < 2000) {
          sampleIntervalMs = sampleIntervalMs * 0.7 + dt * 0.3;
        }
      }
      lastSampleTs = now;
      set((prev) => ({
        internal: { ...prev.internal, exactPlayTime: currentTime }
      }));
      setTimeout(onTimeUpdate, 0);
    },

    getExactPlayTime: () => get().internal.exactPlayTime,

    // 范围辅助
    mapCurrentRange: () => {
      const { currentSentence, srtTender } = get();
      if (currentSentence && srtTender) {
        return srtTender.mapSeekTime(currentSentence);
      }
      return { start: 0, end: 0 };
    },

    getVirtualGroupRange: () => {
      const { virtualGroup, srtTender } = get();
      if (!virtualGroup.active || !srtTender || virtualGroup.sentences.length === 0) return null;
      // 选区循环同样是精听场景，加首尾留白保证每次循环都是完整的一段。
      return padPracticeClipRange(calcRangeForSentences(srtTender, virtualGroup.sentences), get().duration);
    },

    getLoopRange: () => {
      const { singleRepeat, virtualGroup, srtTender, currentSentence } = get();
      if (!singleRepeat) {
        return get().mapCurrentRange();
      }
      /*
        单句循环属于精听场景，和跟读一样需要「完整的一句话」：
        贴边循环会在每一遍都切掉首尾音，反复听反而强化了错误的边界感。
        自动暂停（autoPause）不加留白——它只需要在句末停住，不需要多播一段。
      */
      const focusInGroup = isFocusInVirtualGroup();
      if (focusInGroup && virtualGroup.active && srtTender && virtualGroup.sentences.length > 0) {
        return padPracticeClipRange(calcRangeForSentences(srtTender, virtualGroup.sentences), get().duration);
      }
      // 单句循环的循环区间取整个意群块。
      if (srtTender) {
        const block = getCurrentBlock();
        if (block) {
          return padPracticeClipRange(calcRangeForSentences(srtTender, block.sentences), get().duration);
        }
      }
      if (currentSentence && srtTender) {
        return padPracticeClipRange(srtTender.mapSeekTime(currentSentence), get().duration);
      }
      return { start: 0, end: 0 };
    },

    getCurrentBlock,

    // 播放起点延迟（配合 autoPause）
    onPlaySeek: (time) => {
      set((prev) => ({ internal: { ...prev.internal, onPlaySeekTime: time } }));
    },

    // 虚拟组
    setVirtualGroupBySentences: (ss) => {
      const sorted = [...ss].sort((a, b) => a.index - b.index);
      set({
        virtualGroup: { active: sorted.length > 0, sentences: sorted }
      });
    },

    setVirtualGroupByIndexRange: (startIndex, endIndex) => {
      const { sentences } = get();
      const min = Math.min(startIndex, endIndex);
      const max = Math.max(startIndex, endIndex);
      const picked = sentences
        .filter((s) => s.index >= min && s.index <= max)
        .sort((a, b) => a.index - b.index);
      set({
        virtualGroup: { active: picked.length > 0, sentences: picked }
      });
    },

    clearVirtualGroup: () => {
      set({ virtualGroup: { active: false, sentences: [] } });
    },

    // 高级 API —— 下一句（虚拟组当作一行）
    nextSentence: (step = 1) => {
      clearTailPreview();
      const { srtTender } = get();
      if (!srtTender) return;

      const units = buildNavUnits();
      if (units.length === 0) return;

      const pos = findFocusedNavIndex();
      if (pos < 0) return;

      // 跳句不改变播放意图：暂停中按「下一句」只移动播放头与高亮，不应突然起播。
      const play = get().playing;
      const nextIdx = Math.min(units.length - 1, Math.max(0, pos + step));
      const unit = units[nextIdx];

      if (unit.type === 'sentence') {
        const { start } = srtTender.mapSeekTime(unit.s);
        get().seekToTarget({ time: start, target: unit.s, play });
      } else {
        const range = get().getVirtualGroupRange();
        const start = range ? range.start : srtTender.mapSeekTime(unit.repr).start;
        get().seekToTarget({ time: start, target: unit.repr, play });
      }
    },

    // 高级 API —— 上一句
    prevSentence: (step = 1) => {
      clearTailPreview();
      const { srtTender } = get();
      if (!srtTender) return;

      const units = buildNavUnits();
      if (units.length === 0) return;

      const pos = findFocusedNavIndex();
      if (pos < 0) return;

      const play = get().playing;
      const nextIdx = Math.max(0, Math.min(units.length - 1, pos - step));
      const unit = units[nextIdx];

      if (unit.type === 'sentence') {
        const { start } = srtTender.mapSeekTime(unit.s);
        get().seekToTarget({ time: start, target: unit.s, play });
      } else {
        const range = get().getVirtualGroupRange();
        const start = range ? range.start : srtTender.mapSeekTime(unit.repr).start;
        get().seekToTarget({ time: start, target: unit.repr, play });
      }
    },

    // 高级 API —— 跳到指定句（按 index）
    gotoSentenceIndex: (index: number) => {
      clearTailPreview();
      const { sentences, srtTender, internal } = get();
      if (!srtTender) return;
      // O(1) 通过索引缓存定位
      const pos = internal.indexing?.indexPos.get(index);
      const target = (pos !== undefined && pos >= 0 && pos < sentences.length)
        ? sentences[pos]
        : sentences.find((s) => s.index === index);
      if (!target) return;
      const { start } = srtTender.mapSeekTime(target);
      // 点文稿跳句是导航，不是播放命令：暂停中跳句后应当仍停在暂停态。
      get().seekToTarget({ time: start, target, play: get().playing });
    },

    // 高级 API —— 跳到指定句（按对象）
    gotoSentence: (s: Sentence) => {
      clearTailPreview();
      const { srtTender } = get();
      if (!srtTender) return;
      const { start } = srtTender.mapSeekTime(s);
      get().seekToTarget({ time: start, target: s, play: get().playing });
    },

    // 高级 API —— 重复当前
    repeatCurrent: (options) => {
      clearTailPreview();
      const loop = options?.loop ?? true;
      // 时间轴微调（clearAdjust / adjustCurrentBegin）复用本入口只为了"跳到新的句首"，
      // 不是用户点「重复当前句」；它们必须保持当前播放态，否则暂停中微调会突然起播。
      const play = options?.play ?? true;
      if (loop) {
        // 走统一的模式入口：直接 set({ singleRepeat: true }) 会绕过互斥，
        // 让影子跟读/自动暂停与单句循环同时为真，句末行为变得不可预测。
        applyBooleanSentenceMode('singleRepeat');
        const vg = get().virtualGroup;
        if (vg.active && vg.sentences.length > 0) {
          const first = vg.sentences.slice().sort((a, b) => a.index - b.index)[0];
          const r = get().getVirtualGroupRange();
          const start = r ? r.start : get().mapCurrentRange().start;
          get().seekToTarget({ time: start, target: first, play });
        } else {
          const { start } = get().mapCurrentRange();
          const cur = get().currentSentence ?? getFocusedSentence() ?? null;
          get().seekToTarget({ time: start, target: cur ?? undefined, play });
        }
      } else {
        const vg = get().virtualGroup;
        if (vg.active && vg.sentences.length > 0) {
          const first = vg.sentences.slice().sort((a, b) => a.index - b.index)[0];
          const range = get().getVirtualGroupRange();
          const start = range ? range.start : get().mapCurrentRange().start;
          if (first) {
            get().seekToTarget({ time: start, target: first, play });
            return;
          }
        }
        const { start } = get().mapCurrentRange();
        const cur = get().currentSentence ?? getFocusedSentence() ?? null;
        get().seekToTarget({ time: start, target: cur ?? undefined, play });
      }
    },

    clearAdjust: async (sentence?: Sentence) => {
      const state = get();
      const srtTender = state.srtTender;
      // 传了句就以它为准；没传才退回当前句（播客行徽章与快捷键走这条）。
      const focus = sentence ?? state.currentSentence;
      if (!focus || !srtTender) {
        return;
      }

      const resetSentence = srtTender.clearAdjust(focus);
      patchSentenceInStore(resetSentence);
      const isCurrent = state.currentSentence
        ? sentenceKey(state.currentSentence) === sentenceKey(resetSentence)
        : false;
      if (isCurrent) {
        set({ currentSentence: resetSentence });
        state.repeatCurrent({ loop: false, play: state.playing });
      }

      const { subtitlePath } = usePlaybackSession.getState();
      if (StrUtil.isBlank(subtitlePath)) {
        return;
      }

      try {
        await playerApi.deleteTimestampAdjustmentByKey(resetSentence.key);
      } catch {
        // ignore backend errors; frontend state already restored
      }
    },

    // 高级 API —— 跳到当前句首
    seekToCurrentStart: () => {
      clearTailPreview();
      const { srtTender, virtualGroup } = get();
      if (!srtTender) return;

      // 句首/句尾跳转同样保持当前播放态：暂停中只移动播放头。
      const play = get().playing;

      if (virtualGroup.active && virtualGroup.sentences.length > 0 && isFocusInVirtualGroup()) {
        const first = virtualGroup.sentences.slice().sort((a, b) => a.index - b.index)[0];
        if (first) {
          const range = get().getVirtualGroupRange();
          const start = range ? range.start : srtTender.mapSeekTime(first).start;
          get().seekToTarget({ time: start, target: first, play });
          return;
        }
      }

      const currentSentence = get().currentSentence ?? getFocusedSentence();
      if (!currentSentence) return;
      const { start } = srtTender.mapSeekTime(currentSentence);
      get().seekToTarget({ time: start, target: currentSentence, play });
    },

    // 高级 API —— 跳到当前句尾
    seekToCurrentEnd: (epsilon = 0.05) => {
      clearTailPreview();
      const { srtTender, virtualGroup } = get();
      if (!srtTender) return;

      const play = get().playing;

      if (virtualGroup.active && virtualGroup.sentences.length > 0 && isFocusInVirtualGroup()) {
        const first = virtualGroup.sentences.slice().sort((a, b) => a.index - b.index)[0];
        if (first) {
          const range = get().getVirtualGroupRange();
          const end = range ? range.end : srtTender.mapSeekTime(first).end;
          get().seekToTarget({ time: Math.max(end - epsilon, 0), target: first, play });
          return;
        }
      }

      const currentSentence = get().currentSentence ?? getFocusedSentence();
      if (!currentSentence) return;
      const { end } = srtTender.mapSeekTime(currentSentence);
      get().seekToTarget({ time: Math.max(end - epsilon, 0), target: currentSentence, play });
    },

    // 高级 API —— 调整开始时间
    adjustCurrentBegin: (deltaSeconds: number) => {
      const state = get();
      const { srtTender, virtualGroup } = state;
      const focus = getFocusedSentence();
      if (!srtTender) return;

      // 目标句：组内第一句（若组激活且焦点在组内），否则当前焦点句
      let target = focus;
      if (virtualGroup.active && virtualGroup.sentences.length > 0 && isFocusInVirtualGroup()) {
        const first = virtualGroup.sentences.slice().sort((a, b) => a.index - b.index)[0];
        if (first) target = first;
      }
      if (!target) return;

      // 可选安全：避免 begin >= end
      const { start, end } = srtTender.mapSeekTime(target);
      const minGap = 0.02;
      const maxDelta = (end - minGap) - start;
      const safeDelta = deltaSeconds > 0 ? Math.min(deltaSeconds, Math.max(maxDelta, 0)) : deltaSeconds;

      const updated = srtTender.adjustBegin(target, safeDelta);
      patchSentenceInStore(updated);

      state.repeatCurrent({ loop: false, play: state.playing });

      const { subtitlePath } = usePlaybackSession.getState();
      if (StrUtil.isBlank(subtitlePath)) {
        return;
      }

      const { start: start2, end: end2 } = srtTender.mapSeekTime(updated);
      void playerApi.updateTimestampAdjustment({
        key: updated.key,
        subtitle_path: subtitlePath,
        subtitle_hash: usePlaybackSession.getState().srtHash,
        start_at: start2,
        end_at: end2
      }).catch(() => {
        // ignore backend errors; notification already shown
      });
    },

    // 高级 API —— 调整结束时间（尾部预览 + 立即锁定高亮）
    adjustCurrentEnd: (deltaSeconds: number, options) => {
      const state = get();
      const { srtTender, virtualGroup } = state;
      const focus = getFocusedSentence();
      if (!srtTender) return;

      // 目标句：组内最后一句（若组激活且焦点在组内），否则当前焦点句
      let target = focus;
      if (virtualGroup.active && virtualGroup.sentences.length > 0 && isFocusInVirtualGroup()) {
        const sorted = virtualGroup.sentences.slice().sort((a, b) => a.index - b.index);
        const last = sorted[sorted.length - 1];
        if (last) target = last;
      }
      if (!target) return;

      // 可选安全（如需）：避免 end <= start（与你对 begin 的安全策略对称）
      // const { start, end } = srtTender.mapSeekTime(target);
      // const minGap = 0.02;
      // const maxDelta = Number.POSITIVE_INFINITY; // 允许延长
      // const minDelta = (start + minGap) - end;   // 防止缩短到与 start 交叉
      // const safeDelta = Math.max(deltaSeconds, minDelta);

      const updated = srtTender.adjustEnd(target, deltaSeconds /* 或 safeDelta */);
      patchSentenceInStore(updated);

      state.repeatCurrent({ loop: false, play: state.playing });

      const { subtitlePath } = usePlaybackSession.getState();
      if (!StrUtil.isBlank(subtitlePath)) {
        const { start: start2, end: end2 } = srtTender.mapSeekTime(updated);
      void playerApi.updateTimestampAdjustment({
          key: updated.key,
          subtitle_path: subtitlePath,
          subtitle_hash: usePlaybackSession.getState().srtHash,
          start_at: start2,
          end_at: end2
        }).catch(() => {
          // ignore backend errors; notification already shown
        });
      }

      const { end } = srtTender.mapSeekTime(updated);
      const previewMs = options?.previewMs ?? 1000;
      const epsilon = 0.05;

      set((prev) => ({
        internal: {
          ...prev.internal,
          tailPreview: {
            active: true,
            untilTs: Date.now() + previewMs,
            returnTarget: updated,
            resumePlaying: state.playing,
          }
        }
      }));

      // 预览尾部：使用带目标的 seek，确保高亮不被 getByTime 干扰
      state.seekToTarget({ time: Math.max(end - epsilon, 0), target: updated });
    },

    // 别名
    bumpBegin: (deltaSeconds) => get().adjustCurrentBegin(deltaSeconds),
    bumpEnd: (deltaSeconds) => get().adjustCurrentEnd(deltaSeconds),

    // 只读选择器实现（均为 O(1)）
    getFocusedSentencePublic: () => {
      const state = get();
      const { currentSentence, srtTender } = state;
      if (currentSentence) return currentSentence;
      if (srtTender) {
        try {
          const s = srtTender.getByTime(getEffectiveTime());
          return s ?? null;
        } catch {
          return null;
        }
      }
      return null;
    },

    getSentenceCount: () => {
      const { internal, sentences } = get();
      return internal.indexing?.count ?? sentences.length;
    },

    getFocusedIndex: () => {
      const { internal } = get();
      const focus = get().getFocusedSentencePublic();
      if (!focus) return -1;
      const posMap = internal.indexing?.posMap;
      if (!posMap) return -1;
      const key = `${focus.fileHash}-${focus.index}`;
      const pos = posMap.get(key);
      return typeof pos === 'number' ? pos : -1;
    },

    isAtFirstSentence: () => {
      const cnt = get().getSentenceCount();
      if (cnt <= 0) return false;
      const idx = get().getFocusedIndex();
      return idx === 0;
    },

    isAtLastSentence: () => {
      const cnt = get().getSentenceCount();
      if (cnt <= 0) return false;
      const idx = get().getFocusedIndex();
      return idx === cnt - 1;
    },

    getFocusedLogicalIndex: () => getFocusedLogicalIndexInternal(),
    getLogicalCount: () => getLogicalCountInternal(),
    isAtFirstLogical: () => {
      const cnt = getLogicalCountInternal();
      if (cnt <= 0) return false;
      const idx = getFocusedLogicalIndexInternal();
      return idx === 0;
    },
    isAtLastLogical: () => {
      const cnt = getLogicalCountInternal();
      if (cnt <= 0) return false;
      const idx = getFocusedLogicalIndexInternal();
      return idx === cnt - 1;
    },
  };
});
