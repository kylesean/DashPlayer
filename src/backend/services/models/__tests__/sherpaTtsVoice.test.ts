import { describe, expect, it } from 'vitest';

import {
    SHERPA_TTS_DEFAULT_VOICE_ID,
    SHERPA_TTS_VOICES,
    resolveSherpaTtsVoice,
    sherpaTtsDownloadUrls,
} from '@/backend/services/models/sherpaTtsModel';

describe('TTS 音色清单', () => {
    it('默认音色是 medium 档美音（lessac），而不是低音质的 amy-low', () => {
        const voice = resolveSherpaTtsVoice(SHERPA_TTS_DEFAULT_VOICE_ID);
        expect(voice.id).toBe('en-US-lessac-medium');
        expect(voice.quality).toBe('medium');
    });

    it('同时提供美音与英音，且英音覆盖男女声', () => {
        const us = SHERPA_TTS_VOICES.filter((voice) => voice.accent === 'en-US');
        const gb = SHERPA_TTS_VOICES.filter((voice) => voice.accent === 'en-GB');
        expect(us.length).toBeGreaterThan(0);
        expect(gb.length).toBeGreaterThan(0);
        expect(new Set(gb.map((voice) => voice.gender))).toEqual(new Set(['male', 'female']));
    });

    it('未知或缺失的音色 id 回退默认值，而不是抛错', () => {
        // 存量配置可能指向已下线的音色；朗读是辅助功能，不该让设置页打不开。
        expect(resolveSherpaTtsVoice('no-such-voice').id).toBe(SHERPA_TTS_DEFAULT_VOICE_ID);
        expect(resolveSherpaTtsVoice(null).id).toBe(SHERPA_TTS_DEFAULT_VOICE_ID);
        expect(resolveSherpaTtsVoice(undefined).id).toBe(SHERPA_TTS_DEFAULT_VOICE_ID);
    });

    it('每个音色的 id、目录名、归档名、模型文件名互不重复', () => {
        for (const field of ['id', 'directoryName', 'archiveName', 'modelFileName'] as const) {
            const values = SHERPA_TTS_VOICES.map((voice) => voice[field]);
            expect(new Set(values).size, `${field} 存在重复`).toBe(values.length);
        }
    });

    it('下载地址优先走国内镜像，GitHub 作为兜底', () => {
        const urls = sherpaTtsDownloadUrls(SHERPA_TTS_VOICES[0]);
        expect(urls).toHaveLength(2);
        expect(urls[0]).toContain('modelscope.cn');
        expect(urls[1]).toContain('github.com');
        // 两个地址必须指向同一个归档文件名，否则镜像与兜底会装出不同的模型。
        expect(urls[0].endsWith(SHERPA_TTS_VOICES[0].archiveName)).toBe(true);
        expect(urls[1].endsWith(SHERPA_TTS_VOICES[0].archiveName)).toBe(true);
    });
});
