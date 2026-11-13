import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SherpaOnnxCli } from '@/backend/infrastructure/media/sherpa/SherpaOnnxCli';
import SenseVoiceGatewayImpl, { cleanSenseVoiceText } from '../SenseVoiceGatewayImpl';
import {
    SENSE_VOICE_MODEL_DIRECTORY,
    SENSE_VOICE_MODEL_FILE,
    SENSE_VOICE_TOKENS_FILE,
} from '@/backend/services/models/senseVoiceModel';

describe('cleanSenseVoiceText', () => {
    it('剥离语言/情感/事件/ITN 标记并规整空白', () => {
        expect(cleanSenseVoiceText('<|zh|><|NEUTRAL|><|Speech|><|withitn|>这句台词是什么意思？')).toBe(
            '这句台词是什么意思？',
        );
        expect(cleanSenseVoiceText('<|en|><|HAPPY|> What does break a leg   mean? <|woitn|>')).toBe(
            'What does break a leg mean?',
        );
    });
});

describe('SenseVoiceGatewayImpl', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('模型文件齐全时传入 --sense-voice-* 参数并清洗输出文本', async () => {
        const modelsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-sensevoice-test-'));
        tempDirs.push(modelsRoot);
        const modelDir = path.join(modelsRoot, SENSE_VOICE_MODEL_DIRECTORY);
        fs.mkdirSync(modelDir, { recursive: true });
        fs.writeFileSync(path.join(modelDir, SENSE_VOICE_MODEL_FILE), '');
        fs.writeFileSync(path.join(modelDir, SENSE_VOICE_TOKENS_FILE), '');

        const runMock = vi.fn().mockResolvedValue({
            text: '<|zh|><|withitn|>请解释一下这个短语',
            tokens: ['▁请', '解释', '一下'],
            timestamps: [0.1, 0.3, 0.5],
        });
        const cli = { run: runMock, killActive: vi.fn() } as unknown as SherpaOnnxCli;
        const gateway = new SenseVoiceGatewayImpl(cli);

        const result = await gateway.transcribe({
            audioPath: '/tmp/chat.wav',
            modelsRoot,
            job: 'chat-dictation',
        });

        expect(runMock).toHaveBeenCalledWith(expect.objectContaining({
            audioPath: '/tmp/chat.wav',
            job: 'chat-dictation',
            args: [
                `--sense-voice-model=${path.join(modelDir, SENSE_VOICE_MODEL_FILE)}`,
                `--tokens=${path.join(modelDir, SENSE_VOICE_TOKENS_FILE)}`,
                '--sense-voice-language=auto',
                '--sense-voice-use-itn=true',
                '--num-threads=2',
                '/tmp/chat.wav',
            ],
        }));
        expect(result.text).toBe('请解释一下这个短语');
        expect(result.tokens).toEqual([
            { text: '请', start: 0.1 },
            { text: '解释', start: 0.3 },
            { text: '一下', start: 0.5 },
        ]);
    });

    it('缺少模型权重时立即抛出清晰错误而不调用 CLI', async () => {
        const modelsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-sensevoice-missing-'));
        tempDirs.push(modelsRoot);
        const cli = { run: vi.fn(), killActive: vi.fn() } as unknown as SherpaOnnxCli;
        const gateway = new SenseVoiceGatewayImpl(cli);

        await expect(
            gateway.transcribe({ audioPath: '/tmp/chat.wav', modelsRoot }),
        ).rejects.toThrow('SenseVoice 模型文件缺失（model）');
    });
});
