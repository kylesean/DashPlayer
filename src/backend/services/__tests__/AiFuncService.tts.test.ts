import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { AiFuncServiceImpl } from '@/backend/services/AiFuncService';
import {
    extractSingleEnglishWord,
    isValidAudioBuffer,
} from '@/backend/services/tts/DictionaryPronunciationFetcher';
import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type LocalTtsService from '@/backend/services/LocalTtsService';

const makeValidMp3Buffer = () => {
    const buf = Buffer.alloc(1024, 0);
    // ID3 header magic
    buf[0] = 0x49;
    buf[1] = 0x44;
    buf[2] = 0x33;
    return buf;
};

describe('DictionaryPronunciationFetcher & AiFuncService 语音路由', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('只把纯英文单词识别为词典真人发音对象，句子直接交由本地 TTS', () => {
        expect(extractSingleEnglishWord('approach')).toBe('approach');
        expect(extractSingleEnglishWord("don’t")).toBe("don't");
        expect(extractSingleEnglishWord('well-known')).toBe('well-known');
        expect(extractSingleEnglishWord('approach that problem')).toBeNull();
        expect(extractSingleEnglishWord('12345')).toBeNull();
    });

    it('拒绝 HTML 或过小响应体，防止污染词典音频缓存', () => {
        expect(isValidAudioBuffer(Buffer.from('<html>not found</html>'), 'text/html')).toBe(false);
        expect(isValidAudioBuffer(Buffer.from('tiny'), 'audio/mpeg')).toBe(false);
        expect(isValidAudioBuffer(makeValidMp3Buffer(), 'audio/mpeg')).toBe(true);
    });

    it('单个英文单词优先拉取真人词典音频并写盘缓存，二次点击直接命中缓存', async () => {
        const fsGateway = new MemoryFileSystemGateway();
        const localTtsService: LocalTtsService = {
            synthesize: vi.fn().mockResolvedValue('/temp/tts/out.wav'),
            resolveActiveVoiceId: vi.fn().mockResolvedValue('kokoro-en-US-bella'),
        };
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(makeValidMp3Buffer(), {
                status: 200,
                headers: { 'content-type': 'audio/mpeg' },
            }),
        );

        const service = new AiFuncServiceImpl(
            localTtsService,
            { getSherpaTtsVoice: () => 'kokoro-en-GB-george' } as never,
            { provideDirectory: async (t: StorageDirectoryTarget) => (t === StorageDirectoryTarget.TEMP ? '/temp' : '/models') } as never,
            fsGateway,
        );

        const firstUrl = await service.tts('approach');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0]?.[0]).toContain('dictvoice?audio=approach&type=1');
        expect(firstUrl).toContain('word-en-GB-');
        expect(firstUrl).toContain('.mp3');
        expect(localTtsService.synthesize).not.toHaveBeenCalled();

        // 第二次调用直接命中文件缓存，不重复联网请求
        const secondUrl = await service.tts('approach');
        expect(secondUrl).toBe(firstUrl);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('词典音频拉取失败（如离线）或输入为整句时，静默回退到本地 TTS 合成', async () => {
        const fsGateway = new MemoryFileSystemGateway();
        await fsGateway.ensureDirectory('/temp/tts');
        await fsGateway.writeTextFile(path.join('/temp/tts', 'synthesized.wav'), 'RIFF....');

        const localTtsService: LocalTtsService = {
            synthesize: vi.fn().mockResolvedValue(path.join('/temp/tts', 'synthesized.wav')),
            resolveActiveVoiceId: vi.fn().mockResolvedValue('kokoro-en-US-bella'),
        };
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

        const service = new AiFuncServiceImpl(
            localTtsService,
            { getSherpaTtsVoice: () => 'kokoro-en-US-bella' } as never,
            { provideDirectory: async () => '/temp' } as never,
            fsGateway,
        );

        const url = await service.tts('approach');
        expect(localTtsService.synthesize).toHaveBeenCalledWith('approach');
        expect(url).toContain('tts-kokoro-en-US-bella-');
        expect(url).toContain('.wav');
    });
});
