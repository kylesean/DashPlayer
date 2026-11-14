import { describe, expect, it } from 'vitest';
import {
    DEFAULT_INNER_STAGE_SIZE,
    DEFAULT_INNER_SUBTITLE_SIZE,
    getDefaultInnerSplit,
    MAX_INNER_SUBTITLE_SIZE,
} from '../splitLayoutDefaults';

describe('getDefaultInnerSplit', () => {
    it('gives the subtitle its sentence-block share on top of the 75 / 25 baseline', () => {
        expect(getDefaultInnerSplit('fontSizeMedium')).toEqual({
            stage: DEFAULT_INNER_STAGE_SIZE - 3,
            subtitle: DEFAULT_INNER_SUBTITLE_SIZE + 3,
        });
    });

    it('grows the subtitle further for large fonts', () => {
        expect(getDefaultInnerSplit('fontSizeLarge')).toEqual({ stage: 69, subtitle: 31 });
    });

    it('never lets the subtitle exceed its cap', () => {
        expect(getDefaultInnerSplit('fontSizeLarge').subtitle).toBe(31);
        expect(getDefaultInnerSplit('fontSizeLarge').subtitle).toBeLessThanOrEqual(
            MAX_INNER_SUBTITLE_SIZE,
        );
    });

    it.each(['fontSizeSmall', 'fontSizeMedium', 'fontSizeLarge', undefined] as const)(
        'always totals 100 percent for %s',
        (fontSize) => {
            const { stage, subtitle } = getDefaultInnerSplit(fontSize);
            expect(stage + subtitle).toBe(100);
        },
    );
});
