import { describe, expect, it } from 'vitest';

import { segmentScenes } from '@/common/learning/sceneSegmentation';
import type { Sentence } from '@/common/types/SentenceC';

const sentence = (index: number, text: string, start: number, end: number): Sentence => ({
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

describe('segmentScenes', () => {
    it('明显静默间隔产生场景边界', () => {
        const boundaries = segmentScenes([
            sentence(0, 'The spaceship landed safely.', 0, 2),
            sentence(1, 'The crew stepped onto the surface.', 2.2, 4),
            sentence(2, 'Later that night, everything changed.', 9, 11),
        ]);

        expect(boundaries).toHaveLength(2);
        expect(boundaries[0].sentenceIndex).toBe(1);
        expect(boundaries[0].kinds).toContain('topic-shift');
        expect(boundaries[1]).toMatchObject({
            sentenceIndex: 2,
            atSec: 9,
        });
        expect(boundaries[1].kinds).toContain('time-gap');
    });

    it('话题词几乎不重合时标记 topic-shift', () => {
        const boundaries = segmentScenes([
            sentence(0, 'The spacecraft entered the orbit.', 0, 2),
            sentence(1, 'Engineers checked the spacecraft orbit.', 2, 4),
            sentence(2, 'My grandmother baked a lemon cake.', 4, 6),
            sentence(3, 'The kitchen smelled of lemon and sugar.', 6, 8),
        ], { timeGapSec: 10 });

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].sentenceIndex).toBe(2);
        expect(boundaries[0].kinds).toContain('topic-shift');
    });

    it('问句后紧跟短回应时推测说话人切换', () => {
        const boundaries = segmentScenes([
            sentence(0, 'The journey starts tomorrow morning.', 0, 2),
            sentence(1, 'Are you ready for the journey?', 2, 4),
            sentence(2, 'Yes.', 4, 4.6),
        ], { timeGapSec: 10 });

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds).toContain('speaker-shift');
        expect(boundaries[0].confidence).toBeLessThanOrEqual(1);
    });

    it('连续同话题且无静默时不产生边界', () => {
        const boundaries = segmentScenes([
            sentence(0, 'The journey begins at the station.', 0, 2),
            sentence(1, 'The journey continues through the valley.', 2, 4),
            sentence(2, 'The journey ends at the station.', 4, 6),
        ], { timeGapSec: 10 });

        expect(boundaries).toEqual([]);
    });

    it('少于两句时没有边界', () => {
        expect(segmentScenes([])).toEqual([]);
        expect(segmentScenes([sentence(0, 'hello', 0, 1)])).toEqual([]);
    });

    it('韵律突变点标记 prosody-shift，语速比音量置信度更高', () => {
        const boundaries = segmentScenes([
            sentence(0, 'The journey begins at the station.', 0, 2),
            sentence(1, 'The journey continues through the valley.', 2, 4),
            sentence(2, 'The journey ends at the station.', 4, 6),
        ], {
            timeGapSec: 10,
            prosodyShifts: [
                { sentenceIndex: 1, atSec: 2, reason: 'rate', detail: 2.1 },
                { sentenceIndex: 2, atSec: 4, reason: 'energy', detail: 11 },
            ],
        });

        expect(boundaries).toHaveLength(2);
        expect(boundaries[0].kinds).toContain('prosody-shift');
        expect(boundaries[0].confidence).toBe(0.7);
        expect(boundaries[1].confidence).toBe(0.6);
    });

    it('韵律信号与文本信号同时命中时合并到同一边界', () => {
        const boundaries = segmentScenes([
            sentence(0, 'The spacecraft entered the orbit.', 0, 2),
            sentence(1, 'Engineers checked the spacecraft orbit.', 2, 4),
            sentence(2, 'My grandmother baked a lemon cake.', 4, 6),
            sentence(3, 'The kitchen smelled of lemon and sugar.', 6, 8),
        ], {
            timeGapSec: 10,
            prosodyShifts: [{ sentenceIndex: 2, atSec: 4, reason: 'rate', detail: 1.8 }],
        });

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds).toContain('topic-shift');
        expect(boundaries[0].kinds).toContain('prosody-shift');
    });

    it('同一句的多个韵律突变只标记一次', () => {
        const boundaries = segmentScenes([
            sentence(0, 'The journey begins at the station.', 0, 2),
            sentence(1, 'The journey continues through the valley.', 2, 4),
        ], {
            timeGapSec: 10,
            prosodyShifts: [
                { sentenceIndex: 1, atSec: 2, reason: 'rate', detail: 2 },
                { sentenceIndex: 1, atSec: 2, reason: 'energy', detail: 12 },
            ],
        });

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds.filter((kind) => kind === 'prosody-shift')).toHaveLength(1);
    });
});
