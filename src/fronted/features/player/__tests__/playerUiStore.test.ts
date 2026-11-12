import { beforeEach, describe, expect, it } from 'vitest';
import { toggleBilingualTracks, usePlayerUi } from '@/fronted/features/player/playerUiStore';

describe('playerUiStore 字幕轨道切换状态机', () => {
    beforeEach(() => {
        usePlayerUi.setState({
            showEn: true,
            showCn: false,
            showSourceZh: true,
            restorableSourceZh: false,
        });
    });

    it('toggleBilingualTracks 从纯英文切入双语，从双语退回纯英文，绝不隐藏全部字幕', () => {
        expect(toggleBilingualTracks({ showEn: true, showCn: false })).toEqual({ showEn: true, showCn: true });
        expect(toggleBilingualTracks({ showEn: true, showCn: true })).toEqual({ showEn: true, showCn: false });
        expect(toggleBilingualTracks({ showEn: false, showCn: true })).toEqual({ showEn: true, showCn: true });
        expect(toggleBilingualTracks({ showEn: false, showCn: false })).toEqual({ showEn: true, showCn: true });
    });

    it('changeShowEnCn 从纯英文触发时开启双语而非全关', () => {
        usePlayerUi.getState().changeShowEnCn();
        expect(usePlayerUi.getState().showEn).toBe(true);
        expect(usePlayerUi.getState().showCn).toBe(true);

        usePlayerUi.getState().changeShowEnCn();
        expect(usePlayerUi.getState().showEn).toBe(true);
        expect(usePlayerUi.getState().showCn).toBe(false);
    });

    it('经 EN 切回双语时保留并恢复原 showSourceZh 偏好', () => {
        usePlayerUi.setState({ showEn: true, showCn: true, showSourceZh: true, restorableSourceZh: false });

        usePlayerUi.getState().selectTrackPreset('english', true);
        expect(usePlayerUi.getState().showEn).toBe(true);
        expect(usePlayerUi.getState().showCn).toBe(false);
        expect(usePlayerUi.getState().showSourceZh).toBe(false);

        usePlayerUi.getState().selectTrackPreset('bilingual', true);
        expect(usePlayerUi.getState().showEn).toBe(true);
        expect(usePlayerUi.getState().showCn).toBe(true);
        expect(usePlayerUi.getState().showSourceZh).toBe(true);
    });
});
