import { describe, expect, it } from 'vitest';

import {
    SHERPA_TTS_DEFAULT_VOICE_ID,
    SHERPA_TTS_VOICES,
    getSherpaTtsRequiredFiles,
    resolveSherpaTtsVoice,
    sherpaTtsDownloadUrls,
} from '@/backend/services/models/sherpaTtsModel';

describe('TTS 音色清单', () => {
    it('默认音色是高拟真 Kokoro 美音（Bella），而不是早期低音质 Piper', () => {
        const voice = resolveSherpaTtsVoice(SHERPA_TTS_DEFAULT_VOICE_ID);
        expect(voice.id).toBe('kokoro-en-US-bella');
        expect(voice.engine).toBe('kokoro');
        expect(voice.quality).toBe('high');
        expect(voice.speakerId).toBe(1);
    });

    it('同时提供美音与英音，且美英音均覆盖男女声', () => {
        const us = SHERPA_TTS_VOICES.filter((voice) => voice.accent === 'en-US');
        const gb = SHERPA_TTS_VOICES.filter((voice) => voice.accent === 'en-GB');
        expect(us.length).toBeGreaterThan(0);
        expect(gb.length).toBeGreaterThan(0);
        expect(new Set(us.map((voice) => voice.gender))).toEqual(new Set(['male', 'female']));
        expect(new Set(gb.map((voice) => voice.gender))).toEqual(new Set(['male', 'female']));
    });

    it('未知或缺失的音色 id 回退默认值，而不是抛错', () => {
        // 存量配置可能指向已下线的音色；朗读是辅助功能，不该让设置页打不开。
        expect(resolveSherpaTtsVoice('no-such-voice').id).toBe(SHERPA_TTS_DEFAULT_VOICE_ID);
        expect(resolveSherpaTtsVoice(null).id).toBe(SHERPA_TTS_DEFAULT_VOICE_ID);
        expect(resolveSherpaTtsVoice(undefined).id).toBe(SHERPA_TTS_DEFAULT_VOICE_ID);
    });

    it('每个音色的 id 互不重复，且必需文件清单包含 voices.bin（Kokoro）', () => {
        const ids = SHERPA_TTS_VOICES.map((voice) => voice.id);
        expect(new Set(ids).size).toBe(ids.length);

        const bella = resolveSherpaTtsVoice('kokoro-en-US-bella');
        expect(getSherpaTtsRequiredFiles(bella)).toEqual([
            'model.int8.onnx',
            'tokens.txt',
            'espeak-ng-data',
            'voices.bin',
        ]);
    });

    it('Piper 音色优先走国内镜像，Kokoro 音色指向官方 release', () => {
        const piperUrls = sherpaTtsDownloadUrls(SHERPA_TTS_VOICES[0]);
        expect(piperUrls).toHaveLength(2);
        expect(piperUrls[0]).toContain('modelscope.cn');
        expect(piperUrls[1]).toContain('github.com');
        expect(piperUrls[0].endsWith(SHERPA_TTS_VOICES[0].archiveName)).toBe(true);
        expect(piperUrls[1].endsWith(SHERPA_TTS_VOICES[0].archiveName)).toBe(true);

        const kokoro = resolveSherpaTtsVoice('kokoro-en-US-bella');
        const kokoroUrls = sherpaTtsDownloadUrls(kokoro);
        expect(kokoroUrls).toHaveLength(1);
        expect(kokoroUrls[0]).toContain('github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/');
        expect(kokoroUrls[0].endsWith('kokoro-int8-en-v0_19.tar.bz2')).toBe(true);
    });
});
