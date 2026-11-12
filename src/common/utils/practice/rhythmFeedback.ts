import type {
    SentencePracticeRhythmFeedback,
    SentencePracticeWordRhythm,
} from '@/common/contracts/sentence-practice';
import { isContentLemma } from '@/common/learning/contentWords';
import {
    alignPracticeTokens,
    normalizePracticeTokens,
} from '@/common/utils/practice/pronunciationScoring';
import {
    buildWordSyllableFeedback,
    compareSyllableCount,
    splitIpaSyllables,
} from '@/common/utils/practice/syllableFeedback';

/**
 * 本地 ASR 子词时间轴。
 */
export interface RhythmToken {
    text: string;
    start: number;
    end?: number;
}

/**
 * 解码后的 16-bit PCM。
 */
export interface PcmAudio {
    samples: Int16Array;
    sampleRate: number;
}

interface TimedWord {
    word: string;
    start: number;
    end: number;
}

const MIN_WORD_DURATION_SEC = 0.05;
const FALLBACK_WORD_DURATION_SEC = 0.25;
const FAST_PACE_RATIO = 0.85;
const SLOW_PACE_RATIO = 1.2;
const FLAT_STRESS_RANGE = 0.15;

/**
 * 解析 16kHz 单声道 16-bit PCM WAV。
 *
 * 只接受应用自己用 ffmpeg 生成的格式；其他格式返回 null，节奏分析静默跳过。
 */
export const decodePcm16Wav = (buffer: Uint8Array): PcmAudio | null => {
    if (buffer.byteLength < 44) {
        return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
    const wave = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
    if (riff !== 'RIFF' || wave !== 'WAVE') {
        return null;
    }

    let offset = 12;
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let audioFormat = 0;
    let dataOffset = -1;
    let dataLength = 0;

    while (offset + 8 <= buffer.byteLength) {
        const chunkId = String.fromCharCode(
            buffer[offset],
            buffer[offset + 1],
            buffer[offset + 2],
            buffer[offset + 3],
        );
        const chunkSize = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (chunkId === 'fmt ' && body + 16 <= buffer.byteLength) {
            audioFormat = view.getUint16(body, true);
            channels = view.getUint16(body + 2, true);
            sampleRate = view.getUint32(body + 4, true);
            bitsPerSample = view.getUint16(body + 14, true);
        } else if (chunkId === 'data') {
            dataOffset = body;
            dataLength = Math.min(chunkSize, buffer.byteLength - body);
            break;
        }
        offset = body + chunkSize + (chunkSize % 2);
    }

    if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || sampleRate <= 0 || dataOffset < 0) {
        return null;
    }
    const sampleCount = Math.floor(dataLength / 2);
    if (sampleCount <= 0) {
        return null;
    }
    const samples = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
        samples[i] = view.getInt16(dataOffset + i * 2, true);
    }
    return { samples, sampleRate };
};

/**
 * 把子词时间轴合并为按词排列的时间区间。
 *
 * whisper.cpp 与 sherpa-onnx 都用前导空格标记新词；这里兼容缺失结束时间，
 * 用下一个子词的开始时间兜底。
 */
const buildTimedWords = (tokens: RhythmToken[], fallbackEndSec: number): TimedWord[] => {
    const groups: Array<{ text: string; start: number; end: number }> = [];
    let current: { text: string; start: number; end: number } | null = null;

    tokens.forEach((token, index) => {
        const raw = token.text ?? '';
        const startsNewWord = /^\s/u.test(raw) || current === null;
        if (startsNewWord && current) {
            groups.push(current);
            current = null;
        }
        const text = raw.replace(/^\s+/u, '');
        if (!text) {
            return;
        }
        const nextStart = tokens[index + 1]?.start;
        const end = token.end
            ?? nextStart
            ?? (token.start + FALLBACK_WORD_DURATION_SEC);
        if (!current) {
            current = { text, start: token.start, end };
        } else {
            current.text += raw;
            current.end = Math.max(current.end, end);
        }
    });
    if (current) {
        groups.push(current);
    }

    const words: TimedWord[] = [];
    groups.forEach((group, index) => {
        const normalized = normalizePracticeTokens(group.text);
        if (normalized.length === 0) {
            return;
        }
        const nextStart = groups[index + 1]?.start;
        const end = Math.max(
            group.start + MIN_WORD_DURATION_SEC,
            Math.min(group.end, nextStart ?? fallbackEndSec, fallbackEndSec),
        );
        if (normalized.length === 1) {
            words.push({ word: normalized[0], start: group.start, end });
            return;
        }
        const span = Math.max(MIN_WORD_DURATION_SEC, end - group.start);
        const step = span / normalized.length;
        normalized.forEach((word, partIndex) => {
            words.push({
                word,
                start: group.start + step * partIndex,
                end: group.start + step * (partIndex + 1),
            });
        });
    });
    return words;
};

