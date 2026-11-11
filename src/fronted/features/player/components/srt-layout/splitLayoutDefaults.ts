/**
 * 播放器分栏的默认比例与自适应规则。
 *
 * 比例均相对于各自的面板组：
 * - 左右组：视频 / 字幕文稿；
 * - 上下组：舞台 / 主字幕。
 */

/** 左右分栏：视频默认占比。 */
export const DEFAULT_OUTER_VIDEO_SIZE = 75;
/** 左右分栏：字幕文稿默认占比。 */
export const DEFAULT_OUTER_TRANSCRIPT_SIZE = 25;

/** 上下分栏：舞台默认占比。 */
export const DEFAULT_INNER_STAGE_SIZE = 75;
/** 上下分栏：主字幕默认占比。 */
export const DEFAULT_INNER_SUBTITLE_SIZE = 25;

/** 大字号下主字幕额外获得的占比。 */
const LARGE_FONT_EXTRA_SIZE = 3;
/** 整句连读下主字幕额外获得的占比。 */
const SENTENCE_BLOCK_EXTRA_SIZE = 3;
/** 主字幕占比上限：恢复默认也不能把视频舞台压到 68% 以下。 */
export const MAX_INNER_SUBTITLE_SIZE = 32;

export interface InnerSplitSizes {
    stage: number;
    subtitle: number;
}

/**
 * 计算上下分栏的默认比例。
 *
 * 25% 是双语字幕各显示一行、且学习台不挤压正文的基线。大字号与整句连读
 * 都会增加单屏内容高度，因此各追加 3 个百分点；封顶 32%，保证视频舞台
 * 始终保有不低于 68% 的高度。
 *
 * @param fontSize 当前外观字号设置。
 * @param sentenceBlockMode 是否开启整句连读。
 * @returns 舞台与主字幕的默认百分比；两者之和恒为 100。
 */
export function getDefaultInnerSplit(
    fontSize: string | undefined,
    sentenceBlockMode: boolean,
): InnerSplitSizes {
    const subtitle = Math.min(
        MAX_INNER_SUBTITLE_SIZE,
        DEFAULT_INNER_SUBTITLE_SIZE
            + (fontSize === 'fontSizeLarge' ? LARGE_FONT_EXTRA_SIZE : 0)
            + (sentenceBlockMode ? SENTENCE_BLOCK_EXTRA_SIZE : 0),
    );
    return { stage: 100 - subtitle, subtitle };
}
