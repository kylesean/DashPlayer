/**
 * 英语字幕轨的选择优先级。
 *
 * yt-dlp 对同一个视频可能下载到两份英语字幕：
 * - `xxx.en.srt`：**作者上传**，有人工标点、时间轴不重叠，断句与时间轴质量最好；
 * - `xxx.en-orig.srt`：YouTube **ASR** 自动生成，无标点、cue 滚动重叠。
 *
 * 旧实现用 `find` 取第一个匹配项，顺序取决于文件系统返回顺序——同一个视频
 * 有时挂作者轨、有时挂 ASR 轨，用户会觉得「字幕对不上」时好时坏。
 */

/** 字幕轨质量档位：数字越小越好。 */
export type SubtitleTrackRank = 0 | 1 | 2;

/**
 * 判断一个字幕文件名是否为英语轨。
 *
 * @param fileName 文件名（不含目录）。
 * @returns 是英语轨时返回 true。
 */
export const isEnglishSubtitleFile = (fileName: string): boolean =>
    /\.en(?:-[A-Za-z0-9-]+)?\.srt$/i.test(fileName);

/**
 * 给英语字幕轨打质量分：作者轨 0、ASR 轨 1、其他英语变体 2。
 *
 * @param fileName 文件名（不含目录）。
 * @returns 质量档位；非英语轨返回 null。
 */
export const rankEnglishSubtitle = (fileName: string): SubtitleTrackRank | null => {
    if (!isEnglishSubtitleFile(fileName)) {
        return null;
    }
    const lower = fileName.toLowerCase();
    // 作者上传轨：`xxx.en.srt`
    if (/\.en\.srt$/.test(lower)) return 0;
    // ASR 原始轨：`xxx.en-orig.srt`
    if (/\.en-orig\.srt$/.test(lower)) return 1;
    // 其他英语变体（en-US / en-GB 等）：质量未知，排最后
    return 2;
};

/**
 * 去掉英语轨后缀，得到「同一个视频」的公共前缀。
 *
 * `talk.en.srt`、`talk.en-orig.srt`、`talk.en-GB.srt` 都归一到 `talk`。
 * 非英语轨原样返回，调用方据此天然排除它们。
 *
 * @param fileName 文件名（不含目录）。
 * @returns 去掉英语轨后缀的文件名。
 */
export const stripEnglishTrackSuffix = (fileName: string): string =>
    fileName.replace(/\.en(?:-[A-Za-z0-9-]+)?\.srt$/i, '');

/**
 * 从多个文件里挑出最该用的英语字幕。
 *
 * @param fileNames 候选文件名列表。
 * @returns 选中的文件名；没有英语轨时返回 undefined。
 */
export function pickPreferredEnglishSubtitle(fileNames: readonly string[]): string | undefined {
    const candidates = fileNames
        .map((name) => ({ name, rank: rankEnglishSubtitle(name) }))
        .filter((item): item is { name: string; rank: SubtitleTrackRank } => item.rank !== null);
    if (candidates.length === 0) {
        return undefined;
    }
    // 稳定排序：同档位时保留原有顺序，避免同名不同变体之间来回跳。
    candidates.sort((a, b) => a.rank - b.rank);
    return candidates[0].name;
}

/**
 * 当前字幕是否还有更优的同目录替代轨。
 *
 * 用于「已经导入过的视频」自动纠正：旧版本可能给视频挂上了 ASR 轨，
 * 而作者轨其实一直躺在同一目录里。
 *
 * @param currentFileName 当前挂载的字幕文件名。
 * @param siblingFileNames 同目录下的候选文件名。
 * @returns 存在更优轨时返回其文件名；否则返回 null。
 */
export function findBetterEnglishSubtitle(
    currentFileName: string,
    siblingFileNames: readonly string[],
): string | null {
    const currentRank = rankEnglishSubtitle(currentFileName);
    if (currentRank === null || currentRank === 0) {
        // 已经是作者轨（或不是英语轨）时不做任何替换
        return null;
    }
    /*
      必须先按「同一个视频」过滤，再比质量。

      YouTube 目录里通常并排放着多个视频，每个都有自己的 `xxx.en.srt`。
      若直接在整个目录里挑质量最高的，会把**别的视频**的字幕挂到当前视频上——
      表现为「打开的视频显示的是另一个视频的字幕」。

      同一视频的判据：去掉英语轨后缀后文件名相同。
      `talk.en-orig.srt` 与 `talk.en.srt` 都归一到 `talk`。
    */
    const currentStem = stripEnglishTrackSuffix(currentFileName);
    const sameVideo = siblingFileNames.filter(
        (name) => stripEnglishTrackSuffix(name) === currentStem,
    );
    /*
      防御：归一后必须与原文件名不同（说明确实是英语轨），
      且过滤结果里必须仍包含当前文件——否则说明判据失效，
      宁可不动也不能挂上别的视频的字幕。
    */
    if (currentStem === currentFileName || !sameVideo.includes(currentFileName)) {
        return null;
    }
    const best = pickPreferredEnglishSubtitle(sameVideo);
    if (!best || best === currentFileName) {
        return null;
    }
    const bestRank = rankEnglishSubtitle(best);
    if (bestRank === null || bestRank >= currentRank) {
        return null;
    }
    return best;
}
