import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DpTaskState, type DpTask } from '@/common/contracts/dp-task';

const {
    mockStartSubtitleGeneration,
    mockCancelSubtitleGeneration,
    mockGetPlayerSubtitle,
    mockCall,
    mockOnTaskUpdate,
    toastSuccess,
    toastError,
} = vi.hoisted(() => ({
    mockStartSubtitleGeneration: vi.fn(),
    mockCancelSubtitleGeneration: vi.fn(),
    mockGetPlayerSubtitle: vi.fn(),
    mockCall: vi.fn(),
    mockOnTaskUpdate: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    toast: { success: toastSuccess, error: toastError },
}));

vi.mock('@/fronted/infrastructure/electron/backendClient', () => ({
    backendClient: { call: mockCall },
}));

vi.mock('@/fronted/infrastructure/electron/rendererEvents', () => ({
    rendererEvents: { onTaskUpdate: mockOnTaskUpdate },
}));

vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        startSubtitleGeneration: mockStartSubtitleGeneration,
        cancelSubtitleGeneration: mockCancelSubtitleGeneration,
        getPlayerSubtitle: mockGetPlayerSubtitle,
    },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import useDpTaskCenter, { startListeningToDpTasks, stopListeningToDpTasks } from '@/fronted/app/stores/dpTaskStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { useSubtitleGenerationStore } from '@/fronted/features/player/subtitleGenerationStore';

const makeTask = (id: number, status: DpTaskState): DpTask => ({
    id,
    status,
    progress: null,
    result: null,
    created_at: '2026-11-13 00:00:00',
    updated_at: '2026-11-13 00:00:00',
});

describe('subtitleGenerationStore 跨视频隔离与重连恢复', () => {
    let pushHandler: ((task: DpTask) => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        pushHandler = null;
        stopListeningToDpTasks();
        useDpTaskCenter.setState({ tasks: new Map() });
        useSubtitleGenerationStore.setState({
            taskIdsByVideo: {},
            startingVideos: {},
            cancellingVideos: {},
        });
        usePlaybackSession.setState({
            videoId: 'video-a',
            videoPath: '/tmp/a.mp4',
            subtitlePath: '',
            subtitleReloadToken: 0,
        });
        mockOnTaskUpdate.mockImplementation((cb: (task: DpTask) => void) => {
            pushHandler = cb;
            return () => {
                pushHandler = null;
            };
        });
        startListeningToDpTasks();
        mockCall.mockImplementation(async (_route: string, taskId: number) =>
            makeTask(taskId, DpTaskState.IN_PROGRESS),
        );
    });

    it('视频 A 生成期间切去视频 B 后，A 完成绝不覆盖 B 的字幕会话', async () => {
        mockStartSubtitleGeneration.mockResolvedValue(501);
        mockGetPlayerSubtitle.mockResolvedValue({ subtitlePath: '/tmp/a.srt', hasSubtitle: true });

        await useSubtitleGenerationStore.getState().start('video-a', {
            done: 'done',
            formatFailed: (m) => m,
        });

        expect(useSubtitleGenerationStore.getState().taskIdsByVideo['video-a']).toBe(501);
        expect(useSubtitleGenerationStore.getState().taskIdsByVideo['video-b']).toBeUndefined();

        // 用户切去视频 B（无字幕或自有字幕）
        usePlaybackSession.setState({
            videoId: 'video-b',
            videoPath: '/tmp/b.mp4',
            subtitlePath: '/tmp/b.srt',
            subtitleReloadToken: 10,
        });

        // 视频 A 的任务随后完成
        pushHandler?.(makeTask(501, DpTaskState.DONE));
        await Promise.resolve();

        expect(usePlaybackSession.getState().subtitlePath).toBe('/tmp/b.srt');
        expect(usePlaybackSession.getState().subtitleReloadToken).toBe(10);
        expect(mockGetPlayerSubtitle).not.toHaveBeenCalled();
        expect(useSubtitleGenerationStore.getState().taskIdsByVideo['video-a']).toBeUndefined();
    });

    it('停留在原视频 A 上完成生成时，自动更新字幕路径并触发重载', async () => {
        mockStartSubtitleGeneration.mockResolvedValue(502);
        mockGetPlayerSubtitle.mockResolvedValue({ subtitlePath: '/tmp/a.srt', hasSubtitle: true });

        await useSubtitleGenerationStore.getState().start('video-a', {
            done: 'done',
            formatFailed: (m) => m,
        });

        pushHandler?.(makeTask(502, DpTaskState.DONE));
        await vi.waitFor(() => {
            expect(usePlaybackSession.getState().subtitlePath).toBe('/tmp/a.srt');
            expect(usePlaybackSession.getState().subtitleReloadToken).toBe(1);
        });
        expect(toastSuccess).toHaveBeenCalledWith('done');
    });

    it('取消成功后立即清除取消中标记，不依赖任务 FINISH 广播', async () => {
        mockCancelSubtitleGeneration.mockResolvedValue(undefined);
        useSubtitleGenerationStore.setState({
            taskIdsByVideo: { 'video-a': 503 },
            cancellingVideos: {},
        });

        await useSubtitleGenerationStore.getState().cancel('video-a', (m) => m);

        expect(mockCancelSubtitleGeneration).toHaveBeenCalledWith(503);
        expect(useSubtitleGenerationStore.getState().cancellingVideos['video-a']).toBeUndefined();
    });

    it('取消请求失败时标记同样收口，并提示错误', async () => {
        mockCancelSubtitleGeneration.mockRejectedValue(new Error('ipc down'));
        useSubtitleGenerationStore.setState({
            taskIdsByVideo: { 'video-a': 504 },
            cancellingVideos: {},
        });

        await useSubtitleGenerationStore.getState().cancel('video-a', (m) => m);

        expect(toastError).toHaveBeenCalledWith('ipc down');
        expect(useSubtitleGenerationStore.getState().cancellingVideos['video-a']).toBeUndefined();
    });
});
