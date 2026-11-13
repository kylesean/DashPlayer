import type { SystemInfo } from '@/common/contracts/system-info';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';
import { LOCAL_AI_DEFAULT_MODEL_ID, LOCAL_AI_MODELS, type LocalAiTier } from '@/common/contracts/local-ai';

/**
 * 本机引导方案预设档位：
 * - `standard`: ≥ 8GB 内存默认推荐，离线开箱即用（ASR + TTS + WordNet + 推荐档位 Local LLM + 文本 Embedding）
 * - `light`: < 8GB 内存或空间受限推荐，最小核心体验（ASR + TTS + WordNet）
 */
export type OnboardingTier = 'standard' | 'light';

/** 单个本地模型相对本机硬件的适配度评估。 */
export type ModelFitLevel = 'recommended' | 'compatible' | 'heavy';

/** 本机硬件能力评估结果，前后端共用单一事实来源。 */
export interface HardwareProfileAdvice {
    /** 当前平台是否支持 whisper.cpp 硬件加速运行时。 */
    whisperCppSupported: boolean;
    /** 推荐的字幕识别引擎（仅当平台支持 whisper.cpp 且有 GPU 时推 whisper-cpp）。 */
    recommendedTranscriptionEngine: TranscriptionEngine;
    /** 引导页推荐方案档位。 */
    recommendedOnboardingTier: OnboardingTier;
    /** 推荐的内置本地大模型 ID（依据内存与 GPU 计算）。 */
    recommendedLocalModelId: string;
    /** 当内存或算力偏紧时，提示优先接入云端 AI 模型获得更快响应。 */
    preferCloudLlm: boolean;
}

/**
 * 判定指定平台/架构是否随包携带 whisper.cpp (`parakeet-cli`) 运行时。
 * 与 `scripts/download.mjs` 中的 `supportedArchs` 保持完全一致。
 */
export function isWhisperCppSupportedPlatform(platform: string, arch: string): boolean {
    if (platform === 'darwin') {
        return arch === 'arm64' || arch === 'x64';
    }
    if (platform === 'linux' || platform === 'win32') {
        return arch === 'x64';
    }
    return false;
}

/**
 * 根据本机硬件信息计算最优引擎与模型档位建议。
 *
 * 规则：
 * - ASR 引擎：平台支持 whisper.cpp 且存在 GPU（Metal/Vulkan）时推荐 `whisper-cpp`；
 *   否则（如 ARM64 Windows/Linux、Intel Mac、无核显/独显主机）推荐 `sherpa-onnx`。
 * - 引导包档位：内存 ≥ 8 GB 默认推荐标准全能包；< 8 GB 推荐轻量离线包并引导云端 API。
 * - 本地 LLM 档位：
 *   - ≥ 16 GB 且有 GPU：推荐 4B 高配档 (`qwen3.5-4b-q4_k_m`)
 *   - ≥ 8 GB（有 GPU，或 ≥ 12 GB 纯 CPU）：推荐 2B 均衡档 (`qwen3.5-2b-q4_k_m`)
 *   - 其他（< 8 GB，或 8 GB 无 GPU）：推荐 0.8B 轻量档 (`qwen3.5-0.8b-q4_k_m`)，且 `< 8 GB` 时标明建议优先云端。
 */
export function evaluateHardwareProfile(hardware: SystemInfo | null | undefined): HardwareProfileAdvice {
    if (!hardware) {
        return {
            whisperCppSupported: true,
            recommendedTranscriptionEngine: 'whisper-cpp',
            recommendedOnboardingTier: 'standard',
            recommendedLocalModelId: LOCAL_AI_DEFAULT_MODEL_ID,
            preferCloudLlm: false,
        };
    }

    const whisperCppSupported = hardware.whisperCppSupported ?? (
        hardware.platform && hardware.arch
            ? isWhisperCppSupportedPlatform(hardware.platform, hardware.arch)
            : true
    );
    const hasGpu = hardware.gpuAcceleration !== 'none';
    const recommendedTranscriptionEngine: TranscriptionEngine = whisperCppSupported && hasGpu
        ? 'whisper-cpp'
        : 'sherpa-onnx';

    const mem = hardware.totalMemoryGb;
    const recommendedOnboardingTier: OnboardingTier = mem >= 8 ? 'standard' : 'light';
    const preferCloudLlm = mem < 8;

    let recommendedLocalModelId = LOCAL_AI_DEFAULT_MODEL_ID;
    if (mem >= 16 && hasGpu) {
        recommendedLocalModelId = 'qwen3.5-4b-q4_k_m';
    } else if (mem >= 8 && (hasGpu || mem >= 12)) {
        recommendedLocalModelId = 'qwen3.5-2b-q4_k_m';
    } else {
        recommendedLocalModelId = 'qwen3.5-0.8b-q4_k_m';
    }

    if (!LOCAL_AI_MODELS.some((m) => m.id === recommendedLocalModelId)) {
        recommendedLocalModelId = LOCAL_AI_DEFAULT_MODEL_ID;
    }

    return {
        whisperCppSupported,
        recommendedTranscriptionEngine,
        recommendedOnboardingTier,
        recommendedLocalModelId,
        preferCloudLlm,
    };
}

/**
 * 评估单个内置/自定义模型对当前设备的适配度，用于在设置页展示徽标或风险提示。
 */
export function assessLocalModelFit(
    modelId: string,
    tier: LocalAiTier | undefined,
    recommendedMinMemoryGb: number | undefined,
    hardware: SystemInfo | null | undefined,
): ModelFitLevel {
    if (!hardware) {
        return modelId === LOCAL_AI_DEFAULT_MODEL_ID ? 'recommended' : 'compatible';
    }
    const advice = evaluateHardwareProfile(hardware);
    if (modelId === advice.recommendedLocalModelId) {
        return 'recommended';
    }
    if (recommendedMinMemoryGb !== undefined && hardware.totalMemoryGb < recommendedMinMemoryGb) {
        return 'heavy';
    }
    if (tier === 'pro' && hardware.gpuAcceleration === 'none' && hardware.totalMemoryGb < 16) {
        return 'heavy';
    }
    return 'compatible';
}

/**
 * 判断本机硬件是否能够流畅稳定运行本地 AI 模型而不牺牲翻译与讲解体验。
 */
export function isHardwareSuitableForLocalAi(hardware: SystemInfo | null | undefined): boolean {
    if (!hardware) return false;
    return hardware.totalMemoryGb >= 8 && (hardware.gpuAcceleration !== 'none' || hardware.totalMemoryGb >= 12);
}
