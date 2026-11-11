import { describe, expect, it } from 'vitest';
import {
    DEFAULT_INNER_STAGE_SIZE,
    DEFAULT_INNER_SUBTITLE_SIZE,
    getDefaultInnerSplit,
    MAX_INNER_SUBTITLE_SIZE,
} from '../splitLayoutDefaults';

describe('getDefaultInnerSplit', () => {
    it('uses the 75 / 25 baseline for the default font without sentence blocks', () => {
        expect(getDefaultInnerSplit('fontSizeMedium', false)).toEqual({
            stage: DEFAULT_INNER_STAGE_SIZE,
            subtitle: DEFAULT_INNER_SUBTITLE_SIZE,
        });
    });

    it('grows the subtitle for large fonts and sentence blocks', () => {
        expect(getDefaultInnerSplit('fontSizeLarge', false)).toEqual({ stage: 72, subtitle: 28 });
        expect(getDefaultInnerSplit('fontSizeMedium', true)).toEqual({ stage: 72, subtitle: 28 });
        expect(getDefaultInnerSplit('fontSizeLarge', true)).toEqual({ stage: 69, subtitle: 31 });
    });

    it('never lets the subtitle exceed its cap', () => {
        expect(getDefaultInnerSplit('fontSizeLarge', true).subtitle).toBe(31);
        expect(getDefaultInnerSplit('fontSizeLarge', true).subtitle).toBeLessThanOrEqual(
            MAX_INNER_SUBTITLE_SIZE,
        );
    });

    it('always totals 100 percent', () => {
        for (const fontSize of ['fontSizeSmall', 'fontSizeMedium', 'fontSizeLarge', undefined]) {
            for (const sentenceBlockMode of [false, true]) {
                const { stage, subtitle } = getDefaultInnerSplit(fontSize, sentenceBlockMode);
                expect(stage + subtitle).toBe(100);
            }
        }
    });
});
