/**
 * 本句 ContextPack 的共享 SWR 键。
 *
 * 建议 chip 与词卡都要读同一份 ContextPack：chip 需要建议词，词卡需要
 * 「为什么此刻提示」的理由。用同一个键让 SWR 去重，避免同句发两次请求。
 *
 * @param sentence 目标句。
 * @param guidance 当前提示强度。
 * @returns SWR 键；不主动提示的强度返回 null。
 */
export const contextPackKey = (
    sentence: { fileHash: string; index: number; text: string },
    guidance: string,
): readonly [string, string, number, string, string] | null =>
    guidance === 'coach' || guidance === 'intensive'
        ? ['vocabulary/context-pack', sentence.fileHash, sentence.index, sentence.text, guidance] as const
        : null;
