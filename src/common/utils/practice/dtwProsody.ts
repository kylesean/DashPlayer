import type { SentencePracticeProsodyFeedback } from '@/common/contracts/sentence-practice';
import type { PcmAudio } from '@/common/utils/practice/rhythmFeedback';

const FRAME_MS = 20;
const HOP_MS = 10;
const SILENCE_TRIM_THRESHOLD = 0.06;
const PAUSE_FRAME_THRESHOLD = 0.14;
const ENVELOPE_POINTS = 24;

/**
 * 从 16-bit PCM 提取归一化短时 RMS 能量包络（并裁剪首尾静音）。
 */
export const extractEnergyEnvelope = (pcm: PcmAudio): number[] => {
    const { samples, sampleRate } = pcm;
    if (samples.length === 0 || sampleRate <= 0) {
        return [];
    }
    const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
    const hopSize = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
    const raw: number[] = [];
    let peak = 0;

    for (let start = 0; start < samples.length; start += hopSize) {
        const end = Math.min(samples.length, start + frameSize);
        let sumSq = 0;
        for (let i = start; i < end; i += 1) {
            const norm = samples[i] / 32768;
            sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / (end - start));
        raw.push(rms);
        if (rms > peak) {
            peak = rms;
        }
    }

    if (peak <= 1e-6) {
        return [];
    }

    const normalized = raw.map((v) => v / peak);
    let firstActive = 0;
    while (firstActive < normalized.length && normalized[firstActive] < SILENCE_TRIM_THRESHOLD) {
        firstActive += 1;
    }
    let lastActive = normalized.length - 1;
    while (lastActive > firstActive && normalized[lastActive] < SILENCE_TRIM_THRESHOLD) {
        lastActive -= 1;
    }
    return normalized.slice(firstActive, lastActive + 1);
};

/**
 * 将任意长度包络线性重采样为固定点数，供 UI 可视化对比。
 */
export const downsampleEnvelope = (env: readonly number[], targetLen: number = ENVELOPE_POINTS): number[] => {
    if (env.length === 0 || targetLen <= 0) {
        return [];
    }
    if (env.length === 1) {
        return Array.from({ length: targetLen }, () => Number(env[0].toFixed(3)));
    }
    const out: number[] = [];
    for (let i = 0; i < targetLen; i += 1) {
        const pos = (i / (targetLen - 1)) * (env.length - 1);
        const left = Math.floor(pos);
        const right = Math.min(env.length - 1, left + 1);
        const frac = pos - left;
        const val = env[left] * (1 - frac) + env[right] * frac;
        out.push(Number(val.toFixed(3)));
    }
    return out;
};

/**
 * 使用带 Sakoe-Chiba 带宽约束的 DTW 对齐两条归一化能量包络，
 * 返回与参考帧一一对应的对齐后用户能量值。
 */
const alignEnvelopesDtw = (ref: readonly number[], user: readonly number[]): Array<{ r: number; u: number }> => {
    const n = ref.length;
    const m = user.length;
    const band = Math.max(8, Math.abs(n - m) + Math.round(Math.max(n, m) * 0.25));
    const INF = 1e12;
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
    dp[0][0] = 0;

    for (let i = 1; i <= n; i += 1) {
        const center = Math.round((i / n) * m);
        const jStart = Math.max(1, center - band);
        const jEnd = Math.min(m, center + band);
        for (let j = jStart; j <= jEnd; j += 1) {
            const cost = Math.abs(ref[i - 1] - user[j - 1]);
            const bestPrev = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            dp[i][j] = cost + bestPrev;
        }
    }

    const pairs: Array<{ r: number; u: number }> = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
        pairs.push({ r: ref[i - 1], u: user[j - 1] });
        const diag = dp[i - 1][j - 1];
        const up = dp[i - 1][j];
        const left = dp[i][j - 1];
        if (diag <= up && diag <= left) {
            i -= 1;
            j -= 1;
        } else if (up <= left) {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    pairs.reverse();
    return pairs;
};

/**
 * 对比原句人声与用户跟读录音的韵律（重音轮廓与停顿分布）。
 *
 * 任一侧静音或过短时返回 null，不影响主评分流程。
 */
export const compareProsodyDtw = (
    refPcm: PcmAudio,
    userPcm: PcmAudio,
): SentencePracticeProsodyFeedback | null => {
    const refEnv = extractEnergyEnvelope(refPcm);
    const userEnv = extractEnergyEnvelope(userPcm);
    if (refEnv.length < 6 || userEnv.length < 6) {
        return null;
    }

    const aligned = alignEnvelopesDtw(refEnv, userEnv);
    if (aligned.length === 0) {
        return null;
    }

    let meanR = 0;
    let meanU = 0;
    let pauseMatches = 0;
    for (const pair of aligned) {
        meanR += pair.r;
        meanU += pair.u;
        const refPaused = pair.r < PAUSE_FRAME_THRESHOLD;
        const userPaused = pair.u < PAUSE_FRAME_THRESHOLD;
        if (refPaused === userPaused) {
            pauseMatches += 1;
        }
    }
    meanR /= aligned.length;
    meanU /= aligned.length;

    let num = 0;
    let denR = 0;
    let denU = 0;
    for (const pair of aligned) {
        const dr = pair.r - meanR;
        const du = pair.u - meanU;
        num += dr * du;
        denR += dr * dr;
        denU += du * du;
    }

    const denom = Math.sqrt(denR * denU);
    const pearson = denom > 1e-8 ? num / denom : 0;
    const energyCorrelation = Math.round(Math.max(0, Math.min(100, ((pearson + 1) / 2) * 100)));
    const pauseMatchScore = Math.round((pauseMatches / aligned.length) * 100);
    const prosodyScore = Math.round(energyCorrelation * 0.6 + pauseMatchScore * 0.4);

    // 将 DTW 对齐后的用户能量投影回 24 点，便于和原句 24 点同轴对比
    const alignedUserSeq = aligned.map((p) => p.u);
    const alignedRefSeq = aligned.map((p) => p.r);

    return {
        prosodyScore,
        pauseMatchScore,
        energyCorrelation,
        referenceEnvelope: downsampleEnvelope(alignedRefSeq),
        userEnvelope: downsampleEnvelope(alignedUserSeq),
    };
};
