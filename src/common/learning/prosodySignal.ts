import { isWordToken, splitWords } from '@/common/utils/subtitle/tokenize';

/**
 * 能量包络的时间分辨率。
 *
 * 0.1 秒是「够细以区分句内停顿、又够粗以让一小时素材只占几百 KB」的折中。
 * 再细对语速判定没有增益，再粗会把句首尾的静音抹进相邻句。
 */
export const PROSODY_ENVELOPE_SEC = 0.1;

/** 静音下限，单位 dBFS；低于此值一律按静音处理，避免 log(0)。 */
export const PROSODY_SILENCE_DB = -80;

/**
 * 一帧的均方值转 dBFS。
 *
 * @param meanSquare 归一化后的均方值。
 * @returns dBFS，最低截断到 `PROSODY_SILENCE_DB`。
 */
export const meanSquareToDb = (meanSquare: number): number => {
    if (!Number.isFinite(meanSquare) || meanSquare <= 0) {
        return PROSODY_SILENCE_DB;
    }
    return Math.max(PROSODY_SILENCE_DB, 10 * Math.log10(meanSquare));
};

/**
 * 流式能量包络累加器。
 *
 * 长视频不能整段读进内存：两小时 16kHz 单声道 PCM 约 460 MB。这里按块喂
 * 采样，内部只保留「当前桶的累加和」，输出规模与音频时长成正比（0.1 秒
 * 一格），与块大小无关。
 *
 * 桶按「累计样本数」推进而不是按块边界推进：块大小不必是桶长的整数倍，
 * 调用方可以任意选择读块大小，包络的时间对齐不会漂移。
 */
export class EnergyEnvelopeBuilder {
    private readonly bucketLength: number;

    private readonly envelope: number[] = [];

    private bucketSum = 0;

    private bucketSamples = 0;

    /**
     * @param sampleRate 采样率。
     * @param bucketSec 包络分辨率（秒）。
     */
    public constructor(
        private readonly sampleRate: number,
        private readonly bucketSec: number = PROSODY_ENVELOPE_SEC,
    ) {
        const seconds = Number.isFinite(bucketSec) && bucketSec > 0 ? bucketSec : PROSODY_ENVELOPE_SEC;
        const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 16000;
        this.bucketLength = Math.max(1, Math.round(rate * seconds));
    }

    /**
     * 追加一段 16-bit 采样。
     *
     * @param samples 采样；跨块边界的桶会被正确接续。
     */
    public push(samples: Int16Array): void {
        let index = 0;
        while (index < samples.length) {
            // 按「装满当前桶还差多少」分段，而不是每样本判断一次：
            // 两小时素材有上亿个采样，逐样本分支的成本不可忽略。
            const take = Math.min(this.bucketLength - this.bucketSamples, samples.length - index);
            const end = index + take;
            let sum = this.bucketSum;
            for (let cursor = index; cursor < end; cursor += 1) {
                const sample = samples[cursor] / 32768;
                sum += sample * sample;
            }
            this.bucketSum = sum;
            this.bucketSamples += take;
            index = end;
            if (this.bucketSamples >= this.bucketLength) {
                this.flushBucket();
            }
        }
    }

    /**
     * 结束累加。
     *
     * 不足一桶的尾巴直接丢弃：末桶不完整时按较少样本数求均值会被系统性
     * 低估或高估，而 0.1 秒的缺口对整段韵律判定没有影响。
     *
     * @returns dBFS 包络。
     */
    public finish(): number[] {
        return [...this.envelope];
    }

    private flushBucket(): void {
        this.envelope.push(Number(meanSquareToDb(this.bucketSum / this.bucketSamples).toFixed(1)));
        this.bucketSum = 0;
        this.bucketSamples = 0;
    }
}

/**
 * 一次性把整段采样压成 dBFS 能量包络。
 *
 * 只是 `EnergyEnvelopeBuilder` 的便捷包装，供短音频与测试使用；长音频
 * 应直接用 builder 分块喂入，避免整段驻留内存。
 *
 * @param input.samples 16-bit 采样。
 * @param input.sampleRate 采样率。
 * @param input.bucketSec 包络分辨率（秒）。
 * @returns dBFS 包络；样本不足一格时为空数组。
 */
export const buildEnergyEnvelope = (input: {
    samples: Int16Array;
    sampleRate: number;
    bucketSec?: number;
}): number[] => {
    const builder = new EnergyEnvelopeBuilder(input.sampleRate, input.bucketSec);
    builder.push(input.samples);
    return builder.finish();
};

