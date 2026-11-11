import type {
    VocabularyGuidance,
    WordStatus,
} from '@/common/types/vocabulary';

/** 正文注释的视觉类型；null 表示不标记。 */
export type VocabularyAnnotationKind = 'learning' | 'familiar' | null;

/**
 * 将词状态与提示强度投影为正文注释。
 *
 * 这是播放器里唯一决定「词要不要画线」的纯函数：
 * - off: 全部不标记；
 * - calm: 只标记 learning；
 * - coach: 标记 learning，并用更弱的样式标记 familiar。
 *
 * known / ignored 永远不标记，推荐层未来也只通过独立通道出现，不污染正文。
 *
 * @param status 单词状态。
 * @param guidance 当前提示强度。
 * @returns 注释类型。
 */
export function resolveVocabularyAnnotation(
    status: WordStatus | undefined,
    guidance: VocabularyGuidance,
): VocabularyAnnotationKind {
    if (!status || guidance === 'off') {
        return null;
    }
    if (status === 'learning') {
        return 'learning';
    }
    if (status === 'familiar' && guidance === 'coach') {
        return 'familiar';
    }
    return null;
}
