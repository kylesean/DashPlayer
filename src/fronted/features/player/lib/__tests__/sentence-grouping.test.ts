import { describe, expect, it } from 'vitest';

import type { Sentence } from '@/common/types/SentenceC';
import {
    findSentenceBlock,
    groupSentencesIntoBlocks,
    selectVisibleSentences,
} from '@/fronted/features/player/lib/sentence-grouping';

/** 构造测试用的字幕行；文本即断句依据，时间为秒。 */
const line = (index: number, text: string, start: number, end: number): Sentence => ({
    fileHash: 'hash',
    index,
    start,
    end,
    adjustedStart: null,
    adjustedEnd: null,
    text,
    textZH: '',
    key: `hash-${index}`,
    transGroup: 1,
    translationKey: `hash:${index}`,
    struct: { original: text, blocks: [] },
});

describe('字幕意群归并', () => {
    it('仅当前句模式只返回当前句', () => {
        const list = [line(0, 'A.', 0, 1), line(1, 'B.', 1, 2), line(2, 'C.', 2, 3)];
        expect(selectVisibleSentences(list, list[1], 'sentence').map((s) => s.text)).toEqual(['B.']);
    });

    it('带上下文模式返回前后各一句', () => {
        const list = [line(0, 'A.', 0, 1), line(1, 'B.', 1, 2), line(2, 'C.', 2, 3)];
        expect(selectVisibleSentences(list, list[1], 'context').map((s) => s.text)).toEqual(['A.', 'B.', 'C.']);
    });

    it('上下文模式在首尾句处自动收窄，不越界', () => {
        const list = [line(0, 'A.', 0, 1), line(1, 'B.', 1, 2), line(2, 'C.', 2, 3)];
        expect(selectVisibleSentences(list, list[0], 'context').map((s) => s.text)).toEqual(['A.', 'B.']);
        expect(selectVisibleSentences(list, list[2], 'context').map((s) => s.text)).toEqual(['B.', 'C.']);
    });

    it('当前句不在列表中时退化为只显示它', () => {
        const list = [line(0, 'A.', 0, 1)];
        const orphan = line(9, 'Z.', 9, 10);
        expect(selectVisibleSentences(list, orphan, 'context').map((s) => s.text)).toEqual(['Z.']);
    });

    it('碎片行在无句末标点且间隔小时合并成一个意群', () => {
        const blocks = groupSentencesIntoBlocks([
            line(0, 'I think that', 0, 1.2),
            line(1, 'you know when', 1.3, 2.4),
            line(2, 'you look at it', 2.5, 3.6),
        ]);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].sentences).toHaveLength(3);
        expect(blocks[0].start).toBe(0);
        expect(blocks[0].end).toBe(3.6);
        expect(blocks[0].repr.index).toBe(0);
    });

    it('句末标点收束后另起一块', () => {
        const blocks = groupSentencesIntoBlocks([
            line(0, 'This is done.', 0, 1.5),
            line(1, 'Next one starts here', 1.6, 3.0),
        ]);
        expect(blocks).toHaveLength(2);
        expect(blocks[0].sentences.map((s) => s.index)).toEqual([0]);
        expect(blocks[1].sentences.map((s) => s.index)).toEqual([1]);
    });

    it('说话人明显停顿（间隔 ≥ 0.8s）时封块，无标点也尊重停顿', () => {
        const blocks = groupSentencesIntoBlocks([
            line(0, 'first fragment', 0, 1.0),
            line(1, 'after a long pause', 2.5, 4.0),
        ]);
        expect(blocks).toHaveLength(2);
    });

    it('块内字符数达到上限时强制封块，防止无标点字幕归并出巨块', () => {
        const longText = 'a'.repeat(120);
        const blocks = groupSentencesIntoBlocks([
            line(0, longText, 0, 1.0),
            line(1, longText, 1.1, 2.0),
        ]);
        expect(blocks).toHaveLength(2);
        expect(blocks[0].charCount).toBe(120);
    });

    it('块内字符数恰好不超上限时继续合并', () => {
        const blocks = groupSentencesIntoBlocks([
            line(0, 'a'.repeat(100), 0, 1.0),
            line(1, 'b'.repeat(100), 1.1, 2.0),
        ]);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].charCount).toBe(200);
    });

    it('行区间重叠（间隔为负）视为连续，正常归并', () => {
        const blocks = groupSentencesIntoBlocks([
            line(0, 'overlapping lines', 0, 2.0),
            line(1, 'still the same thought', 1.9, 3.0),
        ]);
        expect(blocks).toHaveLength(1);
    });

    it('单行视频每行即一块，找不到所属块时返回 null', () => {
        const blocks = groupSentencesIntoBlocks([line(0, 'only one.', 0, 1.0)]);
        expect(blocks).toHaveLength(1);
        expect(findSentenceBlock(blocks, line(9, 'other.', 5, 6))).toBeNull();
        expect(findSentenceBlock(blocks, null)).toBeNull();
    });

    it('空字幕返回空数组', () => {
        expect(groupSentencesIntoBlocks([])).toEqual([]);
    });

    it('findSentenceBlock 按句子 key 定位所属块', () => {
        const blocks = groupSentencesIntoBlocks([
            line(0, 'merged a', 0, 1.0),
            line(1, 'merged b', 1.1, 2.0),
            line(2, 'Done. next', 2.2, 3.0),
        ]);
        const target = blocks[0].sentences[1];
        expect(findSentenceBlock(blocks, target)?.repr.index).toBe(0);
    });
});
