import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import SubtitleTrackSegmented from '../SubtitleTrackSegmented';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { usePlayer } from '@/fronted/features/player/playerStore';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key,
    }),
}));

vi.mock('@astryxdesign/core/Tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/fronted/features/settings/settingsStore', () => ({
    default: (selector: (s: { setting: (key: string) => string }) => unknown) =>
        selector({ setting: () => '' }),
}));

/**
 * 把字幕轨道的三路开关与"字幕文件是否带中文"摆到指定状态。
 *
 * @param options 展示开关与源字幕中文可用性。
 */
const arrange = (options: {
    showEn: boolean;
    showCn: boolean;
    showSourceZh: boolean;
    hasChineseLines: boolean;
}): void => {
    usePlayerUi.setState({
        showEn: options.showEn,
        showCn: options.showCn,
        showSourceZh: options.showSourceZh,
    });
    usePlayer.setState({
        sentences: options.hasChineseLines
            ? ([{ key: 'k1', index: 0, text: 'hello', textZH: '你好', fileHash: 'h' }] as never)
            : ([{ key: 'k1', index: 0, text: 'hello', fileHash: 'h' }] as never),
    });
};

/** 按可访问名称取分段按钮。 */
const trackButton = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('SubtitleTrackSegmented', () => {
    beforeEach(() => {
        usePlayerUi.setState({ showEn: true, showCn: true, showSourceZh: true });
        usePlayer.setState({ sentences: [] });
    });

    it('源字幕没有中文行时，点「中」能真正切出中文轨道，不会卡在空白字幕', () => {
        // 按一次「双语」快捷键后进入的典型状态：英文与 AI 翻译都关，源字幕中文开关仍开着
        arrange({ showEn: false, showCn: false, showSourceZh: true, hasChineseLines: false });
        render(<SubtitleTrackSegmented tone="panel" />);

        fireEvent.click(trackButton('controlBar.tracksChinese'));

        // 必须真的打开 AI 翻译，否则画面仍是一行中文都没有
        expect(usePlayerUi.getState().showCn).toBe(true);
    });

    it('源字幕确实带中文时，点「中」只关英文，不重复打开 AI 翻译', () => {
        arrange({ showEn: true, showCn: false, showSourceZh: true, hasChineseLines: true });
        render(<SubtitleTrackSegmented tone="panel" />);

        fireEvent.click(trackButton('controlBar.tracksChinese'));

        expect(usePlayerUi.getState().showEn).toBe(false);
        expect(usePlayerUi.getState().showCn).toBe(false);
        expect(usePlayerUi.getState().showSourceZh).toBe(true);
    });

    it('三档里始终恰好有一档处于选中态', () => {
        arrange({ showEn: false, showCn: false, showSourceZh: true, hasChineseLines: false });
        render(<SubtitleTrackSegmented tone="panel" />);

        const pressed = [
            trackButton('controlBar.tracksEnglish'),
            trackButton('controlBar.tracksChinese'),
            trackButton('controlBar.tracksBilingual'),
        ].map((button) => button.getAttribute('aria-pressed'));

        expect(pressed.filter((value) => value === 'true')).toHaveLength(0);

        fireEvent.click(trackButton('controlBar.tracksChinese'));

        const after = [
            trackButton('controlBar.tracksEnglish'),
            trackButton('controlBar.tracksChinese'),
            trackButton('controlBar.tracksBilingual'),
        ].map((button) => button.getAttribute('aria-pressed'));

        expect(after.filter((value) => value === 'true')).toHaveLength(1);
        expect(trackButton('controlBar.tracksChinese').getAttribute('aria-pressed')).toBe('true');
    });
});
