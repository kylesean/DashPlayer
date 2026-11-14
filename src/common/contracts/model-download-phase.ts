/**
 * 所有模型下载机共享的**核心相位子集**——单文件下载（本地 GGUF、embedding）的完整相位，
 * 也是归档下载流程的前段。语义全库统一：
 * - `idle` 表示下载任务已结束（成功/失败/取消），各下载机都以广播 `idle` 作为终态复位；
 * - `downloading` 字节流传输中；`verifying` 完整性校验（SHA256 等）。
 */
export type CommonDownloadPhase = 'idle' | 'downloading' | 'verifying';

/**
 * 模型归档下载流程阶段：核心相位之上追加多文件归档特有的解包/安装/清理段。
 * 归档机（Parakeet/TTS/Whisper/yt-dlp）走完整链；单文件机止步于核心段。
 */
export type ModelDownloadPhase = CommonDownloadPhase | 'extracting' | 'installing' | 'cleaning';