/**
 * 计算区间内归一化 RMS 能量。
 */
const rmsForRange = (pcm: PcmAudio, startSec: number, endSec: number): number | null => {
    const start = Math.max(0, Math.floor(startSec * pcm.sampleRate));
    const end = Math.min(pcm.samples.length, Math.ceil(endSec * pcm.sampleRate));
    if (end - start < 8) {
        return null;
    }
    let sumSq = 0;
    for (let i = start; i < end; i += 1) {
        const sample = pcm.samples[i] / 32768;
        sumSq += sample * sample;
    }
    return Math.sqrt(sumSq / (end - start));
};

/**
 * 在真实录音上按音节切分时间片，测量每个音节的相对能量。
 *
 * 音节边界来自 IPA 的音节数，按时间等分——这不是强制对齐，所以只用于
 * 判断「重音落在第几个音节」，不用于判断音素是否发对。词内各音节等分
 * 时长是英语里可接受的近似：重读音节通常更长更响，等分后仍能拉开能量差。
 *
 * @returns 0–1 的逐音节相对能量；测量不到时返回 null。
 */
const measureSyllableEnergies = (
    pcm: PcmAudio,
    startSec: number,
    endSec: number,
    phonetic: string,
): number[] | null => {
    const count = splitIpaSyllables(phonetic).length;
    if (count < 2 || endSec <= startSec) {
        return null;
    }
    const span = endSec - startSec;
    const step = span / count;
    const energies: number[] = [];
    for (let index = 0; index < count; index += 1) {
        const energy = rmsForRange(pcm, startSec + step * index, startSec + step * (index + 1));
        if (energy === null) {
            return null;
        }
        energies.push(energy);
    }
    const max = Math.max(...energies);
    if (max <= 0) {
        return null;
    }
    return energies.map((energy) => Number((energy / max).toFixed(2)));
};

/**
 * 生成跟读节奏与重读分布。
 *
 * 只使用本地 ASR 时间轴和录音能量，不调用模型，也不评价音素发音。
 *
 * @param input 原句、转写、子词时间轴、PCM 与原句参考时长。
 * @returns 可解释的节奏信号；缺少时间轴或音频时返回 null。
 */
