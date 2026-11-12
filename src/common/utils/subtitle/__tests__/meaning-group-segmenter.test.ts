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

    it('cue 内句末标点处拆分，时间按音节权重插值且严格递增', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 10, 'This is done. Next one starts here and keeps going'),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0].contentEn).toBe('This is done.');
        expect(result[1].contentEn).toBe('Next one starts here and keeps going');
        // 插值按音节数而非字符数：This(1)+is(1)+done(1)=3，
        // 后半段 Next(1)+one(1)+starts(1)+here(1)+and(1)+keeps(1)+going(2)=8，
        // 3/(3+8)×10 ≈ 2.7s。旧实现的字符占比会得到 2.6s，两者都落在合理区间。
        expect(result[0].start).toBe(0);
        expect(result[0].end).toBeGreaterThan(2.2);
        expect(result[0].end).toBeLessThan(3.4);
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

    it('重叠 cue 终点非单调时归并不收缩结束时间，句尾语音不被截断', () => {
        // 插话/音效行完全落在长对白行时间区间内（粉丝字幕常见），归并后
        // 意群终点必须取 max：单句循环与 AutoPause 以该值为右边界
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 10, 'hello there friend'),
            line(2, 1, 2, 'ok'),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].contentEn).toBe('hello there friend ok');
        expect(result[0].end).toBe(10);
    });

    /**
     * 滚动字幕的 `end` 是「滚出屏幕」的时刻，不是「说完」的时刻：
     * 实测 99.6% 的 cue 结束时间都晚于下一条 cue 的开始时间，平均多 2.12s。
     * 拿它当发声时长会把词时间按比例拉长，整句右移——用户看到「字幕还在，
     * 音频已经下一句了」。这里钉住截断行为。
     */
    it('滚动重叠的 cue 用下一条起点截断发声窗口，不把滚动尾巴算进句长', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 10, 'the first sentence ends here.'),
            // 滚动重叠：后一条压进前一条尾巴，且延伸到更后面
            line(2, 4, 12, 'And the second sentence starts.'),
        ]);

        // 第一句的真实发声窗口应是 0~4，而不是 0~10
        expect(result[0].contentEn).toBe('the first sentence ends here.');
        expect(result[0].end).toBeLessThanOrEqual(4.01);
        // 第二句从 4 开始，两行不重叠
        expect(result[1].start).toBeGreaterThanOrEqual(result[0].end - 0.01);
    });

    it('插话嵌套不截断主句：后一条完全落在前一条区间内', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 10, 'a long sentence that keeps going'),
            // 插话：完全落在主句区间内
            line(2, 2, 4, 'mm-hmm'),
        ]);

        // 主句终点不能被插话压短
        const main = result.find((l) => l.contentEn.includes('keeps going'));
        expect(main?.end).toBe(10);
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

    it('长句在自然意群边界切分，不把句子拦腰斩断（真实 5yCqhY1D-VE 案例）', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 999.92, 1000.32, '>> Okay. How do you use topic to help you be a better communicator? Anyone who\'s'),
            line(2, 998.399, 1003.519, 'going out on a date is already thinking about what they\'re going to wear, how'),
            line(3, 1002.0, 1005.839, 'they\'re going to do their hair, what makeup they\'re going to put on, where'),
            line(4, 1004.639, 1008.16, 'they\'re going to what restaurant they\'re going to meet at, what activity they\'re'),
            line(5, 1007.279, 1010.56, 'going to do.'),
        ]);
        // 断点必须落在标点/停顿等自然边界，不能停在悬空虚词上。
        for (const item of result) {
            expect(item.contentEn.endsWith('going')).toBe(false);
            expect(item.contentEn.endsWith('to')).toBe(false);
            expect(item.contentEn.endsWith('what')).toBe(false);
            expect(item.contentEn.endsWith('their')).toBe(false);
        }
        // 所有原文词都被保留，没有丢词或重复。
        const joined = result.map((item) => item.contentEn).join(' ');
        for (const word of ['Okay.', 'communicator?', 'hair,', 'meet', 'at,', 'activity', 'do.']) {
            expect(joined).toContain(word);
        }
        // 时间轴严格递增且不重叠。
        for (let i = 1; i < result.length; i++) {
            expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].end);
        }
        expect(result[result.length - 1].end).toBeCloseTo(1010.56, 2);
    });

    it('超长无标点文本在硬上限内切分，且不丢词', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 2, 'Yes, ' + 'a'.repeat(230)),
            line(2, 2.1, 4, 'b'.repeat(140)),
        ]);
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result.map((item) => item.contentEn).join(' ')).toContain('b'.repeat(140));
        for (const item of result) {
            expect(item.contentEn.length).toBeLessThanOrEqual(230);
        }
        for (let i = 1; i < result.length; i++) {
            expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].end);
        }
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

    it('滚动重复尾巴被去掉，不会拼出重复文本', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 3, 'Today, you and I are going to talk about'),
            line(2, 2.5, 5.5, 'are going to talk about a topic that I get'),
            line(3, 5.0, 8.0, 'a topic that I get a ton of questions about.'),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].contentEn).toBe(
            'Today, you and I are going to talk about a topic that I get a ton of questions about.',
        );
        // 重复内容不能被拼成 "about are going to talk about"。
        expect(result[0].contentEn).not.toContain('about are going');
    });

    it('行尾不落在虚词上：介词处断句会被动态规划绕开', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 2, 'The thing that I really want to talk'),
            line(2, 2.1, 4, 'about is how we learn languages.'),
        ]);
        for (const item of result) {
            expect(item.contentEn.endsWith(' talk')).toBe(false);
            expect(item.contentEn.endsWith(' to')).toBe(false);
            expect(item.contentEn.endsWith(' the')).toBe(false);
        }
        expect(result.map((item) => item.contentEn).join(' ')).toContain(
            'talk about is how we learn languages.',
        );
    });

    it('每条 cue 都是完整句时保持一句一行', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 2, 'This is the first sentence.'),
            line(2, 3, 5, 'And this is the second one.'),
            line(3, 6, 8, 'Finally, the third.'),
        ]);
        expect(result.map((item) => item.contentEn)).toEqual([
            'This is the first sentence.',
            'And this is the second one.',
            'Finally, the third.',
        ]);
    });

    it('说话人切换处的 `>>` 被剥离且强制分句', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 3, 'What do you think about that? >> I think'),
            line(2, 3, 6, 'it is a terrible idea.'),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0].contentEn).toBe('What do you think about that?');
        expect(result[1].contentEn).toBe('I think it is a terrible idea.');
        expect(result.some((item) => item.contentEn.includes('>>'))).toBe(false);
    });

    it('纯背景音标记行被丢弃，不参与断句', () => {
        const result = resegmentIntoMeaningGroups([
            line(1, 0, 1, '[Music]'),
            line(2, 1.5, 3, 'Welcome back to the show.'),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].contentEn).toBe('Welcome back to the show.');
    });

    it('超长单条 cue 按字符上限切分，不会逐词拆碎', () => {
        const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
        const result = resegmentIntoMeaningGroups([line(1, 0, 30, text)]);
        expect(result.length).toBeGreaterThan(1);
        expect(result.length).toBeLessThan(10);
        for (const item of result) {
            expect(item.contentEn.length).toBeLessThanOrEqual(220);
        }
        expect(result.map((item) => item.contentEn).join(' ')).toBe(text);
    });
});