/**
 * 取升序数组中指定分位的值。
 *
 * @param sorted 已升序排列的数值。
 * @param ratio 0-1 的分位比例。
 * @returns 分位值；数组为空时为 0。
 */
const percentile = (sorted: readonly number[], ratio: number): number => {
    if (sorted.length === 0) {
        return 0;
    }
    const position = Math.min(sorted.length - 1, Math.max(0, Math.round(ratio * (sorted.length - 1))));
    return sorted[position];
};

/** 韵律分析需要的字幕字段。 */
export interface ProsodySentenceInput {
    /** 句在字幕中的序号。 */
    index: number;
    /** 开始秒数。 */
    start: number;
    /** 结束秒数。 */
    end: number;
    /** 英文原文，用于估算语速。 */
    text: string;
}

/** 一句字幕的韵律特征。 */
export interface SentenceProsody {
    /** 句在字幕中的序号。 */
    index: number;
    /** 开始秒数。 */
    start: number;
    /** 结束秒数。 */
    end: number;
    /** 词数，用于语速估算。 */
    wordCount: number;
    /** 有声格占比，0-1。 */
    voicedRatio: number;
    /** 有声格平均能量，dBFS。 */
    energyDb: number;
    /** 每秒有声时长对应的词数；有声时长不足时为 0。 */
    speechRate: number;
}

/** 韵律突变的触发原因。 */
export type ProsodyShiftReason = 'rate' | 'energy';

/** 一个韵律突变点。 */
export interface ProsodyShift {
    /** 突变之后的第一句在字幕中的 index。 */
    sentenceIndex: number;
    /** 突变发生在该秒数（即当前句开始时间）。 */
    atSec: number;
    /** 触发原因。 */
    reason: ProsodyShiftReason;
    /** rate 为前后语速比，energy 为前后能量差（dB）。 */
    detail: number;
}

/** 韵律突变判定阈值。 */
export interface ProsodyShiftOptions {
    /** 语速比超过该值（或低于其倒数）视为语速突变。 */
    rateRatioThreshold?: number;
    /** 前后平均能量差超过该 dB 数视为音量突变。 */
    energyJumpDb?: number;
    /** 少于该词数的句子不参与语速比较：短语的语速没有统计意义。 */
    minWordCount?: number;
    /** 有声时长不足该秒数的句子不参与比较。 */
    minVoicedSec?: number;
}

const DEFAULT_RATE_RATIO_THRESHOLD = 1.5;
const DEFAULT_ENERGY_JUMP_DB = 8;
const DEFAULT_MIN_WORD_COUNT = 4;
const DEFAULT_MIN_VOICED_SEC = 0.8;

/**
 * 统计一句字幕的语速与能量。
 *
 * 有声/静音的划分用句内相对阈值而不是全局固定值：不同视频的录音电平
 * 相差很大，固定阈值在低音量素材上会把整句判成静音。这里以句内 10 分位
 * 作为噪声底、90 分位作为峰值，取两者中点作为发声阈值。
 *
 * @param input.envelope 该句时间窗内的 dBFS 包络。
 * @param input.frameSec 包络分辨率。
 * @param input.sentence 字幕句。
 * @returns 韵律特征；句内没有可辨发声时为 null。
 */
export const analyzeSentenceProsody = (input: {
    envelope: readonly number[];
    frameSec: number;
    sentence: ProsodySentenceInput;
}): SentenceProsody | null => {
    const { envelope, frameSec, sentence } = input;
    if (envelope.length < 3) {
        return null;
    }
    const sorted = [...envelope].sort((left, right) => left - right);
    const noiseDb = percentile(sorted, 0.1);
    const peakDb = percentile(sorted, 0.9);
    // 峰值与噪声底几乎重合说明整段是静音或恒定噪声，没有韵律可言。
    if (peakDb - noiseDb < 3 || peakDb <= PROSODY_SILENCE_DB + 6) {
        return null;
    }
    const threshold = noiseDb + (peakDb - noiseDb) / 2;
    let voicedFrames = 0;
    let voicedSum = 0;
    for (const db of envelope) {
        if (db >= threshold) {
            voicedFrames += 1;
            voicedSum += db;
        }
    }
    if (voicedFrames === 0) {
        return null;
    }
    const voicedSec = voicedFrames * frameSec;
    const wordCount = splitWords(sentence.text).filter(isWordToken).length;
    return {
        index: sentence.index,
        start: sentence.start,
        end: sentence.end,
        wordCount,
        voicedRatio: Number((voicedFrames / envelope.length).toFixed(3)),
        energyDb: Number((voicedSum / voicedFrames).toFixed(2)),
        speechRate: voicedSec > 0 ? Number((wordCount / voicedSec).toFixed(3)) : 0,
    };
};

