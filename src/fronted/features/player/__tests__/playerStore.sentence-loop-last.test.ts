import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sentence } from '@/common/types/SentenceC';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { useTrainingModeStore } from '@/fronted/features/player/trainingStore';

vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        deleteTimestampAdjustmentByKey: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/fronted/infrastructure/electron/backendClient', () => ({
    backendClient: { call: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const makeSentence = (index: number, start: number, end: number): Sentence => ({
    fileHash: 'hash-last',
    index,
    start,
    end,
    adjustedStart: null,
    adjustedEnd: null,
    text: `Sentence ${index}`,
    textZH: '',
    key: `hash-last-${index}`,
    transGroup: 1,
    translationKey: `hash-last:${index}`,
    struct: { original: `Sentence ${index}`, blocks: [] },
});

// 两条字幕间隔必须 ≥ 0.8s（MAX_GAP_SECONDS），否则会被归并进同一意群块，
// 循环计划的锚点就变成块首句而不是末句。
const SENTENCES = [
    makeSentence(0, 1, 3),
    makeSentence(1, 3.9, 6),
];

/**
 * 回归背景：getByTime 对首尾做了钳制，越过末句的采样永远返回末句本身，
 * 「进入下一句再续开计划」的判定在最后一句永不成立——completed 计划会永久滞留，
 * 拦截全部句末模式（逐句循环/单句循环/自动暂停/影子跟读）直到用户手动逃逸。
 * 现在播放头越过锚点句末 +0.2s 缓冲即视为空隙已过，为末句续开新一轮。
 */
describe('playerStore 逐句循环在末句的 completed 逃逸', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useTrainingModeStore.setState({ skipGap: false });
        // store 是模块级单例：上一条测试遗留的句末模式必须清掉（setSource 有意保留模式）
        usePlayer.setState({
            autoPause: false,
            singleRepeat: false,
            shadowing: false,
            hoverRepeat: false,
            sentenceLoop: null,
        });
        usePlayer.getState().setSource('file:///test.mp4');
        usePlayer.getState().loadSubtitles(SENTENCES);
        usePlayer.setState({ playbackRate: 1.0 });
    });

    it('末句播完两遍后越过句末，计划续开新一轮而不是永久滞留', () => {
        const s1 = usePlayer.getState().sentences[1];

        // 锚定末句开启逐句循环 ×2
        usePlayer.getState().seekToTarget({ time: 4.0, target: s1 });
        usePlayer.getState().setSentenceLoop({ times: 2 });
        usePlayer.getState().resolveSeek(3.9);
        let plan = usePlayer.getState().internal.transientPlan;
        expect(plan?.anchorKey).toBe('hash-last-1');

        // 第 1 遍播完（lead=0.06s，5.96 已越过判定线）→ seek 回句首
        usePlayer.getState().updateExactPlayTime(5.96);
        vi.runAllTimers();
        plan = usePlayer.getState().internal.transientPlan;
        expect(plan?.loopDone).toBe(1);

        // 第 2 遍播完 → 不跳空隙 → 进入 completed 等待空隙
        usePlayer.getState().resolveSeek(3.9);
        usePlayer.getState().updateExactPlayTime(5.96);
        vi.runAllTimers();
        plan = usePlayer.getState().internal.transientPlan;
        expect(plan?.completed).toBe(true);

        // 播放头越过末句句末（getByTime 钳制仍返回末句本身）：修复前在此永久滞留
        usePlayer.getState().updateExactPlayTime(6.3);
        vi.runAllTimers();
        plan = usePlayer.getState().internal.transientPlan;
        expect(plan).not.toBeNull();
        expect(plan?.completed).toBeFalsy();
        expect(plan?.loopDone).toBe(0);
        // 续开动作以 seek 回句首开始
        expect(usePlayer.getState().internal.seekInFlight).toBe(true);
    });

    it('一次性计划（未开启逐句循环）在末句越过句末后正常清除', () => {
        const s1 = usePlayer.getState().sentences[1];

        usePlayer.getState().seekToTarget({ time: 4.0, target: s1 });
        // 直接构造一次性两遍计划（repeatCurrent 语义）
        usePlayer.getState().repeatCurrent({ loop: false, play: true });
        usePlayer.getState().resolveSeek(3.9);
        usePlayer.getState().updateExactPlayTime(5.96);
        vi.runAllTimers();
        // 单遍计划：第一遍结束即清计划并恢复倍速（无 sentenceLoop 时不滞留）
        expect(usePlayer.getState().internal.transientPlan).toBeNull();
    });
});
