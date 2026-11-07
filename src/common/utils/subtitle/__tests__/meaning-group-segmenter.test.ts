import { describe, expect, it } from 'vitest';

import type { SrtLine } from '@/common/utils/subtitle/types';
import { resegmentIntoMeaningGroups } from '@/common/utils/subtitle/meaning-group-segmenter';

/** 构造测试用字幕行。 */
const line = (index: number, start: number, end: number, contentEn: string, contentZh = ''): SrtLine => ({
    index,
    start,
    end,
    contentEn,
    contentZh,
});

describe('意群重切分', () => {
    it('无句末标点的重叠碎片归并成一个意群', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 5.96, 'Today, you and I are going to talk about'),
            line(2, 3.88, 9.44, 'a topic that I get a ton of questions'),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].contentEn).toBe('Today, you and I are going to talk about a topic that I get a ton of questions');
        expect(result[0].start).toBe(0);
        expect(result[0].end).toBe(9.44);
    });

    it('cue 内句末标点处拆分，时间按字符占比插值且严格递增', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 10, 'This is done. Next one starts here and keeps going'),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0].contentEn).toBe('This is done.');
        expect(result[1].contentEn).toBe('Next one starts here and keeps going');
        // 插值：13/50 与 10 秒 → 第一段结束 ≈ 2.6s
        expect(result[0].start).toBe(0);
        expect(result[0].end).toBeCloseTo(2.6, 1);
        expect(result[1].end).toBe(10);
        // cue 内相邻段的边界恰好相接是正常形态（同一时间点既是前段终点又是后段起点）
        expect(result[0].end).toBeLessThanOrEqual(result[1].start);
    });

    it('跨 cue 的句子拼接后按标点收束，后续句子另起', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 5.96, 'Today, you and I are going to talk about'),
            line(2, 3.88, 9.44, 'a topic that I get a ton of questions'),
            line(3, 5.4, 9.2, 'about. Whether you like it or not'),
        ]);
        expect(result[0].contentEn).toBe('Today, you and I are going to talk about a topic that I get a ton of questions about.');
        expect(result).toHaveLength(2);
        expect(result[1].contentEn).toBe('Whether you like it or not');
        // 时间轴整体单调
        for (let i = 1; i < result.length; i++) {
            expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].end);
        }
    });

    it('`>>` 说话人标记强制切分', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 4, 'What does it mean? >> Well, it is easy'),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0].contentEn).toBe('What does it mean?');
        expect(result[1].contentEn).toBe('Well, it is easy');
    });

    it('cue 间隔 ≥ 0.8s 时封句，无标点也尊重停顿', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 1.0, 'first fragment'),
            line(2, 2.5, 4.0, 'after a long pause'),
        ]);
        expect(result).toHaveLength(2);
    });

    it('缓冲超过 250 字符仍无标点时在 cue 边界强制封句', () => {
        const longA = 'a'.repeat(140);
        const longB = 'b'.repeat(140);
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 2, longA),
            line(2, 2.1, 4, longB),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0].contentEn).toBe(longA);
    });

    it('双语字幕原样返回，不做重切分', () => {
        const input = [
            line(1, 0, 5, 'Today we talk', '今天我们聊聊'),
            line(2, 5.1, 9, 'about money', '聊聊钱'),
        ];
        expect(resegmentIntoMeaningGroups(input)).toEqual(input);
    });

    it('单行无标点字幕恒等返回', () => {
        const input = [line(1, 0, 5, 'just one line without punctuation')];
        expect(resegmentIntoMeaningGroups(input)).toEqual(input);
    });

    it('真实 YouTube 样本：碎片句跨 cue 拼回完整意群', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 5.96, 'Today, you and I are going to talk about'),
            line(2, 3.88, 9.44, 'a topic that I get a ton of questions'),
            line(3, 5.4, 9.2, 'about. Whether you are in a job right now'),
            line(4, 7.9, 11.0, 'and you want to make more money'),
        ]);
        expect(result[0].contentEn).toBe('Today, you and I are going to talk about a topic that I get a ton of questions about.');
        expect(result[0].start).toBe(0);
        // 时间轴严格递增（createSrtLine 的校验口径）
        for (let i = 0; i < result.length; i++) {
            expect(result[i].end).toBeGreaterThan(result[i].start);
            if (i > 0) {
                expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].end);
            }
        }
    });
});
