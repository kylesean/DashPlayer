/** API 兼容格式：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Gemini generateContent。 */
export type AiApiFormat = 'openai' | 'openai-responses' | 'anthropic' | 'gemini';

/** 全部合法的 API 格式，设置项校验与前端下拉共用。 */
export const AI_API_FORMATS: readonly AiApiFormat[] = [
    'openai',
    'openai-responses',
    'anthropic',
    'gemini',
];
