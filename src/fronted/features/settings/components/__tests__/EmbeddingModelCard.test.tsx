import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import EmbeddingModelCard from '../EmbeddingModelCard';
import { settingsApi } from '@/fronted/features/settings/settingsApi';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('react-hot-toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('@/fronted/features/settings/settingsApi', () => ({
    settingsApi: {
        downloadEmbeddingModel: vi.fn(),
    },
}));

const status = {
    ready: false,
    name: 'BGE Small EN v1.5 Q8_0',
    sizeLabel: '35 MB',
    bytes: 36_806_944,
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

    it('下载失败时展示错误，不刷新状态', async () => {
        vi.mocked(settingsApi.downloadEmbeddingModel).mockRejectedValue(new Error('校验失败'));
        const onInstalled = vi.fn();
        render(<EmbeddingModelCard status={status} onInstalled={onInstalled} />);

        fireEvent.click(screen.getByRole('button', { name: /resources\.embedding\.install/i }));

        await waitFor(() => {
            expect(onInstalled).not.toHaveBeenCalled();
        });
    });
});
