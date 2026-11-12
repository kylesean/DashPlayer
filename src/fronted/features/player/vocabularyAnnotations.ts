import type {
    VocabularyGuidance,
    WordStatus,
} from '@/common/types/vocabulary';

/** 正文注释的视觉类型；null 表示不标记。 */
export type VocabularyAnnotationKind = 'learning' | 'familiar' | null;

/**
 * 注释所在的界面层。
 *
 * - subtitle: 主字幕，注意力在视频上，标记必须克制；
 * - transcript: 右侧文稿，用户已进入阅读/学习状态，可以给更多信息。
 */
export type VocabularyAnnotationSurface = 'subtitle' | 'transcript';

/**
 * 将词状态与提示强度投影为正文注释。
 *
 * 这是播放器里唯一决定「词要不要画线」的纯函数：
 * - off: 全部不标记；
 * - calm: 只标记 learning；
 * - coach: 标记 learning，并用更弱的样式标记 familiar；
 * - intensive: 与 coach 相同的标注规则——强度档位只改变主动提示的密度，
 *   不改变「哪些状态该画线」这个语义。
 *
 * known / ignored 永远不标记，推荐层未来也只通过独立通道出现，不污染正文。
 *
 * `familiar` 只在右侧文稿给弱提示：主字幕是观看场景，多一类标记就多一分干扰；
 * 文稿是学习场景，用户需要看到「哪些词有印象但还不稳」。
 *
 * @param status 单词状态。
 * @param guidance 当前提示强度。
 * @param surface 所在界面层；缺省按文稿处理。
 * @returns 注释类型。
 */
export function resolveVocabularyAnnotation(
    status: WordStatus | undefined,
    guidance: VocabularyGuidance,
    surface: VocabularyAnnotationSurface = 'transcript',
): VocabularyAnnotationKind {
    if (!status || guidance === 'off') {
        return null;
    }
    if (status === 'learning') {
        return 'learning';
    }
    if (
        status === 'familiar'
        && surface === 'transcript'
        && (guidance === 'coach' || guidance === 'intensive')
    ) {
        return 'familiar';
    }
    return null;
}