/**
 * 从逐句韵律特征中找出突变点。
 *
 * 只比较相邻两句：场景边界天然是句间的，跨句比较会把缓慢的语速漂移
 * 也当成突变。语速优先于音量——语速变化更能反映「换了一个人在说」，
 * 音量变化也可能只是配乐起伏，因此同一处只报一个原因。
 *
 * @param signals 按字幕顺序排列的逐句特征。
 * @param options 阈值覆盖。
 * @returns 按时间升序的突变点。
 */
export const detectProsodyShifts = (
    signals: readonly SentenceProsody[],
    options: ProsodyShiftOptions = {},
): ProsodyShift[] => {
    const rateRatioThreshold = options.rateRatioThreshold ?? DEFAULT_RATE_RATIO_THRESHOLD;
    const energyJumpDb = options.energyJumpDb ?? DEFAULT_ENERGY_JUMP_DB;
    const minWordCount = options.minWordCount ?? DEFAULT_MIN_WORD_COUNT;
    const minVoicedSec = options.minVoicedSec ?? DEFAULT_MIN_VOICED_SEC;

    const shifts: ProsodyShift[] = [];
    for (let index = 1; index < signals.length; index += 1) {
        const previous = signals[index - 1];
        const current = signals[index];
        const previousVoicedSec = (previous.end - previous.start) * previous.voicedRatio;
        const currentVoicedSec = (current.end - current.start) * current.voicedRatio;
        if (
            previous.wordCount < minWordCount
            || current.wordCount < minWordCount
            || previousVoicedSec < minVoicedSec
            || currentVoicedSec < minVoicedSec
            || previous.speechRate <= 0
            || current.speechRate <= 0
        ) {
            continue;
        }
        const ratio = current.speechRate / previous.speechRate;
        if (ratio >= rateRatioThreshold || ratio <= 1 / rateRatioThreshold) {
            shifts.push({
                sentenceIndex: current.index,
                atSec: Number(current.start.toFixed(2)),
                reason: 'rate',
                detail: Number(ratio.toFixed(2)),
            });
            continue;
        }
        const deltaDb = current.energyDb - previous.energyDb;
        if (Math.abs(deltaDb) >= energyJumpDb) {
            shifts.push({
                sentenceIndex: current.index,
                atSec: Number(current.start.toFixed(2)),
                reason: 'energy',
                detail: Number(deltaDb.toFixed(2)),
            });
        }
    }
    return shifts;
};

/**
 * 从整段包络中切出某句覆盖的区间。
 *
 * 句首句尾可能落在包络格子中间：按四舍五入对齐到最近的格子边界，避免
 * 每个句首都被算成「半个静音格」而系统性拉低语速。
 *
 * @param envelope 整段 dBFS 包络。
 * @param frameSec 包络分辨率。
 * @param start 句开始秒数。
 * @param end 句结束秒数。
 * @returns 该句覆盖的包络片段；区间为空时为空数组。
 */
export const sliceEnvelope = (
    envelope: readonly number[],
    frameSec: number,
    start: number,
    end: number,
): number[] => {
    if (frameSec <= 0 || end <= start) {
        return [];
    }
    const from = Math.max(0, Math.round(start / frameSec));
    const to = Math.min(envelope.length, Math.round(end / frameSec));
    if (to <= from) {
        return [];
    }
    return envelope.slice(from, to);
};

/**
 * 一次性把整段包络与字幕句合成为逐句特征。
 *
 * @param envelope 整段 dBFS 包络。
 * @param frameSec 包络分辨率。
 * @param sentences 按时间升序的字幕句。
 * @returns 逐句特征；无有效韵律的句子被跳过。
 */
export const analyzeSentencesProsody = (input: {
    envelope: readonly number[];
    frameSec: number;
    sentences: readonly ProsodySentenceInput[];
}): SentenceProsody[] => {
    const result: SentenceProsody[] = [];
    for (const sentence of input.sentences) {
        const slice = sliceEnvelope(input.envelope, input.frameSec, sentence.start, sentence.end);
        const prosody = analyzeSentenceProsody({
            envelope: slice,
            frameSec: input.frameSec,
            sentence,
        });
        if (prosody) {
            result.push(prosody);
        }
    }
    return result;
};
