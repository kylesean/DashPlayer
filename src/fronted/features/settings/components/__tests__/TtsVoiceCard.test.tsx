import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import '@/fronted/i18n';

import TtsVoiceCard from '../TtsVoiceCard';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { resetPackDownloadStateForTests } from '@/fronted/features/settings/resourcePackDownloadStore';

vi.mock('@/fronted/features/settings/settingsApi', () => ({
    settingsApi: {
        listTtsVoices: vi.fn(),
        selectTtsVoice: vi.fn(),
        downloadSherpaTtsModel: vi.fn(),
        cancelSherpaTtsModelDownload: vi.fn(),
    },
}));

vi.mock('@/fronted/features/settings/settingsEvents', () => ({
    subscribeArchiveDownloadProgress: vi.fn(() => () => {}),
}));

describe('TtsVoiceCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetPackDownloadStateForTests();
    });

    it('当前选中旧 Piper 且未安装 Kokoro 时，直接展示升级提示和一键切换下载按钮', async () => {
        vi.mocked(settingsApi.listTtsVoices).mockResolvedValue({
            selected: 'en-US-lessac-medium',
            voices: [
                {
                    id: 'en-US-lessac-medium',
                    name: 'Piper Lessac',
                    accent: 'en-US',
                    gender: 'female',
                    quality: 'medium',
                    installed: true,
                },
                {
                    id: 'kokoro-en-US-bella',
                    name: 'Kokoro Bella',
                    accent: 'en-US',
                    gender: 'female',
                    quality: 'high',
                    installed: false,
                },
            ],
        });
        vi.mocked(settingsApi.selectTtsVoice).mockResolvedValue({ success: true, message: 'ok' });
        vi.mocked(settingsApi.downloadSherpaTtsModel).mockResolvedValue({ success: true, message: 'ok' });

        render(
            <SWRConfig value={{ provider: () => new Map() }}>
                <TtsVoiceCard />
            </SWRConfig>,
        );

        const upgradeBtn = await screen.findByRole('button', { name: /Kokoro/ });
        await userEvent.click(upgradeBtn);

        await waitFor(() => {
            expect(settingsApi.selectTtsVoice).toHaveBeenCalledWith('kokoro-en-US-bella');
            expect(settingsApi.downloadSherpaTtsModel).toHaveBeenCalledTimes(1);
        });
    });

    it('选中未安装音色时，在卡片内直接提供下载音色按钮', async () => {
        vi.mocked(settingsApi.listTtsVoices).mockResolvedValue({
            selected: 'kokoro-en-US-bella',
            voices: [
                {
                    id: 'kokoro-en-US-bella',
                    name: 'Kokoro Bella',
                    accent: 'en-US',
                    gender: 'female',
                    quality: 'high',
                    installed: false,
                },
            ],
        });
        vi.mocked(settingsApi.downloadSherpaTtsModel).mockResolvedValue({ success: true, message: 'ok' });

        render(
            <SWRConfig value={{ provider: () => new Map() }}>
                <TtsVoiceCard />
            </SWRConfig>,
        );

        const downloadBtn = await screen.findByRole('button', { name: /下载音色|Download voice/ });
        await userEvent.click(downloadBtn);

        await waitFor(() => {
            expect(settingsApi.downloadSherpaTtsModel).toHaveBeenCalledTimes(1);
        });
    });
});
