import { describe, expect, it } from 'vitest';

import { parsePcm16WavHeader, resolveDataLength } from '@/common/utils/audio/wav';

/**
 * 造一个最小 WAV 头；只声明长度，不带真实采样。
 *
 * @param overrides 覆盖 fmt 字段，用于构造不支持的格式。
 * @returns 44 字节头。
 */
const header = (overrides: { channels?: number; sampleRate?: number; bits?: number; format?: number } = {}): Uint8Array => {
    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(overrides.format ?? 1, 20);
    buffer.writeUInt16LE(overrides.channels ?? 1, 22);
    buffer.writeUInt32LE(overrides.sampleRate ?? 16000, 24);
    buffer.writeUInt32LE(32000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(overrides.bits ?? 16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(1000, 40);
    return new Uint8Array(buffer);
};

describe('parsePcm16WavHeader', () => {
    it('解析标准 16kHz 单声道头', () => {
        expect(parsePcm16WavHeader(header())).toEqual({
            sampleRate: 16000,
            dataOffset: 44,
            dataLength: 1000,
        });
    });

    it('跳过 fmt 之前的未知块', () => {
        const base = Buffer.from(header());
        const list = Buffer.alloc(16);
        list.write('LIST', 0);
        list.writeUInt32LE(8, 4);
        const merged = Buffer.concat([base.subarray(0, 12), list, base.subarray(12)]);
        const parsed = parsePcm16WavHeader(new Uint8Array(merged));

        expect(parsed?.dataOffset).toBe(60);
        expect(parsed?.sampleRate).toBe(16000);
    });

    it('多声道、非 16 位与浮点格式都返回 null', () => {
        expect(parsePcm16WavHeader(header({ channels: 2 }))).toBeNull();
        expect(parsePcm16WavHeader(header({ bits: 24 }))).toBeNull();
        expect(parsePcm16WavHeader(header({ format: 3 }))).toBeNull();
    });

    it('非 RIFF/WAVE 或过短时返回 null', () => {
        expect(parsePcm16WavHeader(new Uint8Array(10))).toBeNull();
        const bogus = header();
        bogus[0] = 0;
        expect(parsePcm16WavHeader(bogus)).toBeNull();
    });

    it('不按传入缓冲截断声明长度', () => {
        // 只传 44 字节头时，声明长度仍是 1000，由调用方决定可用多少。
        expect(parsePcm16WavHeader(header())?.dataLength).toBe(1000);
    });
});

describe('resolveDataLength', () => {
    it('按文件实际大小收敛声明长度', () => {
        expect(resolveDataLength({ sampleRate: 16000, dataOffset: 44, dataLength: 1000 }, 244)).toBe(200);
    });

    it('文件比偏移还短时返回 0', () => {
        expect(resolveDataLength({ sampleRate: 16000, dataOffset: 44, dataLength: 1000 }, 44)).toBe(0);
        expect(resolveDataLength({ sampleRate: 16000, dataOffset: 44, dataLength: 1000 }, 10)).toBe(0);
    });
});
