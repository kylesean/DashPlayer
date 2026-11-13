import { describe, expect, it } from 'vitest';
import {
    assessLocalModelFit,
    evaluateHardwareProfile,
    isHardwareSuitableForLocalAi,
    isWhisperCppSupportedPlatform,
} from '@/common/utils/hardware-profile';
import { isLocalLlmEndpoint } from '@/common/constants/cloud-ai-provider-presets';
import type { SystemInfo } from '@/common/contracts/system-info';

const macM3: SystemInfo = {
    totalMemoryGb: 16,
    cpuCount: 8,
    gpuAcceleration: 'metal',
    platform: 'darwin',
    arch: 'arm64',
    whisperCppSupported: true,
};

const midWinGpu: SystemInfo = {
    totalMemoryGb: 8,
    cpuCount: 8,
    gpuAcceleration: 'vulkan',
    platform: 'win32',
    arch: 'x64',
    whisperCppSupported: true,
};

const lowRamNoGpu: SystemInfo = {
    totalMemoryGb: 4,
    cpuCount: 4,
    gpuAcceleration: 'none',
    platform: 'win32',
    arch: 'x64',
    whisperCppSupported: true,
};

const arm64Windows: SystemInfo = {
    totalMemoryGb: 16,
    cpuCount: 8,
    gpuAcceleration: 'vulkan',
    platform: 'win32',
    arch: 'arm64',
    whisperCppSupported: false,
};

describe('hardware-profile', () => {
    describe('isWhisperCppSupportedPlatform', () => {
        it('supports darwin arm64/x64 and win32/linux x64 only', () => {
            expect(isWhisperCppSupportedPlatform('darwin', 'arm64')).toBe(true);
            expect(isWhisperCppSupportedPlatform('darwin', 'x64')).toBe(true);
            expect(isWhisperCppSupportedPlatform('win32', 'x64')).toBe(true);
            expect(isWhisperCppSupportedPlatform('linux', 'x64')).toBe(true);
            expect(isWhisperCppSupportedPlatform('win32', 'arm64')).toBe(false);
            expect(isWhisperCppSupportedPlatform('linux', 'arm64')).toBe(false);
        });
    });

    describe('evaluateHardwareProfile', () => {
        it('recommends 4b, standard tier, and whisper-cpp on 16GB+ GPU hardware', () => {
            const advice = evaluateHardwareProfile(macM3);
            expect(advice.whisperCppSupported).toBe(true);
            expect(advice.recommendedTranscriptionEngine).toBe('whisper-cpp');
            expect(advice.recommendedOnboardingTier).toBe('standard');
            expect(advice.recommendedLocalModelId).toBe('qwen3.5-4b-q4_k_m');
            expect(advice.preferCloudLlm).toBe(false);
        });

        it('recommends 2b, standard tier, and whisper-cpp on 8GB GPU hardware', () => {
            const advice = evaluateHardwareProfile(midWinGpu);
            expect(advice.recommendedTranscriptionEngine).toBe('whisper-cpp');
            expect(advice.recommendedOnboardingTier).toBe('standard');
            expect(advice.recommendedLocalModelId).toBe('qwen3.5-2b-q4_k_m');
            expect(advice.preferCloudLlm).toBe(false);
        });

        it('recommends light tier, 0.8b, preferCloudLlm, and sherpa-onnx on <8GB no-GPU hardware', () => {
            const advice = evaluateHardwareProfile(lowRamNoGpu);
            expect(advice.recommendedTranscriptionEngine).toBe('sherpa-onnx');
            expect(advice.recommendedOnboardingTier).toBe('light');
            expect(advice.recommendedLocalModelId).toBe('qwen3.5-0.8b-q4_k_m');
            expect(advice.preferCloudLlm).toBe(true);
        });

        it('falls back to sherpa-onnx when platform does not bundle whisper.cpp runtime', () => {
            const advice = evaluateHardwareProfile(arm64Windows);
            expect(advice.whisperCppSupported).toBe(false);
            expect(advice.recommendedTranscriptionEngine).toBe('sherpa-onnx');
            expect(advice.recommendedOnboardingTier).toBe('standard');
        });
    });

    describe('assessLocalModelFit', () => {
        it('returns recommended, compatible, and heavy accurately against device memory & GPU', () => {
            expect(assessLocalModelFit('qwen3.5-2b-q4_k_m', 'standard', 8, midWinGpu)).toBe('recommended');
            expect(assessLocalModelFit('qwen3.5-0.8b-q4_k_m', 'light', 6, midWinGpu)).toBe('compatible');
            expect(assessLocalModelFit('qwen3.5-4b-q4_k_m', 'pro', 16, midWinGpu)).toBe('heavy');
            expect(assessLocalModelFit('qwen3.5-4b-q4_k_m', 'pro', 16, { ...midWinGpu, totalMemoryGb: 12, gpuAcceleration: 'none' })).toBe('heavy');
        });
    });

    describe('isHardwareSuitableForLocalAi', () => {
        it('returns true for >=8GB GPU or >=12GB CPU and false for low-spec CPU', () => {
            expect(isHardwareSuitableForLocalAi(macM3)).toBe(true);
            expect(isHardwareSuitableForLocalAi(midWinGpu)).toBe(true);
            expect(isHardwareSuitableForLocalAi({ ...lowRamNoGpu, totalMemoryGb: 12 })).toBe(true);
            expect(isHardwareSuitableForLocalAi(lowRamNoGpu)).toBe(false);
            expect(isHardwareSuitableForLocalAi(null)).toBe(false);
        });
    });

    describe('isLocalLlmEndpoint', () => {
        it('detects localhost, loopback, LAN IPs and rejects public cloud endpoints', () => {
            expect(isLocalLlmEndpoint('http://localhost:11434/v1')).toBe(true);
            expect(isLocalLlmEndpoint('http://127.0.0.1:1234/v1')).toBe(true);
            expect(isLocalLlmEndpoint('http://192.168.1.25:8080/v1')).toBe(true);
            expect(isLocalLlmEndpoint('https://api.deepseek.com/v1')).toBe(false);
            expect(isLocalLlmEndpoint('https://api.openai.com/v1')).toBe(false);
        });
    });
});
