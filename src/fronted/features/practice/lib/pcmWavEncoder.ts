/**
 * 将 Web Audio 采集的多段 Float32 PCM 重采样并编码为 16kHz 单声道 16-bit PCM WAV。
 *
 * 后端 ASR 与音素 GOP 模型原生要求 16kHz 单声道 16-bit PCM WAV；
 * 前端直接输出该格式后，后端可跳过每次拉起 ffmpeg 子进程的转码开销。
 */

const TARGET_SAMPLE_RATE = 16000;

/**
 * 合并多个 Float32Array 片段为一个连续数组。
 */
export function mergePcmChunks(chunks: readonly Float32Array[]): Float32Array {
    let total = 0;
    for (const chunk of chunks) {
        total += chunk.length;
    }
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}

/**
 * 线性插值重采样（足够满足语音识别与音素对齐，无额外内存/算力负担）。
 */
export function resampleLinear(
    samples: Float32Array,
    fromRate: number,
    toRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
    if (samples.length === 0 || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
        return samples;
    }
    const ratio = fromRate / toRate;
    const outLength = Math.max(1, Math.round(samples.length / ratio));
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i += 1) {
        const srcIndex = i * ratio;
        const left = Math.floor(srcIndex);
        const right = Math.min(samples.length - 1, left + 1);
        const frac = srcIndex - left;
        output[i] = samples[left] * (1 - frac) + samples[right] * frac;
    }
    return output;
}

/**
 * 将 Float32 PCM（[-1, 1]）编码为标准 44 字节 RIFF/WAVE 16-bit PCM。
 */
export function encodePcm16Wav(
    samples: Float32Array,
    sampleRate: number = TARGET_SAMPLE_RATE,
): Uint8Array {
    const dataByteLength = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataByteLength);
    const view = new DataView(buffer);

    const writeAscii = (offset: number, text: string): void => {
        for (let i = 0; i < text.length; i += 1) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataByteLength, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate = sampleRate * channels * bytesPerSample
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeAscii(36, 'data');
    view.setUint32(40, dataByteLength, true);

    for (let i = 0; i < samples.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }

    return new Uint8Array(buffer);
}

/**
 * 限幅峰值归一化：将偏小的原始人声波形抬升到舒适可听电平（约 -3 dBFS），
 * 同时限制最大增益倍数（默认 <= 6×），避免把纯静音底噪过度放大。
 */
export function normalizePcmPeak(
    samples: Float32Array,
    targetPeak = 0.72,
    maxGain = 6,
): Float32Array {
    if (samples.length === 0) return samples;
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
    }
    if (peak < 0.005 || peak >= targetPeak) {
        return samples;
    }
    const gain = Math.min(maxGain, targetPeak / peak);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
        out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
    }
    return out;
}

/**
 * 一步完成多段 PCM 合并、重采样至 16kHz、峰值归一化与 WAV 封装。
 */
export function encodeResampledPcm16Wav(
    chunks: readonly Float32Array[],
    sourceSampleRate: number,
    targetSampleRate: number = TARGET_SAMPLE_RATE,
): Uint8Array {
    const merged = mergePcmChunks(chunks);
    const resampled = resampleLinear(merged, sourceSampleRate, targetSampleRate);
    const normalized = normalizePcmPeak(resampled);
    return encodePcm16Wav(normalized, targetSampleRate);
}
