import { describe, expect, it } from 'vitest';

import { alignPracticeTokens, normalizePracticeTokens } from '@/common/utils/practice/pronunciationScoring';

describe('alignPracticeTokens 词级对齐评分', () => {
    it('完全一致(大小写/标点差异被规范化)得满分', () => {
        const result = alignPracticeTokens('Hello world.', 'hello world!');
        expect(result.score).toBe(100);
        expect(result.words.map((w) => w.status)).toEqual(['match', 'match']);
    });

    it('听岔一个音判为 sub,按字符相似度折算分数', () => {
        const result = alignPracticeTokens('I like green apples', 'I like grain apples');
        // green→grain 编辑距离 2,相似度 0.6;(3 + 0.5×0.6) / 4 × 100 ≈ 83
        expect(result.score).toBe(83);
        const sub = result.words.find((w) => w.status === 'sub');
        expect(sub?.expected).toBe('green');
        expect(sub?.heard).toBe('grain');
        expect(sub?.similarity).toBe(0.6);
    });

    it('漏词判为 missing 且扣分', () => {
        const result = alignPracticeTokens('I like green apples', 'I like apples');
        expect(result.score).toBe(75);
        const missing = result.words.find((w) => w.status === 'missing');
        expect(missing?.expected).toBe('green');
        expect(missing?.heard).toBeNull();
    });

    it('多说的词判为 extra 且追加在词序中,不破坏满分', () => {
        const result = alignPracticeTokens('I like apples', 'I really like apples');
        expect(result.score).toBe(100);
        const extra = result.words.find((w) => w.status === 'extra');
        expect(extra?.heard).toBe('really');
    });

    it('完全没说出来(空产出)得 0 分且全部 missing', () => {
        const result = alignPracticeTokens('hello world', '');
        expect(result.score).toBe(0);
        expect(result.words.map((w) => w.status)).toEqual(['missing', 'missing']);
    });

    it('原句为空时按有无产出判分', () => {
        expect(alignPracticeTokens('', 'hello').score).toBe(0);
        expect(alignPracticeTokens('', '').score).toBe(100);
    });

    it('缩读两侧形态一致时天然对齐(ASR 写 don\'t 或 don t 同分)', () => {
        const a = alignPracticeTokens("don't worry be happy", "don't worry be happy");
        const b = alignPracticeTokens("don't worry be happy", 'don t worry be happy');
        expect(a.score).toBe(100);
        expect(b.score).toBe(100);
    });

    it('normalizePracticeTokens 只留词 token 且小写', () => {
        expect(normalizePracticeTokens("It's fine, don't worry.")).toEqual(['it', 's', 'fine', 'don', 't', 'worry']);
    });
});
