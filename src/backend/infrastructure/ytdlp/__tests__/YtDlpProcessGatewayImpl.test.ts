import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelByUserError } from '@/backend/utils/errors/errors';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-ytdlp-test',
        getVersion: () => '6.1.0',
    },
}));

const spawnMock = vi.fn();

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        default: { ...actual, chmodSync: vi.fn() },
        chmodSync: vi.fn(),
    };
});

vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();
    return {
        ...actual,
        default: { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) },
        spawn: (...args: unknown[]) => spawnMock(...args),
    };
});

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { YtDlpProcessGatewayImpl } from '@/backend/infrastructure/ytdlp/YtDlpProcessGatewayImpl';

class FakeChildProcess extends EventEmitter {
    public readonly stdout = new EventEmitter();
    public readonly stderr = new EventEmitter();
    public killed = false;
    public readonly signals: Array<NodeJS.Signals | number | undefined> = [];

    public kill = vi.fn((signal?: NodeJS.Signals | number) => {
        // 真实 Node ChildProcess 语义：kill('SIGTERM') 后 killed 立刻变 true
        this.killed = true;
        this.signals.push(signal);
        return true;
    });
}

describe('YtDlpProcessGatewayImpl 取消与强杀状态机', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        spawnMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('SIGTERM 超时后即使 process.killed 为 true 仍应补发 SIGKILL', async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const gateway = new YtDlpProcessGatewayImpl();

        const task = gateway.download({
            url: 'https://www.youtube.com/watch?v=abc',
            outputDir: '/tmp/non-existent-ytdlp-test',
            ytDlpBinaryPath: '/bin/yt-dlp',
        });

        task.cancel();
        expect(child.signals).toEqual(['SIGTERM']);
        expect(child.killed).toBe(true);

        vi.advanceTimersByTime(1200);
        expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);

        child.emit('close', 137);
        await expect(task.result).rejects.toBeInstanceOf(CancelByUserError);
    });

    it('取消请求与 code=0 退出竞态时，仍应判定为 CancelByUserError 而非成功', async () => {
        const child = new FakeChildProcess();
        spawnMock.mockReturnValue(child);
        const gateway = new YtDlpProcessGatewayImpl();

        const task = gateway.download({
            url: 'https://www.youtube.com/watch?v=abc',
            outputDir: '/tmp/non-existent-ytdlp-test',
            ytDlpBinaryPath: '/bin/yt-dlp',
        });

        task.cancel();
        child.emit('close', 0);

        await expect(task.result).rejects.toBeInstanceOf(CancelByUserError);
    });
});
