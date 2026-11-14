import { create } from 'zustand';

const STORAGE_KEYS = {
    ttsVolume: 'refrain.audio.tts_volume',
    recordingGain: 'refrain.audio.recording_gain',
} as const;

function readClampedStorage(key: string, fallback: number, min: number, max: number): number {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    } catch {
        return fallback;
    }
}

function writeStorage(key: string, value: number): void {
    try {
        window.localStorage.setItem(key, String(value));
    } catch {
        // 隐私模式或测试环境忽略持久化失败
    }
}

export interface AudioVolumeState {
    /** TTS 朗读音量（0.1 ~ 1.0，默认 1.0，对齐系统音量）。 */
    ttsVolume: number;
    /** 跟读录音回放增益（0.5 ~ 2.5，默认 1.5×，匹配视频原声响度）。 */
    recordingGain: number;
    setTtsVolume: (volume: number) => void;
    setRecordingGain: (gain: number) => void;
}

export const useAudioVolume = create<AudioVolumeState>((set) => ({
    ttsVolume: readClampedStorage(STORAGE_KEYS.ttsVolume, 1.0, 0.1, 1.0),
    recordingGain: readClampedStorage(STORAGE_KEYS.recordingGain, 1.5, 0.5, 2.5),
    setTtsVolume: (volume) => {
        const clamped = Math.round(Math.min(1.0, Math.max(0.1, volume)) * 100) / 100;
        writeStorage(STORAGE_KEYS.ttsVolume, clamped);
        set({ ttsVolume: clamped });
    },
    setRecordingGain: (gain) => {
        const clamped = Math.round(Math.min(2.5, Math.max(0.5, gain)) * 10) / 10;
        writeStorage(STORAGE_KEYS.recordingGain, clamped);
        set({ recordingGain: clamped });
    },
}));

/**
 * 创建带 Web Audio 增益与防削波限幅的 HTMLAudioElement，
 * 以便录音回放在不失真的前提下匹配视频/系统响度。
 */
export function createBoostedAudio(url: string, gainMultiplier: number): {
    audio: HTMLAudioElement;
    dispose: () => void;
} {
    const audio = new Audio(url);
    const safeGain = Math.min(2.5, Math.max(0.5, gainMultiplier));

    if (typeof window === 'undefined') {
        audio.volume = Math.min(1, safeGain);
        return { audio, dispose: () => undefined };
    }

    const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor || safeGain <= 1.0) {
        audio.volume = Math.min(1, safeGain);
        return { audio, dispose: () => undefined };
    }

    try {
        const ctx = new Ctor();
        const source = ctx.createMediaElementSource(audio);
        const gainNode = ctx.createGain();
        gainNode.gain.value = safeGain;

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.1;

        source.connect(gainNode);
        gainNode.connect(limiter);
        limiter.connect(ctx.destination);

        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => undefined);
        }

        return {
            audio,
            dispose: () => {
                try {
                    source.disconnect();
                    gainNode.disconnect();
                    limiter.disconnect();
                } catch {
                    // 忽略重复断开
                }
                if (ctx.state !== 'closed') {
                    void ctx.close().catch(() => undefined);
                }
            },
        };
    } catch {
        audio.volume = 1;
        return { audio, dispose: () => undefined };
    }
}
