import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mutate, SWRConfig } from 'swr';
import HomePage from '@/fronted/features/file-browser/HomePage';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('@/fronted/i18n', () => ({
    default: {
        t: (key: string) => key,
    },
}));

vi.mock('@/fronted/components/layout/TitleBar/TitleBar', () => ({
    default: () => <div data-testid="mock-title-bar" />,
}));

vi.mock('@/fronted/components/layout/SideBar', () => ({
    default: () => <div data-testid="mock-sidebar" />,
}));

vi.mock('@/fronted/features/content-compass/ContentCompassSection', () => ({
    default: () => <div data-testid="mock-compass" />,
}));

vi.mock('@/fronted/features/youtube-import/YoutubeImportButton', () => ({
    default: () => <div data-testid="mock-yt-btn" />,
}));

vi.mock('@/fronted/features/youtube-import/YoutubeImportHero', () => ({
    default: () => <div data-testid="mock-yt-hero" />,
}));

vi.mock('@/fronted/features/file-browser/components/FolderSelector', () => ({
    default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    FolderSelectAction: {
        defaultAction2: () => vi.fn(),
    },
}));

vi.mock('@/fronted/features/file-browser/components/FileSelector', () => ({
    default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    FileAction: {
        playerAction2: () => vi.fn(),
    },
}));

vi.mock('@/fronted/hooks/useInView', () => ({
    default: () => false,
}));

vi.mock('@/fronted/features/file-browser/fileBrowserApi', () => ({
    fileBrowserApi: {
        changeWindowSize: vi.fn().mockResolvedValue(undefined),
        listBasicWatchHistory: vi.fn(),
        listWatchHistory: vi.fn(),
        deleteWatchHistoryGroup: vi.fn().mockResolvedValue(undefined),
        getThumbnail: vi.fn().mockResolvedValue(''),
        openFolder: vi.fn().mockResolvedValue(undefined),
        getVideoDetail: vi.fn(),
    },
}));

const makeVideo = (id: string, fileName: string): WatchHistoryVO => ({
    id,
    fileName,
    basePath: '/videos',
    current_position: 10,
    duration: 100,
    isFolder: false,
} as unknown as WatchHistoryVO);

describe('HomePage & ProjectListCard watch-history SWR sync', () => {
    let historyList: WatchHistoryVO[];

    beforeEach(async () => {
        vi.clearAllMocks();
        await mutate(() => true, undefined, { revalidate: false });
        historyList = [
            makeVideo('vid-1', 'first-lesson.mp4'),
            makeVideo('vid-2', 'second-lesson.mp4'),
        ];
        vi.mocked(fileBrowserApi.listBasicWatchHistory).mockImplementation(async () => [...historyList]);
        vi.mocked(fileBrowserApi.listWatchHistory).mockImplementation(async () => [...historyList]);
        vi.mocked(fileBrowserApi.deleteWatchHistoryGroup).mockImplementation(async (id: string) => {
            historyList = historyList.filter((item) => item.id !== id);
        });
    });

    it('删除历史记录卡片后通过 SWR 重新校验完整列表，不保留过期本地状态', async () => {
        render(
            <SWRConfig value={{ dedupingInterval: 0 }}>
                <MemoryRouter>
                    <HomePage />
                </MemoryRouter>
            </SWRConfig>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('watch-history-card-vid-1')).toBeDefined();
            expect(screen.getByTestId('watch-history-card-vid-2')).toBeDefined();
        });

        // 触发第一张卡片的悬浮删除按钮并在 AlertDialog 中确认删除
        fireEvent.mouseEnter(screen.getByTestId('watch-history-card-vid-1'));
        fireEvent.click(screen.getByRole('button', { name: 'common:delete' }));

        const dialog = await screen.findByRole('alertdialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'common:delete' }));

        await waitFor(() => {
            expect(fileBrowserApi.deleteWatchHistoryGroup).toHaveBeenCalledWith('vid-1');
            expect(screen.queryByTestId('watch-history-card-vid-1')).toBeNull();
        });
        expect(screen.getByTestId('watch-history-card-vid-2')).toBeDefined();
    });
});
