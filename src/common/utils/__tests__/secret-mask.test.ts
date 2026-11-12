import { describe, expect, it } from 'vitest';

import { maskSecret } from '../secret-mask';

describe('maskSecret', () => {
    it('未配置时返回空串，不伪造占位符', () => {
        expect(maskSecret('')).toBe('');
        expect(maskSecret('   ')).toBe('');
        expect(maskSecret(null)).toBe('');
        expect(maskSecret(undefined)).toBe('');
    });

    it('正常密钥只露末四位', () => {
        const masked = maskSecret('sk-proj-abcdefgh1234');
        expect(masked).toBe('••••1234');
        expect(masked).not.toContain('abcdefgh');
    });

    it('短密钥整体遮罩：末四位可能已是很大比例，露出去就没有脱敏意义', () => {
        expect(maskSecret('abc123')).toBe('••••');
        expect(maskSecret('abcdefg')).toBe('••••');
    });

    it('恰好 8 位开始露末四位', () => {
        expect(maskSecret('abcdefgh')).toBe('••••efgh');
    });
});
