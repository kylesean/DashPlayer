import { describe, expect, it } from 'vitest';
import {
    derivePlayerViewMode,
    hasPlayerViewConflict,
    isViewToggleActive,
    resolveViewToggle,
    viewModeFlags,
    type PlayerViewMode,
} from '../player-view-mode';

describe('播放页视图互斥', () => {
    it('每个视图只点亮自己的字段，另外两个必须关闭', () => {
        expect(viewModeFlags('play')).toEqual({
            learningVisible: false,
            practiceVisible: false,
            podcastMode: false,
        });
        expect(viewModeFlags('learning')).toEqual({
            learningVisible: true,
            practiceVisible: false,
            podcastMode: false,
        });
        expect(viewModeFlags('practice')).toEqual({
            learningVisible: false,
            practiceVisible: true,
            podcastMode: false,
        });
        expect(viewModeFlags('podcast')).toEqual({
            learningVisible: false,
            practiceVisible: false,
            podcastMode: true,
        });
    });

    it.each(['play', 'learning', 'practice', 'podcast'] as const satisfies readonly PlayerViewMode[])(
        '由字段推导视图时能还原合法状态 %s',
        (mode) => {
            expect(derivePlayerViewMode(viewModeFlags(mode))).toBe(mode);
            expect(hasPlayerViewConflict(viewModeFlags(mode))).toBe(false);
        },
    );

    it('非法组合按覆盖层优先级退化为可解释结果：播客 > 练习 > 学习', () => {
        // 播客层是全屏覆盖层，学习页即使为真也被盖住，用户实际看到的是播客。
        expect(derivePlayerViewMode({
            learningVisible: true,
            practiceVisible: false,
            podcastMode: true,
        })).toBe('podcast');
        expect(derivePlayerViewMode({
            learningVisible: true,
            practiceVisible: true,
            podcastMode: false,
        })).toBe('practice');
        expect(hasPlayerViewConflict({
            learningVisible: true,
            practiceVisible: true,
            podcastMode: true,
        })).toBe(true);
    });

    it('同一开关点击两次回到播放画面，不同开关直接互斥切换', () => {
        expect(resolveViewToggle('play', 'learning')).toBe('learning');
        expect(resolveViewToggle('learning', 'learning')).toBe('play');
        expect(resolveViewToggle('learning', 'practice')).toBe('practice');
        expect(resolveViewToggle('practice', 'practice')).toBe('play');
        // 播客模式下点学习：直接切到学习，不留两层叠加
        expect(resolveViewToggle('podcast', 'learning')).toBe('learning');
        expect(resolveViewToggle('podcast', 'podcast')).toBe('play');
    });

    it('激活态只认实际可见视图，不认字段本身', () => {
        expect(isViewToggleActive('learning', 'learning')).toBe(true);
        expect(isViewToggleActive('play', 'learning')).toBe(false);
        // 非法组合下播客盖住学习页：学习按钮不应显示为激活
        const actual = derivePlayerViewMode({
            learningVisible: true,
            practiceVisible: false,
            podcastMode: true,
        });
        expect(isViewToggleActive(actual, 'learning')).toBe(false);
        expect(isViewToggleActive(actual, 'podcast')).toBe(true);
    });
});
