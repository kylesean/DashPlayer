import type { AiApiFormat } from '@/common/utils/cloud-ai-api-format';

/**
 * AI 服务商预设模板（精简维护主流四家：OpenAI、Anthropic、Gemini、DeepSeek）。
 *
 * 预设只回填接入地址与协议格式，不预设模型列表，由用户手动输入模型 ID 并测试。
 */
export interface CloudAiProviderPreset {
    /** 预设唯一标识。 */
    id: string;
    /** 厂商显示名。 */
    name: string;
    /** API 协议格式。 */
    apiFormat: AiApiFormat;
    /** 接口完整 base URL（含 /v1 等版本路径）。 */
    endpoint: string;
    /** 官方 API 文档地址。 */
    docsUrl: string;
}

/**
 * 判断接口地址是否为本机或局域网本地推理接口（本地接口通常无需 API Key）。
 */
export function isLocalLlmEndpoint(endpoint: string): boolean {
    const trimmed = endpoint.trim();
    if (!trimmed) return false;
    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        if (
            host === 'localhost'
            || host === '127.0.0.1'
            || host === '::1'
            || host === '[::1]'
            || host === '0.0.0.0'
            || host.endsWith('.local')
        ) {
            return true;
        }
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        const match172 = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
        if (match172) {
            const second = Number(match172[1]);
            if (second >= 16 && second <= 31) return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * 仅保留四家主流预设：OpenAI、Anthropic、Gemini、DeepSeek。
 */
export const CLOUD_AI_PROVIDER_PRESETS: CloudAiProviderPreset[] = [
    {
        id: 'deepseek',
        name: 'DeepSeek',
        apiFormat: 'openai',
        endpoint: 'https://api.deepseek.com/v1',
        docsUrl: 'https://api-docs.deepseek.com',
    },
    {
        id: 'openai',
        name: 'OpenAI',
        apiFormat: 'openai-responses',
        endpoint: 'https://api.openai.com/v1',
        docsUrl: 'https://platform.openai.com/docs',
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        apiFormat: 'anthropic',
        endpoint: 'https://api.anthropic.com/v1',
        docsUrl: 'https://docs.anthropic.com',
    },
    {
        id: 'google-gemini',
        name: 'Gemini',
        apiFormat: 'gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        docsUrl: 'https://ai.google.dev/gemini-api/docs',
    },
];