export const buildRhythmFeedback = (input: {
    expectedText: string;
    transcript: string;
    tokens: RhythmToken[];
    pcm: PcmAudio;
    referenceDurationSec?: number | null;
    /** 词典音标查询；返回 null 表示没有可用音标。 */
    lookupPhonetic?: (word: string) => string | null;
}): SentencePracticeRhythmFeedback | null => {
    if (input.tokens.length === 0 || input.pcm.samples.length === 0) {
        return null;
    }
    const durationSec = input.pcm.samples.length / input.pcm.sampleRate;
    const timedWords = buildTimedWords(input.tokens, durationSec);
    if (timedWords.length === 0) {
        return null;
    }

    const alignment = alignPracticeTokens(input.expectedText, input.transcript);
    const expectedTokens = normalizePracticeTokens(input.expectedText);
    let actualIndex = 0;
    const aligned: Array<{ expected: string; timed: TimedWord | null }> = [];
    for (const entry of alignment.words) {
        if (entry.status === 'extra') {
            actualIndex += 1;
            continue;
        }
        if (entry.status === 'missing') {
            aligned.push({ expected: entry.expected, timed: null });
            continue;
        }
        aligned.push({ expected: entry.expected, timed: timedWords[actualIndex] ?? null });
        actualIndex += 1;
    }

    const measured = aligned
        .map((entry) => {
            if (!entry.timed) return null;
            const start = Math.max(0, entry.timed.start);
            const end = Math.min(durationSec, Math.max(entry.timed.end, start + MIN_WORD_DURATION_SEC));
            return {
                word: entry.expected,
                start,
                end,
                durationSec: Number((end - start).toFixed(2)),
                energy: rmsForRange(input.pcm, start, end),
            };
        })
        .filter((entry): entry is {
            word: string;
            start: number;
            end: number;
            durationSec: number;
            energy: number | null;
        } => entry !== null);

    const maxEnergy = Math.max(0, ...measured.map((entry) => entry.energy ?? 0));
    const words: SentencePracticeWordRhythm[] = aligned.map((entry) => {
        const match = measured.find((item) => item.word === entry.expected);
        if (!match) {
            return { word: entry.expected, durationSec: null, emphasis: null, stressed: false };
        }
        const emphasis = match.energy !== null && maxEnergy > 0
            ? Number(Math.min(1, match.energy / maxEnergy).toFixed(2))
            : null;
        const phonetic = input.lookupPhonetic?.(entry.expected) ?? null;
        const syllableEnergies = phonetic && match.energy !== null
            ? measureSyllableEnergies(input.pcm, match.start, match.end, phonetic)
            : null;
        const syllable = buildWordSyllableFeedback(entry.expected, phonetic, syllableEnergies);
        return {
            word: entry.expected,
            durationSec: match.durationSec,
            emphasis,
            stressed: false,
            phonetic,
            syllables: syllable.syllables,
            stressIndex: syllable.stressIndex,
            spokenStressIndex: syllable.spokenStressIndex,
            stressAligned: syllable.stressAligned,
        };
    });

    const contentWords = words.filter(
        (word) => word.emphasis !== null && isContentLemma(word.word),
    );
    if (contentWords.length >= 3) {
        const energies = contentWords.map((word) => word.emphasis ?? 0);
        const mean = energies.reduce((sum, value) => sum + value, 0) / energies.length;
        const variance = energies.reduce((sum, value) => sum + (value - mean) ** 2, 0) / energies.length;
        const std = Math.sqrt(variance);
        const threshold = mean + std * 0.75;
        const candidates = contentWords
            .filter((word) => (word.emphasis ?? 0) >= threshold && (word.emphasis ?? 0) >= 0.5)
            .sort((left, right) => (right.emphasis ?? 0) - (left.emphasis ?? 0))
            .slice(0, 2);
        candidates.forEach((candidate) => {
            const target = words.find((word) => word.word === candidate.word && !word.stressed);
            if (target) target.stressed = true;
        });
    }

    const durations = measured.map((entry) => entry.durationSec).filter((value) => value > 0);
    const averageWordDurationSec = durations.length > 0
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : null;
    const expectedWordDuration = input.referenceDurationSec && expectedTokens.length > 0
        ? input.referenceDurationSec / expectedTokens.length
        : null;
    const paceRatio = averageWordDurationSec !== null && expectedWordDuration && expectedWordDuration > 0
        ? averageWordDurationSec / expectedWordDuration
        : null;
    const pace = paceRatio === null
        ? null
        : paceRatio < FAST_PACE_RATIO
            ? 'fast' as const
            : paceRatio > SLOW_PACE_RATIO
                ? 'slow' as const
                : 'steady' as const;

    const notes: SentencePracticeRhythmFeedback['notes'] = [];
    if (pace === 'fast') notes.push('pace-fast');
    if (pace === 'slow') notes.push('pace-slow');

    const contentEnergies = contentWords.map((word) => word.emphasis ?? 0);
    if (contentEnergies.length >= 3) {
        const min = Math.min(...contentEnergies);
        const max = Math.max(...contentEnergies);
        if (max - min < FLAT_STRESS_RANGE) {
            notes.push('flat-stress');
        }
    }

    const firstStart = Math.min(...measured.map((entry) => entry.start));
    const lastEnd = Math.max(...measured.map((entry) => entry.end));
    const speechDurationSec = Math.max(0, Number((lastEnd - firstStart).toFixed(2)));

    // 音节数对比：参考侧来自词典 IPA，用户侧由说话时长估算。
    // 只有两侧都有信息时才给结论，避免在缺音标时编造「你说少了两个音节」。
    const referenceSyllableCount = words.reduce(
        (sum, word) => sum + (word.syllables?.length ?? 0),
        0,
    );
    const syllables = referenceSyllableCount > 0
        ? compareSyllableCount(referenceSyllableCount, speechDurationSec)
        : undefined;
    if (syllables?.verdict === 'fewer') notes.push('syllables-fewer');
    if (syllables?.verdict === 'more') notes.push('syllables-more');

    // 重音位置：只统计「参考重音已知且用户重音可测」的词，
    // 且错位词数要达到多数才提示，单个词的波动不足以说明整体问题。
    const measurable = words.filter((word) => word.stressAligned !== null);
    const shifted = measurable.filter((word) => word.stressAligned === false).length;
    if (measurable.length >= 3 && shifted / measurable.length >= 0.5) {
        notes.push('stress-shifted');
    }

    return {
        speechDurationSec,
        averageWordDurationSec: averageWordDurationSec === null
            ? null
            : Number(averageWordDurationSec.toFixed(2)),
        paceRatio: paceRatio === null ? null : Number(paceRatio.toFixed(2)),
        pace,
        words,
        notes,
        ...(syllables ? { syllables } : {}),
    };
};
