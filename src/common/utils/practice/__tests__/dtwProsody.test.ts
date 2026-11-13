import { describe, expect, it } from 'vitest';
import { compareProsodyDtw, downsampleEnvelope, extractEnergyEnvelope } from '@/common/utils/practice/dtwProsody';

const makeTonePcm = (sampleRate: number, segments: Array<{ durationSec: number; amp: number }>) => {
    const totalSamples = Math.round(segments.reduce((acc, s) => acc + s.durationSec, 0) * sampleRate);
    const samples = new Int16Array(totalSamples);
    let offset = 0;
    for (const seg of segments) {
        const count = Math.round(seg.durationSec * sampleRate);
        for (let i = 0; i < count && offset + i < totalSamples; i += 1) {
            samples[offset + i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * seg.amp * 16000);
        }
        offset += count;
    }
    return { samples, sampleRate };
};

describe('dtwProsody', () => {
    it('同节奏但整体略慢的录音仍能通过 DTW 对齐拿到高贴合度', () => {
        const ref = makeTonePcm(16000, [
            { durationSec: 0.3, amp: 0.9 },
            { durationSec: 0.2, amp: 0.02 },
            { durationSec: 0.4, amp: 0.7 },
        ]);
        const user = makeTonePcm(16000, [
            { durationSec: 0.4, amp: 0.85 },
            { durationSec: 0.25, amp: 0.02 },
            { durationSec: 0.5, amp: 0.65 },
        ]);

        const res = compareProsodyDtw(ref, user);
        expect(res).not.toBeNull();
        expect(res!.prosodyScore).toBeGreaterThanOrEqual(70);
        expect(res!.referenceEnvelope).toHaveLength(24);
        expect(res!.userEnvelope).toHaveLength(24);
    });

    it('静音样本返回 null', () => {
        const silent = { samples: new Int16Array(16000), sampleRate: 16000 };
        expect(extractEnergyEnvelope(silent)).toEqual([]);
        expect(downsampleEnvelope([], 24)).toEqual([]);
        expect(compareProsodyDtw(silent, silent)).toBeNull();
    });
});
