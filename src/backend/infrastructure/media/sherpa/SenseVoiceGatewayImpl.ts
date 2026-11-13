import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import * as path from 'path';
import type SpeechRecognitionGateway from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import { type SpeechRecognitionRequest, type SpeechRecognitionResult } from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import TYPES from '@/backend/ioc/types';
import { SherpaOnnxCli } from '@/backend/infrastructure/media/sherpa/SherpaOnnxCli';
import {
    SENSE_VOICE_MODEL_DIRECTORY,
    SENSE_VOICE_MODEL_FILE,
    SENSE_VOICE_TOKENS_FILE,
} from '@/backend/services/models/senseVoiceModel';

/** 剥除 SenseVoice 模型可能附带的语言 / 情感 / 事件控制标记（例如 `<|zh|>`, `<|NEUTRAL|>`, `<|withitn|>`）。 */
export function cleanSenseVoiceText(raw: string): string {
    return raw
        .replace(/<\|[^|>]+\|>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 基于 sherpa-onnx CLI 与 SenseVoiceSmall INT8 的离线多语种（中/英/粤/日/韩）识别网关。
 */
@injectable()
export default class SenseVoiceGatewayImpl implements SpeechRecognitionGateway {
    constructor(@inject(TYPES.SherpaOnnxCli) private readonly cli: SherpaOnnxCli) {}

    /**
     * 使用 SenseVoiceSmall 模型识别中文、英文或中英混说语音。
     */
    public async transcribe(request: SpeechRecognitionRequest): Promise<SpeechRecognitionResult> {
        const modelDir = path.join(request.modelsRoot, SENSE_VOICE_MODEL_DIRECTORY);
        const files = {
            model: path.join(modelDir, SENSE_VOICE_MODEL_FILE),
            tokens: path.join(modelDir, SENSE_VOICE_TOKENS_FILE),
        };
        for (const [name, filePath] of Object.entries(files)) {
            if (!fs.existsSync(filePath)) {
                throw new Error(`SenseVoice 模型文件缺失（${name}）：${filePath}`);
            }
        }

        const output = await this.cli.run({
            args: [
                `--sense-voice-model=${files.model}`,
                `--tokens=${files.tokens}`,
                '--sense-voice-language=auto',
                '--sense-voice-use-itn=true',
                '--num-threads=2',
                request.audioPath,
            ],
            audioPath: request.audioPath,
            job: request.job,
            isCancelled: request.isCancelled,
            onHeartbeat: request.onHeartbeat,
        });

        return {
            text: cleanSenseVoiceText(output.text),
            tokens: output.tokens.map((text, index) => ({
                text: cleanSenseVoiceText(text.replace(/▁/g, ' ')),
                start: output.timestamps[index],
            })),
        };
    }

    public cancelActive(job?: string): void {
        this.cli.killActive(job);
    }
}
