import { createHash } from 'node:crypto';

import type { SceneSentence, SpeakerInterval } from '@/common/learning/sceneSegmentation';

/**
 * 计算场景切分的输入指纹。
 *
 * 只包含真正影响结果的字段：句子序号、起止时间与文本。中文译文、翻译分组
 * 等字段不影响边界判定，放进指纹只会让缓存无谓失效。
 *
 * @param sentences 按 index 升序的字幕句。
 * @param speakerIntervals 可选的声纹区间；参与判定，因此必须进指纹。
 * @param visualShifts 可选的画面切换点；同样参与判定，必须进指纹。
 * @returns 十六进制 SHA-256。
 */
export function sceneInputHash(
    sentences: readonly SceneSentence[],
    speakerIntervals: readonly SpeakerInterval[] = [],
    visualShifts: readonly number[] = [],
): string {
    const hash = createHash('sha256');
    for (const sentence of sentences) {
        // 用分隔符避免相邻字段拼接产生歧义（例如 1.23 + 4 与 1.2 + 34）。
        hash.update(`${sentence.index}\u001f${sentence.start}\u001f${sentence.end}\u001f${sentence.text}\u001e`);
    }
    // 声纹区间变化会改变 speaker-shift 结果，指纹必须随之变化，
    // 否则重新分离后仍会命中按旧声纹算出的缓存。
    if (speakerIntervals.length > 0) {
        hash.update('\u001d');
        for (const interval of speakerIntervals) {
            hash.update(`${interval.start}\u001f${interval.end}\u001f${interval.speaker}\u001e`);
        }
    }
    if (visualShifts.length > 0) {
        hash.update('\u001c');
        for (const shift of visualShifts) {
            hash.update(`${shift}\u001e`);
        }
    }
    return hash.digest('hex');
}
