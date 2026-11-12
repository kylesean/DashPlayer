import { describe, expect, it } from 'vitest';

import zhPlayer from '@/fronted/i18n/locales/zh-CN/player.json';
import enPlayer from '@/fronted/i18n/locales/en-US/player.json';
import zhCommon from '@/fronted/i18n/locales/zh-CN/common.json';

/**
 * 语境推荐理由的文案必须落在 `player` 命名空间。
 *
 * 回归背景：`word.tsx` 用 `useTranslation('common')` 取词卡文案，但
 * `contextSuggestion.reasons.*` 定义在 `player`。裸用同一个 `t` 会回退到
 * 原始 key，界面上直接显示
 * `contextSuggestion.reasons.useful_new_word`（真实截图事故）。
 *
 * 这个测试锁住「文案在哪」这一事实，防止再次放错命名空间。
 */
const REASON_CODES = [
    'due_now',
    'due_soon',
    'learning',
    'needs_reinforcement',
    'previously_looked_up',
    'saved_before',
    'exam_core',
    'stretch_word',
    'useful_new_word',
] as const;

type PlayerLocale = { contextSuggestion?: { reasons?: Record<string, string> } };

describe('contextSuggestion 文案命名空间', () => {
    it.each([
        ['zh-CN', zhPlayer],
        ['en-US', enPlayer],
    ])('%s 的 player 命名空间覆盖全部理由代码', (locale, bundle) => {
        const reasons = (bundle as PlayerLocale).contextSuggestion?.reasons ?? {};
        for (const code of REASON_CODES) {
            expect(reasons[code], `${locale} 缺少 player:contextSuggestion.reasons.${code}`).toBeTruthy();
        }
    });

    it('common 命名空间不应重复定义这些理由（避免两处漂移）', () => {
        const common = zhCommon as { contextSuggestion?: unknown };
        expect(common.contextSuggestion).toBeUndefined();
    });
});
