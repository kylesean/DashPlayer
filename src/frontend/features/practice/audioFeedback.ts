import usePracticePanel from './practiceStore';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContextClass(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
    };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function getSharedContext(): AudioContext | null {
    const Ctor = getAudioContextClass();
    if (!Ctor) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
        try {
            sharedAudioCtx = new Ctor();
        } catch {
            return null;
        }
    }
    if (sharedAudioCtx.state === 'suspended') {
        void sharedAudioCtx.resume().catch(() => undefined);
    }
    return sharedAudioCtx;
}

function playTone(
    freq: number,
    durationSec: number,
    gainPeak: number,
    type: OscillatorType = 'sine',
    endFreq?: number,
): void {
    if (!usePracticePanel.getState().soundCues) return;
    const ctx = getSharedContext();
    if (!ctx) return;
    try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        if (endFreq !== undefined) {
            osc.frequency.exponentialRampToValueAtTime(endFreq, now + durationSec);
        }
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + durationSec + 0.01);
    } catch {
        // 测试/沙盒环境禁止自动播音时静默跳过
    }
}

/** 词槽拼对一个词的轻微木鱼/键轴确认音。 */
export function playWordMatchCue(): void {
    playTone(580, 0.055, 0.035, 'triangle', 740);
}

/** 词槽拼错时的极轻柔低音提示。 */
export function playWordMissCue(): void {
    playTone(190, 0.08, 0.04, 'sine', 150);
}

/** 整句完成/达标时的柔和双音。 */
export function playSentencePassCue(): void {
    playTone(523.25, 0.11, 0.065, 'triangle', 659.25);
}

/** 准备开始录音时“滴”一声提示开麦。 */
export function playMicReadyCue(): void {
    playTone(880, 0.075, 0.06, 'sine');
}

/** 从已解码音频缓冲抽取归一化柱状包络（范围 0.08 ~ 1）。 */
export function computeWaveformBins(buffer: AudioBuffer, binCount = 40): number[] {
    if (binCount <= 0) return [];
    const channel = buffer.getChannelData(0);
    if (channel.length === 0) {
        return new Array<number>(binCount).fill(0.1);
    }
    const blockSize = Math.max(1, Math.floor(channel.length / binCount));
    const rawPeaks: number[] = [];
    let maxPeak = 0.001;
    for (let i = 0; i < binCount; i += 1) {
        const start = i * blockSize;
        const end = Math.min(channel.length, start + blockSize);
        let sumSq = 0;
        for (let j = start; j < end; j += 1) {
            const sample = channel[j];
            sumSq += sample * sample;
        }
        const rms = end > start ? Math.sqrt(sumSq / (end - start)) : 0;
        rawPeaks.push(rms);
        if (rms > maxPeak) maxPeak = rms;
    }
    return rawPeaks.map((v) => Math.max(0.08, Math.min(1, v / maxPeak)));
}

/** 本地解码录音 Blob 获取精准时长与 40 柱声纹包络（不经后端）。 */
export async function decodeRecordedAudioSummary(
    blob: Blob,
    binCount = 40,
): Promise<{ bins: number[]; durationMs: number }> {
    const fallback = { bins: new Array<number>(binCount).fill(0.16), durationMs: 0 };
    const ctx = getSharedContext();
    if (!ctx || typeof blob.arrayBuffer !== 'function') {
        return fallback;
    }
    try {
        const arrayBuf = await blob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
        return {
            bins: computeWaveformBins(audioBuf, binCount),
            durationMs: Math.round(audioBuf.duration * 1000),
        };
    } catch {
        return fallback;
    }
}
