import { beforeEach, describe, expect, it } from 'vitest';

import {
    resetEncounterThrottle,
    shouldRecordEncounter,
} from '../encounterThrottle';

describe('shouldRecordEncounter', () => {
    beforeEach(() => {
        resetEncounterThrottle();
    });

    it('首次悬停允许上报，窗口内重复悬停被抑制', () => {
        expect(shouldRecordEncounter('hover', 'journey:hash:1', 1_000)).toBe(true);
        expect(shouldRecordEncounter('hover', 'journey:hash:1', 30_000)).toBe(false);
    });

    it('超过窗口后允许再次上报', () => {
        expect(shouldRecordEncounter('hover', 'journey:hash:1', 1_000)).toBe(true);
        expect(shouldRecordEncounter('hover', 'journey:hash:1', 61_001)).toBe(true);
    });

    it('不同词或不同句各自独立节流', () => {
        expect(shouldRecordEncounter('hover', 'journey:hash:1', 1_000)).toBe(true);
        expect(shouldRecordEncounter('hover', 'journey:hash:2', 1_000)).toBe(true);
        expect(shouldRecordEncounter('hover', 'station:hash:1', 1_000)).toBe(true);
    });

    it('打开浮层使用更短的 5 秒窗口', () => {
        expect(shouldRecordEncounter('open', 'journey', 1_000)).toBe(true);
        expect(shouldRecordEncounter('open', 'journey', 5_999)).toBe(false);
        expect(shouldRecordEncounter('open', 'journey', 6_000)).toBe(true);
    });
});
