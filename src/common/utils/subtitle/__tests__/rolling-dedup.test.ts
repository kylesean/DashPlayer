import { describe, expect, it } from 'vitest';

import type { SrtLine } from '@/common/utils/subtitle/types';
import {
    dedupeRollingLines,
    dropLeadingWords,
    rollingOverlapWordCount,
} from '@/common/utils/subtitle/rolling-dedup';

/** 构造测试用字幕行。 */
const line = (index: number, start: number, end: number, contentEn: string): SrtLine => ({
    index,
    start,
    end,
    contentEn,
    contentZh: '',
});

describe('滚动字幕去重', () => {
    it('识别后一条 cue 重复前一条尾巴的词数', () => {
        expect(rollingOverlapWordCount(
            'Today, you and I are going to talk about',
            'going to talk about a topic',
        )).toBe(4);
    });

    it('忽略大小写与标点差异', () => {
        expect(rollingOverlapWordCount('we talk About it', 'about it. And then')).toBe(2);
    });

    it('单个词的重叠不算重复（避免误删真实内容）', () => {
        expect(rollingOverlapWordCount('I think that', 'that I think')).toBe(0);
        expect(rollingOverlapWordCount('give me a', 'a better way')).toBe(0);
    });

    it('无重叠时返回 0', () => {
        expect(rollingOverlapWordCount('hello there', 'completely different')).toBe(0);
    });

    it('从文本头部剥掉指定词数并保留剩余标点', () => {
        expect(dropLeadingWords('going to talk about a topic', 3)).toBe('about a topic');
        expect(dropLeadingWords('one two', 2)).toBe('');
        expect(dropLeadingWords('unchanged', 0)).toBe('unchanged');
    });

    it('相邻行滚动重复时只保留新增内容', () => {
        const result = dedupeRollingLines([
            line(1, 0, 2, 'Today, you and I are going to talk about'),
            line(2, 1.8, 4, 'going to talk about a topic that I get questions on'),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0].contentEn).toBe('Today, you and I are going to talk about');
        expect(result[1].contentEn).toBe('a topic that I get questions on');
        expect(result[1].index).toBe(2);
    });

    it('整行都是重复内容时丢弃该行并把时长并入前一行', () => {
        const result = dedupeRollingLines([
            line(1, 0, 2, 'and that is the whole point'),
            line(2, 2, 3.5, 'the whole point'),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].contentEn).toBe('and that is the whole point');
        expect(result[0].end).toBe(3.5);
    });

    it('非相邻的重复短语不会被误删', () => {
        const result = dedupeRollingLines([
            line(1, 0, 1, 'I really mean it'),
            line(2, 1, 2, 'and then something else'),
            line(3, 2, 3, 'I really mean it'),
        ]);
        expect(result).toHaveLength(3);
    });

    it('去重后 index 连续重编号', () => {
        const result = dedupeRollingLines([
            line(1, 0, 1, 'one two three'),
            line(2, 1, 2, 'two three'),
            line(3, 2, 3, 'four five'),
        ]);
        expect(result.map((item) => item.index)).toEqual([1, 2]);
    });
});

describe('dropLeadingWords 与归一化词口径一致', () => {
    it('纯标点 token 不占词数：行首孤立引号被跳过而不是当成词剥掉', () => {
        // 重叠词数按归一化词计（said that = 2），原始 token 里行首的 `"` 是纯标点
        expect(dropLeadingWords('" said that hello world.', 2)).toBe('hello world.');
    });

    it('词尾标点正常按词剥除', () => {
        expect(dropLeadingWords('said that, hello world', 2)).toBe('hello world');
    });
});
