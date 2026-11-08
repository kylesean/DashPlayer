/**
 * 归一化本地模型的结构化输出。
 *
 * LocalAiRuntime.generate 的契约是返回「已 JSON.parse 的对象」，
 * 但历史调用方与桩实现可能仍返回原始字符串；两种形态都归一为对象，
 * 避免 JSON.parse 收到对象时抛出 `"[object Object]" is not valid JSON`。
 *
 * @param value 模型输出的对象或字符串。
 * @returns 对象形态；字符串能解析则返回解析结果，否则原样返回（交由 zod 校验给出明确错误）。
 */
export const parseMaybeJson = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};
