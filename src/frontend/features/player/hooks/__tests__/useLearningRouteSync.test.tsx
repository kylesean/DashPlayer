import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

const mockState = {
    pathname: '/player/v1',
    search: '',
    learningVisible: false,
    currentSentenceReady: true,
};

const navigateMock = vi.fn();
const exitOverlayViewMock = vi.fn(() => {
    mockState.learningVisible = false;
});
const createFromCurrentMock = vi.fn();

vi.mock('react-router-dom', () => ({
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: mockState.pathname, search: mockState.search }),
}));

vi.mock('@/frontend/features/chat/chatStore', () => ({
    default: Object.assign(
        (selector: (s: { learningVisible: boolean }) => unknown) =>
            selector({ learningVisible: mockState.learningVisible }),
        {
            getState: () => ({
                learningVisible: mockState.learningVisible,
                createFromCurrent: createFromCurrentMock,
            }),
        },
    ),
}));

vi.mock('@/frontend/features/player/playerState', () => ({
    usePlayerState: (selector: (s: { currentSentence: object | null }) => unknown) =>
        selector({ currentSentence: mockState.currentSentenceReady ? { text: 'hi' } : null }),
}));

vi.mock('@/frontend/features/player/lib/player-view-controller', () => ({
    exitOverlayView: () => exitOverlayViewMock(),
}));

import { useLearningRouteSync } from '@/frontend/features/player/hooks/useLearningRouteSync';

function Harness() {
    useLearningRouteSync();
    return null;
}

describe('useLearningRouteSync 后退再前进与过期请求收敛', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockState.pathname = '/player/v1';
        mockState.search = '';
        mockState.learningVisible = false;
        mockState.currentSentenceReady = true;
    });

    it('离开 /learn 后立即重新前进 /learn 不应被在途旧 enterAttempt 锁死', async () => {
        let rejectFirst!: (err: Error) => void;
        createFromCurrentMock
            .mockImplementationOnce(() => new Promise<void>((_res, rej) => {
                rejectFirst = rej;
            }))
            .mockImplementationOnce(async () => {
                mockState.learningVisible = true;
            });

        mockState.pathname = '/player/v1/learn';
        const { rerender } = render(<Harness />);
        expect(createFromCurrentMock).toHaveBeenCalledTimes(1);

        // 首个请求仍在途时浏览器后退
        mockState.pathname = '/player/v1';
        rerender(<Harness />);

        // 紧接着浏览器前进回到 /learn：旧请求尚未完成，仍应重新触发第二次进入
        mockState.pathname = '/player/v1/learn';
        rerender(<Harness />);
        expect(createFromCurrentMock).toHaveBeenCalledTimes(2);

        // 旧请求此时失败落定，不得将已前进到的 /learn replace 退回播放页
        await act(async () => {
            rejectFirst(new Error('stale fail'));
            await Promise.resolve();
        });
        expect(navigateMock).not.toHaveBeenCalledWith('/player/v1', { replace: true });
    });
});
