import { createHash } from 'node:crypto';

import type { SceneSentence } from '@/common/learning/sceneSegmentation';

/**
 * 计算场景切分的输入指纹。
 *
 * 只包含真正影响结果的字段：句子序号、起止时间与文本。中文译文、翻译分组
 * 等字段不影响边界判定，放进指纹只会让缓存无谓失效。
 *
 * @param sentences 按 index 升序的字幕句。
 * @returns 十六进制 SHA-256。
 */
export function sceneInputHash(sentences: readonly SceneSentence[]): string {
    const hash = createHash('sha256');
    for (const sentence of sentences) {
        // 用分隔符避免相邻字段拼接产生歧义（例如 1.23 + 4 与 1.2 + 34）。
        hash.update(`${sentence.index}\u001f${sentence.start}\u001f${sentence.end}\u001f${sentence.text}\u001e`);
    }
    return hash.digest('hex');
}
