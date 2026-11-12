import { describe, it, expect } from 'vitest';
import { parseAss } from '@/common/utils/subtitle';

describe('parseAss', () => {
    it('解析标准 ASS Dialogue 行为 SrtLine', () => {
        const ass = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour
Style: Default,Arial,24,&H00FFFFFF

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:03.50,0:00:05.00,Default,,0,0,0,,Second line`;

        const lines = parseAss(ass);
        expect(lines).toHaveLength(2);
        expect(lines[0].start).toBe(1);
        expect(lines[0].end).toBe(3);
        expect(lines[0].contentEn).toBe('Hello world');
        expect(lines[1].contentEn).toBe('Second line');
    });

    it('剥离 ASS 样式标签并处理 \\N 换行', () => {
        const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\c&H00FF00&}Hello{\\i0} world
Dialogue: 0,0:00:03.00,0:00:05.00,Default,,0,0,0,,First line\\NSecond line`;

        const lines = parseAss(ass);
        expect(lines[0].contentEn).toBe('Hello world');
        expect(lines[1].contentEn).toBe('First line Second line');
    });

    it('正文含逗号时能正确拼接', () => {
        const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello, world!`;

        const lines = parseAss(ass);
        expect(lines).toHaveLength(1);
        expect(lines[0].contentEn).toBe('Hello, world!');
    });

    it('非法时间或空正文的 Dialogue 行被跳过', () => {
        const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:03.00,Default,,0,0,0,,End before start
Dialogue: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,
Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,Valid`;

        const lines = parseAss(ass);
        expect(lines).toHaveLength(1);
        expect(lines[0].contentEn).toBe('Valid');
    });
});

describe('parseAss 自定义字段顺序', () => {
    it('按 [Events] Format 声明的字段顺序解析', () => {
        const ass = `[Script Info]
ScriptType: v4.00+

[Events]
Format: Start, End, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0:00:01.00,0:00:03.00,0,Default,,0,0,0,,Reordered fields`;

        const lines = parseAss(ass);
        expect(lines).toHaveLength(1);
        expect(lines[0].start).toBe(1);
        expect(lines[0].end).toBe(3);
        expect(lines[0].contentEn).toBe('Reordered fields');
    });

    it('未声明 Format 时按标准布局兜底', () => {
        const ass = `[Events]
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Fallback layout`;

        const lines = parseAss(ass);
        expect(lines).toHaveLength(1);
        expect(lines[0].contentEn).toBe('Fallback layout');
    });
});

describe('parseAss 晚到的 Format 声明', () => {
    it('Format 声明在 Dialogue 之后时仍按声明顺序解析全部行（两遍式）', () => {
        // 修复前：FORMAT 晚到，先出现的 Dialogue 按空布局兜底、非标准布局直接解析失败被丢弃
        const ass = `[Events]
Dialogue: Hello late format,0:00:01.00,0:00:03.00
Dialogue: Second line,0:00:04.00,0:00:06.00
Format: Text, Start, End`;

        const lines = parseAss(ass);
        expect(lines).toHaveLength(2);
        expect(lines[0].start).toBe(1);
        expect(lines[0].end).toBe(3);
        expect(lines[0].contentEn).toBe('Hello late format');
        expect(lines[1].start).toBe(4);
        expect(lines[1].contentEn).toBe('Second line');
    });
});
