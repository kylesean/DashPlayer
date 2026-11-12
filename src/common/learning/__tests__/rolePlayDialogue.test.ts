import { describe, expect, it } from 'vitest';

import {
    findDialogueLine,
    isUsablePartnerLine,
    normalizeDialogueText,
    pickNextPartnerLine,
    resolveNextPartnerLine,
    type RolePlaySubtitleLine,
} from '@/common/learning/rolePlayDialogue';

const line = (index: number, text: string): RolePlaySubtitleLine => ({ index, text });

const LINES: RolePlaySubtitleLine[] = [
    line(0, 'Hi.'),
    line(1, 'It was a long journey home.'),
    line(2, 'Mmm.'),
    line(3, 'I bet you were exhausted after that drive.'),
    line(4, 'Did you stop anywhere on the way?'),
    line(5, 'We pulled over for coffee twice.'),
];

describe('rolePlayDialogue', () => {
    it('归一化只处理大小写、引号与空白', () => {
        expect(normalizeDialogueText('  “It  was a JOURNEY.” ')).toBe('it was a journey.');
    });

    it('过短或没有内容词的一行不作为对方台词', () => {
        expect(isUsablePartnerLine('Hi.')).toBe(false);
        expect(isUsablePartnerLine('Mmm.')).toBe(false);
        expect(isUsablePartnerLine('It was a long journey home.')).toBe(true);
    });

    it('按归一化文本精确定位，找不到时返回 -1', () => {
        expect(findDialogueLine(LINES, 'it was a long journey home.')).toBe(1);
        // 标点不同视为不同台词：定位必须逐字可靠，不能模糊匹配。
        expect(findDialogueLine(LINES, 'it was a long journey home')).toBe(-1);
        expect(findDialogueLine(LINES, 'A completely different line.')).toBe(-1);
    });

    it('跳过不可用行并沿字幕向后挑选', () => {
        const next = pickNextPartnerLine(LINES, 1);
        expect(next?.text).toBe('I bet you were exhausted after that drive.');
    });

    it('已经用过的台词不会重复出现', () => {
        const next = pickNextPartnerLine(
            LINES,
            1,
            ['I bet you were exhausted after that drive.'],
        );
        expect(next?.text).toBe('Did you stop anywhere on the way?');
    });

    it('开场白之后没有可用行时对话自然结束', () => {
        const short: RolePlaySubtitleLine[] = [
            line(0, 'It was a long journey home.'),
            line(1, 'Mmm.'),
        ];
        const result = resolveNextPartnerLine(short, 'It was a long journey home.', []);
        expect(result.next).toBeNull();
        expect(result.canContinue).toBe(false);
    });

    it('开场白不在字幕里时不做猜测', () => {
        const result = resolveNextPartnerLine(LINES, 'Not in this subtitle.', []);
        expect(result.next).toBeNull();
        expect(result.canContinue).toBe(false);
    });

    it('已用台词推进后从更后面继续', () => {
        const first = resolveNextPartnerLine(LINES, 'It was a long journey home.', []);
        expect(first.next?.index).toBe(3);

        const second = resolveNextPartnerLine(
            LINES,
            'It was a long journey home.',
            ['I bet you were exhausted after that drive.'],
        );
        expect(second.next?.index).toBe(4);
    });
});
