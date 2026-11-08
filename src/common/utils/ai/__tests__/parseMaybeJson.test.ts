import { describe, expect, it } from 'vitest';

import { parseMaybeJson } from '@/common/utils/ai/parseMaybeJson';

describe('parseMaybeJson 本地模型输出归一化', () => {
    it('对象原样返回(不再被字符串化)', () => {
        const value = { complete: true, translation: ' ok ' };
        expect(parseMaybeJson(value)).toBe(value);
    });

    it('JSON 字符串解析为对象', () => {
        expect(parseMaybeJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('非法字符串原样返回,交由上层 zod 给出明确错误', () => {
        expect(parseMaybeJson('not json')).toBe('not json');
    });

    it('非字符串非对象形态(数字/null)原样返回', () => {
        expect(parseMaybeJson(42)).toBe(42);
        expect(parseMaybeJson(null)).toBeNull();
    });
});
