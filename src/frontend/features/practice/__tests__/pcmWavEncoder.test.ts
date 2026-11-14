import { describe, expect, it } from 'vitest';
import { encodeResampledPcm16Wav, normalizePcmPeak } from '@/frontend/features/practice/lib/pcmWavEncoder';
import { parsePcm16WavHeader } from '@/common/utils/audio/wav';

describe('pcmWavEncoder', () => {
    it('把 48kHz Float32 PCM 重采样并封装为合法 16kHz 单声道 16-bit WAV', () => {
        const chunk = new Float32Array(4800); // 100ms @ 48kHz
        for (let i = 0; i < chunk.length; i += 1) {
            chunk[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
        }
        const wav = encodeResampledPcm16Wav([chunk], 48000, 16000);
        const header = parsePcm16WavHeader(wav);
        expect(header).not.toBeNull();
        expect(header!.sampleRate).toBe(16000);
        // 100ms @ 16kHz = 1600 samples = 3200 bytes
        expect(header!.dataLength).toBe(3200);
    });

    it('对偏小的人声电平做安全峰值归一化且不放大纯静音底噪', () => {
        const quietVoice = new Float32Array([0.05, -0.1, 0.08]);
        const boosted = normalizePcmPeak(quietVoice);
        expect(Math.max(...Array.from(boosted, Math.abs))).toBeCloseTo(0.6, 2);

        const silenceFloor = new Float32Array([0.001, -0.002, 0.0015]);
        const untouched = normalizePcmPeak(silenceFloor);
        expect(untouched).toBe(silenceFloor);
    });
});
