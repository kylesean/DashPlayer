import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import type { ComprehensionDifficulty } from '@/common/types/subtitleComprehension';

/**
 * 将预置词典频率与考纲标签映射为理解度难度档位。
 *
 * @param entry 本地词典词条；未命中时为 null。
 * @returns 可解释的难度档位。
 */
export const resolveDictionaryDifficulty = (
    entry: OpenAIDictionaryResult | null,
): ComprehensionDifficulty => {
    if (!entry) {
        return 'unknown';
    }
    const tags = new Set(entry.tags ?? []);
    if (
        (entry.oxford ?? 0) > 0
        || (entry.collins ?? 0) >= 4
        || ((entry.bnc ?? 0) > 0 && (entry.bnc ?? 0) <= 2000)
        || tags.has('zk')
    ) {
        return 'basic';
    }
    if (
        ((entry.bnc ?? 0) > 0 && (entry.bnc ?? 0) <= 5000)
        || (entry.collins ?? 0) >= 3
        || tags.has('gk')
        || tags.has('cet4')
    ) {
        return 'common';
    }
    if (tags.has('cet6') || tags.has('ky')) {
        return 'exam';
    }
    if (tags.has('toefl') || tags.has('ielts') || tags.has('gre')) {
        return 'advanced';
    }
    return 'unknown';
};
