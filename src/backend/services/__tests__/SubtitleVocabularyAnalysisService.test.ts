import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchedWord, WordMatchService } from '@/backend/services/WordMatchService';
import { SubtitleVocabularyAnalysisServiceImpl } from '@/backend/services/SubtitleVocabularyAnalysisService';

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const makeService = (matchMock: ReturnType<typeof vi.fn>): SubtitleVocabularyAnalysisServiceImpl => {
    const wordMatchService = {
        getVocabularyRevision: vi.fn().mockReturnValue(1),
        matchWordsInTexts: matchMock,
    } as unknown as WordMatchService;
    return new SubtitleVocabularyAnalysisServiceImpl(wordMatchService);
};

/** 等待若干微任务，让 chunk0 的匹配与落缓存完成。 */
const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
};

/**
 * 回归背景：detectClipStatus 的轮询补跑用 isRunning 判定，而 isRunning 读
 * getStatus().status === 'analyzing'——被其它字幕取代的分析（有分块但已让位）
 * getStatus 仍返回 analyzing，补跑分支永不触发，状态永久卡在"分析中 99%"。
 * 现在 isRunning 走 isActive（是否挂 activeAnalysis）。
 */
describe('字幕生词分析：被取代任务的活跃判定', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('被取代后（有部分分块）getStatus 仍 analyzing，但 isActive 为 false', async () => {
        let releaseChunk1: () => void = () => {};
        const chunk1Gate = new Promise<MatchedWord[][]>((resolve) => {
            releaseChunk1 = () => resolve([]);
        });
        const matchMock = vi.fn()
            .mockResolvedValueOnce(new Array(50).fill([]))
            .mockImplementationOnce(() => chunk1Gate)
            .mockResolvedValue([]);
        const service = makeService(matchMock);

        const first = service.analyze('hash-A', new Array(100).fill('line'));
        await flushMicrotasks();
        expect(service.isActive('hash-A')).toBe(true);

        // 第二份字幕让第一份让位（analyze 同步登记 activeAnalysis，立即可断言）
        const second = service.analyze('hash-B', ['another']);
        expect(service.isActive('hash-B')).toBe(true);
        expect(service.isActive('hash-A')).toBe(false);

        // 释放挂起的 chunk1，A 的 run 在 assertCurrent 处中止
        releaseChunk1();
        await Promise.allSettled([first, second]);

        // 旧 isRunning 判定（status==='analyzing'）在此失灵：有分块、无结果、已让位
        expect(service.getStatus('hash-A').status).toBe('analyzing');
        expect(service.getStatus('hash-A').progress).toBe(50);
    });

    it('初始状态与完成态的 isActive 均为 false', async () => {
        const service = makeService(vi.fn().mockResolvedValue([]));

        expect(service.isActive('hash-A')).toBe(false);

        const run = service.analyze('hash-A', ['hello world']);
        await run;
        expect(service.isActive('hash-A')).toBe(false);
        expect(service.getStatus('hash-A').status).toBe('completed');
    });

    it('同字幕并发调用时，后接入调用方能收到进度且首位取消不会误杀首位之后的订阅者', async () => {
        let releaseChunk0!: () => void;
        const matchMock = vi.fn().mockImplementation(
            () => new Promise<MatchedWord[][]>((resolve) => {
                releaseChunk0 = () => resolve([[]]);
            }),
        );
        const service = makeService(matchMock);

        let caller1Active = true;
        const caller1Progress: number[] = [];
        const caller2Progress: number[] = [];

        const p1 = service.analyze('hash-shared', ['one line'], (p) => { caller1Progress.push(p); }, () => caller1Active);
        const p2 = service.analyze('hash-shared', ['one line'], (p) => { caller2Progress.push(p); }, () => true);
        await flushMicrotasks();

        // 首位调用方随后失效（如组件卸载），第二位仍活跃
        caller1Active = false;
        releaseChunk0();

        await expect(p1).rejects.toThrow('SUBTITLE_VOCABULARY_ANALYSIS_CANCELLED');
        const res2 = await p2;
        expect(res2.fileHash).toBe('hash-shared');
        expect(caller2Progress).toContain(100);
    });
});
