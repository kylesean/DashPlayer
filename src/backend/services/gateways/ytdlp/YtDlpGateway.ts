/**
 * yt-dlp 下载请求。
 */
export interface YtDlpDownloadRequest {
    /** 视频页面地址（YouTube）。 */
    url: string;
    /** 产物输出目录（绝对路径），目录需已存在。 */
    outputDir: string;
    /** yt-dlp 可执行文件绝对路径。 */
    ytDlpBinaryPath: string;
    /**
     * Netscape 格式 cookies.txt 绝对路径；提供时以该账号身份访问 YouTube。
     * 代理出口 IP 常触发“You're not a bot”风控，这是绕过风控的标准手段。
     */
    cookiesFilePath?: string;
    /** 下载进度回调；percent 为 0-100 的百分比。 */
    onProgress?: (percent: number, rawLine: string) => void;
}

/**
 * yt-dlp 下载结果。
 */
export interface YtDlpDownloadResult {
    /** 视频文件绝对路径。 */
    videoPath: string;
    /** 下载到的字幕文件绝对路径列表（可能为空，代表视频无字幕）。 */
    srtPaths: string[];
}

/**
 * yt-dlp 可取消任务句柄。
 */
export interface YtDlpRunningTask {
    /** 下载结果 Promise。 */
    result: Promise<YtDlpDownloadResult>;
    /** 优雅取消运行中的 yt-dlp 进程。 */
    cancel: () => void;
}

/**
 * yt-dlp 进程网关：抽象外部 yt-dlp 二进制的调用，业务层不感知 child_process。
 */
export default interface YtDlpGateway {
    /**
     * 启动一个可取消的 yt-dlp 下载任务。
     *
     * @param request 下载请求。
     * @returns 可取消任务句柄。
     */
    download(request: YtDlpDownloadRequest): YtDlpRunningTask;
}
