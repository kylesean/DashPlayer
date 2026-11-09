import { describe, expect, it } from 'vitest';
import {
    PLAYER_SCROLL_OBSERVATION_PREFIX,
    PLAYER_SIDEBAR_SCROLLER_TESTID,
    SENTENCE_CARD_TESTID,
    SIDE_TRANSLATION_TOGGLE_TESTID,
} from '@/common/constants/player-scroll-protocol';

/**
 * 这份契约的价值全在「只有一份」：产品挂 DOM、用例定位元素、机读工具切分日志
 * 都引用它。所以这里断言的不是「字符串等于某个字面量」（那是同义反复），
 * 而是它必须满足的**形态约束**——任何一条被破坏都会让某一方静默失联。
 */
describe('播放器侧栏滚动的跨边界协议', () => {
    it('testid 全部非空且不含空白，可直接放进属性选择器', () => {
        for (const testId of [
            PLAYER_SIDEBAR_SCROLLER_TESTID,
            SENTENCE_CARD_TESTID,
            SIDE_TRANSLATION_TOGGLE_TESTID,
        ]) {
            expect(testId.trim()).toBe(testId);
            expect(testId).not.toBe('');
            // `[data-testid="${id}"]` 是靠字符串拼进选择器的，带引号或空格会直接抛错
            expect(testId).toMatch(/^[a-z0-9-]+$/);
        }
    });

    it('三个 testid 互不相同', () => {
        const ids = new Set([
            PLAYER_SIDEBAR_SCROLLER_TESTID,
            SENTENCE_CARD_TESTID,
            SIDE_TRANSLATION_TOGGLE_TESTID,
        ]);
        // 撞名会让 `getByTestId` 命中多个元素，断言从「定位这一行」退化成「定位随便一个」
        expect(ids.size).toBe(3);
    });

    it('观测前缀以空白结尾，避免 JSON 与前缀粘连', () => {
        expect(PLAYER_SCROLL_OBSERVATION_PREFIX).toBe(PLAYER_SCROLL_OBSERVATION_PREFIX.trim() + ' ');
    });
});
