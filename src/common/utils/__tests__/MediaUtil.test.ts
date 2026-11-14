import { describe, expect, it } from 'vitest';

import MediaUtil from '@/common/utils/MediaUtil';

describe('MediaUtil.formatDisplayTitle', () => {
    it.each([
        ['', ''],
        ['   ', ''],
        ['Andrew Ng: AI Opportunities [o-wv_szZ0V0].mp4', 'Andrew Ng: AI Opportunities'],
        ['A Day in the Lizard Village, UK [KRH8bRvrU6Q].webm', 'A Day in the Lizard Village, UK'],
        ['How to Get More Out of Life [IJq-SLEjdsk]', 'How to Get More Out of Life'],
        ['Inception (2010) [1080p].mkv', 'Inception (2010) [1080p]'],
        ['Dr. House S01E01.mp4', 'Dr. House S01E01'],
        ['[o-wv_szZ0V0].mp4', '[o-wv_szZ0V0]'],
    ])('formats %j -> %j', (input, expected) => {
        expect(MediaUtil.formatDisplayTitle(input)).toBe(expected);
    });
});
