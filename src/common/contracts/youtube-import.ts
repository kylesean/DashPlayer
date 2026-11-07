/**
 * YouTube 导入设置详情。
 */
export interface YoutubeImportSettingDetailVO {
    /** 是否启用 YouTube 链接导入功能；关闭后隐藏首页入口并拒绝新的导入请求。 */
    enabled: boolean;
    /** Netscape 格式 cookies.txt 文件路径；为空表示不带 cookies 下载。 */
    cookiesFilePath: string;
}

/**
 * YouTube 导入设置保存值。
 */
export interface YoutubeImportSettingSaveVO {
    /** 是否启用 YouTube 链接导入功能。 */
    enabled: boolean;
    /** Netscape 格式 cookies.txt 文件路径；为空表示不带 cookies 下载。 */
    cookiesFilePath: string;
}

/**
 * YouTube 导入任务启动结果。
 */
export interface YoutubeImportStartResult {
    /** 后台任务编号（dp_task 表主键），前端据此订阅进度。 */
    taskId: number;
}

/**
 * YouTube 导入任务的最终结果（序列化后存入 dp_task.result）。
 */
export interface YoutubeImportTaskResult {
    /** 入库后的观看记录 ID，可直接跳转播放页。 */
    videoId: string;
    /** 入库后的视频文件名。 */
    fileName: string;
    /** 已挂载的英语字幕文件名；视频无字幕时为 null。 */
    attachedSrtFileName: string | null;
}
