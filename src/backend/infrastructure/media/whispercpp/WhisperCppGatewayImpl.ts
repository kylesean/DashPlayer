import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import * as path from 'path';
import type SpeechRecognitionGateway from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import { type SpeechRecognitionRequest, type SpeechRecognitionResult } from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import { WhisperCppAbnormalExitError, WhisperCppCli } from '@/backend/infrastructure/media/whispercpp/WhisperCppCli';
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
 * Windows 结构化异常退出码（NTSTATUS）：GPU 驱动崩溃在 Windows 上
 * 不产生 POSIX 信号，而是以这些退出码结束进程（signal 为 null）。
 * 按现有 marker 门控会漏掉 Windows 的全部崩溃，必须并入判定。
 */
const WINDOWS_CRASH_EXIT_CODES = new Set<number>([
    0xC0000005, // STATUS_ACCESS_VIOLATION（内存访问冲突，即 Windows 版 SIGSEGV）
    0xC00000FD, // STATUS_STACK_OVERFLOW
    0xC0000409, // STATUS_STACK_BUFFER_OVERRUN
    0x8007000E, // STATUS_NO_MEMORY（内存耗尽，即 OOM）
]);

/** POSIX 崩溃信号集合；SIGKILL 不在内——它是主动终止手段，不是崩溃。 */
const CRASH_SIGNALS = new Set(['SIGSEGV', 'SIGILL', 'SIGABRT', 'SIGBUS', 'SIGFPE']);

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
            // 只有带 GPU 崩溃特征的失败才值得整轮重跑：输出契约解析失败、音频损坏等
            // 确定性错误重跑也必然失败，直接抛出，别让每个分片白跑一轮 CPU。
            if (!this.isGpuCrash(error)) throw error;
            return await this.retryOnCpu(request, modelPath, error);
        }
    }

    /** 终止当前 whisper.cpp 识别进程。 */
    public cancelActive(job?: string): void {
        this.cli.killActive(job);
    }

    /**
     * 判定一次失败是否带 GPU 崩溃特征。
     *
     * 三条线索任一命中即算：错误文案命中 {@link GPU_CRASH_MARKERS}（POSIX 与
     * stderr 字样）、进程被崩溃信号终止（SIGSEGV 等，不含主动终止的 SIGKILL）、
     * Windows 下以结构化异常退出码（NTSTATUS）结束。
     *
     * @param error GPU 尝试的失败原因。
     */
    private isGpuCrash(error: unknown): boolean {
        const message = String((error as Error)?.message ?? '');
        if (GPU_CRASH_MARKERS.some((marker) => message.includes(marker))) {
            return true;
        }
        if (error instanceof WhisperCppAbnormalExitError) {
            if (error.signal !== null && CRASH_SIGNALS.has(error.signal)) {
                return true;
            }
            return error.exitCode !== null && WINDOWS_CRASH_EXIT_CODES.has(error.exitCode);
        }
        return false;
    }

    /**
     * GPU 尝试失败后的 CPU 重试：记录归因日志后禁用 Vulkan 重跑一次；
     * CPU 也失败时抛出后一次的原始错误。
     */
    private async retryOnCpu(
        request: SpeechRecognitionRequest,
        modelPath: string,
        gpuError: unknown,
    ): Promise<SpeechRecognitionResult> {
        const message = String((gpuError as Error)?.message ?? gpuError ?? '');
        this.logger.warn('whisper.cpp GPU 尝试失败，回退 CPU 重试', {
            job: request.job,
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
