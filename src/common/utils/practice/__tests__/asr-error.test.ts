import { describe, expect, it } from 'vitest';

import { describeAsrFailure, isNoSpeechError } from '../asr-error';

/** parakeet 在静音输入下的真实异常形态。 */
const NO_SPEECH_STDERR = [
    'whisper.cpp 未返回识别文本：parakeet_init: using Vulkan0',
    'parakeet_init: n_threads = 4 / 24',
    'parakeet_print_timings: encode time = 499.95 ms',
    'Segments (0):',
].join('\n');

describe('ASR 失败信息可读化', () => {
    it('识别出「没有语音」类错误', () => {
        expect(isNoSpeechError(NO_SPEECH_STDERR)).toBe(true);
        expect(isNoSpeechError('录音内容为空')).toBe(true);
        expect(isNoSpeechError('模型文件缺失')).toBe(false);
    });

    it('把整段 C++ stderr 压成一句可操作提示', () => {
        const message = describeAsrFailure(new Error(NO_SPEECH_STDERR));

        expect(message).toBe('没有识别到英文语音。请确认对着麦克风用英语朗读，且麦克风没有被静音。');
        // 原始日志一个字都不该出现在界面文案里
        expect(message).not.toContain('Vulkan');
        expect(message).not.toContain('Segments');
    });

    it('剥掉 Electron IPC 的错误前缀', () => {
        const message = describeAsrFailure(
            new Error("Error invoking remote method 'call': Error: " + NO_SPEECH_STDERR),
        );

        expect(message).not.toContain('Error invoking remote method');
        expect(message).toContain('没有识别到英文语音');
    });

    it('非语音类错误保留首行，不伪装成用户操作问题', () => {
        const message = describeAsrFailure(new Error('模型文件缺失\n第二行细节'));

        expect(message).toBe('模型文件缺失');
    });

    it('非 parakeet 的静音错误给出通用提示', () => {
        const message = describeAsrFailure(new Error('whisper.cpp 未返回识别文本：Segments (0):'));

        expect(message).toBe('没有识别到语音。请靠近麦克风、避开环境噪音后重试。');
    });
});
