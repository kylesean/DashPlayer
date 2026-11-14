import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

import EmbeddingModelCard from '../EmbeddingModelCard';
import { settingsApi } from '@/frontend/features/settings/settingsApi';
import {
    subscribeEmbeddingDownloadProgress,
    type EmbeddingDownloadProgressEvent,
} from '@/frontend/features/settings/settingsEvents';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            (params && 'percent' in params ? `${key}:${params.percent}` : key),
    }),
}));

vi.mock('react-hot-toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('@/frontend/features/settings/settingsApi', () => ({
    settingsApi: {
        downloadEmbeddingModel: vi.fn(),
        downloadEmbeddingMultimodal: vi.fn(),
        removeEmbeddingModel: vi.fn(),
        cancelEmbeddingModelDownload: vi.fn(),
        openUrl: vi.fn(),
        openFolderForFile: vi.fn(),
    },
}));

vi.mock('@/frontend/features/settings/settingsEvents', () => ({
    subscribeEmbeddingDownloadProgress: vi.fn(() => () => {}),
}));

const status = {
    ready: false,
    name: 'EmbeddingGemma 2 Q4_K_XL',
    sizeLabel: '168 MB',
    bytes: 175_673_856,
    multimodalReady: false,
    multimodalBytes: 554_821_120,
};

describe('EmbeddingModelCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('未安装时展示安装按钮，点击后调用下载并刷新状态', async () => {
        vi.mocked(settingsApi.downloadEmbeddingModel).mockResolvedValue(undefined);
        const onInstalled = vi.fn();
        render(<EmbeddingModelCard status={status} onInstalled={onInstalled} />);

        fireEvent.click(screen.getByRole('button', { name: /resources\.embedding\.install/i }));

        await waitFor(() => {
            expect(settingsApi.downloadEmbeddingModel).toHaveBeenCalledTimes(1);
            expect(onInstalled).toHaveBeenCalledTimes(1);
        });
    });

    it('已安装时不再展示安装按钮', () => {
        render(<EmbeddingModelCard status={{ ...status, ready: true }} onInstalled={vi.fn()} />);

        expect(screen.queryByRole('button', { name: /resources\.embedding\.install/i })).toBeNull();
        expect(screen.getByText('resources.embedding.ready')).toBeDefined();
    });

    it('已安装但缺多模态投影时提供图像理解安装入口', async () => {
        vi.mocked(settingsApi.downloadEmbeddingMultimodal).mockResolvedValue(undefined);
        const onInstalled = vi.fn();
        render(
            <EmbeddingModelCard
                status={{ ...status, ready: true, multimodalReady: false }}
                onInstalled={onInstalled}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /multimodalInstall/i }));

        await waitFor(() => {
            expect(settingsApi.downloadEmbeddingMultimodal).toHaveBeenCalledTimes(1);
            expect(onInstalled).toHaveBeenCalledTimes(1);
        });
    });

    it('多模态已就绪时不再展示安装入口', () => {
        render(
            <EmbeddingModelCard
                status={{ ...status, ready: true, multimodalReady: true }}
                onInstalled={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: /multimodalInstall/i })).toBeNull();
        expect(screen.getByText('resources.embedding.multimodalReady')).toBeDefined();
    });

    it('已安装时可删除模型并刷新状态', async () => {
        vi.mocked(settingsApi.removeEmbeddingModel).mockResolvedValue(2);
        const onInstalled = vi.fn();
        render(
            <EmbeddingModelCard
                status={{ ...status, ready: true, multimodalReady: true }}
                onInstalled={onInstalled}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /resources\.embedding\.remove/i }));

        await waitFor(() => {
            expect(settingsApi.removeEmbeddingModel).toHaveBeenCalledTimes(1);
            expect(onInstalled).toHaveBeenCalledTimes(1);
        });
    });

    it('下载失败时展示错误并支持重试与跳转代理设置，不刷新状态', async () => {
        vi.mocked(settingsApi.downloadEmbeddingModel).mockRejectedValue(new Error('校验失败'));
        const onInstalled = vi.fn();
        const onOpenProxySettings = vi.fn();
        render(
            <EmbeddingModelCard
                status={status}
                onInstalled={onInstalled}
                onOpenProxySettings={onOpenProxySettings}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /resources\.embedding\.install/i }));

        await waitFor(() => {
            expect(onInstalled).not.toHaveBeenCalled();
            expect(screen.getByText('resources.pack.proxyHint')).toBeDefined();
        });

        fireEvent.click(screen.getByRole('button', { name: /resources\.pack\.openProxySettings/i }));
        expect(onOpenProxySettings).toHaveBeenCalledTimes(1);
    });

    it('下载中展示实时进度条，并可通过取消按钮中止下载', async () => {
        let listener: ((detail: EmbeddingDownloadProgressEvent) => void) | null = null;
        vi.mocked(subscribeEmbeddingDownloadProgress).mockImplementation((cb) => {
            listener = cb;
            return () => {
                listener = null;
            };
        });
        vi.mocked(settingsApi.cancelEmbeddingModelDownload).mockResolvedValue({ cancelled: true });
        const onInstalled = vi.fn();

        render(<EmbeddingModelCard status={status} onInstalled={onInstalled} />);

        act(() => {
            listener?.({
                target: 'base',
                percent: 42,
                downloaded: 42,
                total: 100,
                phase: 'downloading',
            });
        });

        expect(screen.getByRole('progressbar')).toBeDefined();
        expect(screen.getByText('resources.embedding.phaseDownloading:42')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: /resources\.embedding\.cancel/i }));
        await waitFor(() => {
            expect(settingsApi.cancelEmbeddingModelDownload).toHaveBeenCalledTimes(1);
        });
    });
});
