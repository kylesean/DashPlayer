import { describe, expect, it } from 'vitest';

import { parseSrt, stripSubtitleEscapes } from '../parser';

describe('字幕转义残留清理', () => {
    /**
     * YouTube 的 `.en.srt` 会夹带 ASS/WebVTT 的转义序列：`\h`（硬空格）、
     * `\N`（硬换行）。它们在 SRT 里没有语义，却会被当正文渲染出来——
     * 用户看到的是「you\h know」这种莫名的脏字符与断行。
     */
    it('剥离 \\h 硬空格标记', () => {
        expect(stripSubtitleEscapes('you\\h know')).toBe('you know');
        expect(stripSubtitleEscapes('can\'t\\h sit still')).toBe("can't sit still");
    });

    it('把 \\N / \\n 硬换行转成空格，不留下断行', () => {
        expect(stripSubtitleEscapes('first line\\Nsecond line')).toBe('first line second line');
        expect(stripSubtitleEscapes('first line\\nsecond line')).toBe('first line second line');
    });

    it('真实 YouTube 样本：解析后正文不含转义残留', () => {
        const srt = [
            '1',
            '00:07:50,640 --> 00:07:57,520',
            'if society thinks ADHD is jitteriness and, you\\h',
            'know, kind of the typical little boy like our\\h\\h',
            '',
            '2',
            '00:07:57,520 --> 00:08:02,400',
            'son was bouncing around in a classroom that can\'t\\h',
            'sit still and can\'t focus.',
        ].join('\n');

        const lines = parseSrt(srt);

        expect(lines).toHaveLength(2);
        expect(lines[0].contentEn).toBe('if society thinks ADHD is jitteriness and, you know, kind of the typical little boy like our');
        expect(lines[1].contentEn).toBe("son was bouncing around in a classroom that can't sit still and can't focus.");
        // 任何一行都不该再出现反斜杠转义
        for (const line of lines) {
            expect(line.contentEn).not.toMatch(/\\[hNn]/);
        }
    });

    it('普通正文不受影响', () => {
        const srt = [
            '1',
            '00:00:01,000 --> 00:00:03,000',
            'A normal sentence with no escapes.',
        ].join('\n');

        expect(parseSrt(srt)[0].contentEn).toBe('A normal sentence with no escapes.');
    });
});
