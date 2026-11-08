import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import * as path from 'path';
import type SpeechRecognitionGateway from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import { type SpeechRecognitionRequest, type SpeechRecognitionResult } from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import { WhisperCppCli } from '@/backend/infrastructure/media/whispercpp/WhisperCppCli';
import { WHISPER_CPP_MODEL_DIRECTORY, WHISPER_CPP_REQUIRED_FILES } from '@/backend/services/models/whisperCppModel';

/**
 * whisper.cpp 识别线程数。
 *
 * 实测（Intel Ultra 5 228V）：核显模式下线程数几乎不影响耗时（瓶颈在 GPU），
 * CPU 模式下 4 线程最优，故固定为 4。
 */
const WHISPER_CPP_NUM_THREADS = 4;

/**
 * GPU 层崩溃的特征标记：Vulkan 显存分配失败会直接把进程带崩（SIGSEGV），
 * stderr 里携带这些字样。命中即用禁用 Vulkan 的 CPU 模式重试一次。
 */
const GPU_CRASH_MARKERS = [
    'SIGSEGV',
    'SIGILL',
    'SIGABRT',
    'ErrorOutOfDeviceMemory',
    'failed to allocate Vulkan',
    'vk::Device::allocateMemory',
] as const;

/**
 * 基于 whisper.cpp parakeet-cli 与 Parakeet v3 GGUF 的本地识别网关。
 *
 * 相比 sherpa-onnx CPU 方案：核显（Vulkan/Metal）加速后 RTF 约 0.02，
 * 为 sherpa-onnx CPU 的 1/4 左右，且进程内存显著更低。
 *
 * Vulkan 设备选择由 ggml 决定（通常 device 0），可能落到显存预算紧张的集显上：
 * GPU 尝试崩溃（如显存分配失败 SIGSEGV）时，自动禁用 Vulkan 以纯 CPU 重试一次——
 * 二进制对"枚举不到 GPU"有内建的静默 CPU 回退路径，结果正确仅速度慢。
 */
@injectable()
export default class WhisperCppGatewayImpl implements SpeechRecognitionGateway {
    private readonly logger = getMainLogger('WhisperCppGateway');

    constructor(@inject(TYPES.WhisperCppCli) private readonly cli: WhisperCppCli) {}

    /**
     * 使用 Parakeet v3 GGUF（q8_0）模型识别音频。
     * @param request 音频路径、模型目录与生命周期回调。
     * @returns 完整文本及带起止时间的子词时间轴。
     */
    public async transcribe(request: SpeechRecognitionRequest): Promise<SpeechRecognitionResult> {
        const modelDir = path.join(request.modelsRoot, WHISPER_CPP_MODEL_DIRECTORY);
        for (const fileName of WHISPER_CPP_REQUIRED_FILES) {
            const filePath = path.join(modelDir, fileName);
            if (!fs.existsSync(filePath)) {
                throw new Error(`whisper.cpp 模型文件缺失：${filePath}，请先在设置中心下载模型`);
            }
        }
        const modelPath = path.join(modelDir, WHISPER_CPP_REQUIRED_FILES[0]);

        try {
            return await this.run(request, modelPath, false);
        } catch (error) {
            // 用户主动取消与模型缺失不属于 GPU 层问题，不做 CPU 重试
            if (error instanceof CancelByUserError) throw error;
            if (String((error as Error)?.message ?? '').includes('模型文件缺失')) throw error;
            return await this.retryOnCpu(request, modelPath, error);
        }
    }

    /** 终止当前 whisper.cpp 识别进程。 */
    public cancelActive(): void {
        this.cli.killActive();
    }

    /**
     * GPU 尝试失败后的 CPU 重试：识别错误是否带 GPU 崩溃特征并记录归因日志，
     * 随后禁用 Vulkan 重跑一次；CPU 也失败时抛出后一次的原始错误。
     */
    private async retryOnCpu(
        request: SpeechRecognitionRequest,
        modelPath: string,
        gpuError: unknown,
    ): Promise<SpeechRecognitionResult> {
        const message = String((gpuError as Error)?.message ?? gpuError ?? '');
        const gpuCrash = GPU_CRASH_MARKERS.some((marker) => message.includes(marker));
        this.logger.warn('whisper.cpp GPU 尝试失败，回退 CPU 重试', {
            job: request.job,
            gpuCrash,
            error: message.slice(0, 500),
        });
        return this.run(request, modelPath, true);
    }

    private run(
        request: SpeechRecognitionRequest,
        modelPath: string,
        disableGpu: boolean,
    ): Promise<SpeechRecognitionResult> {
        return this.cli.run({
            modelPath,
            audioPath: request.audioPath,
            numThreads: WHISPER_CPP_NUM_THREADS,
            job: request.job,
            disableGpu,
            isCancelled: request.isCancelled,
            onHeartbeat: request.onHeartbeat,
        }).then((output) => ({
            text: output.text,
            tokens: output.tokens,
        }));
    }
}
