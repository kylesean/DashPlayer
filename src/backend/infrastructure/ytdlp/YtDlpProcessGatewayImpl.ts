import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import { OutputTail } from '@/backend/utils/output-tail';
import { getRuntimeResourcePath } from '@/backend/utils/runtimeEnv';
import type YtDlpGateway from '@/backend/services/gateways/ytdlp/YtDlpGateway';
import type {
    YtDlpDownloadRequest,
    YtDlpDownloadResult,
    YtDlpRunningTask,
} from '@/backend/services/gateways/ytdlp/YtDlpGateway';

/**
 * yt-dlp 单次下载允许的行内进度正则：`[download]  45.2% of ...`。
 */
const PROGRESS_LINE_PATTERN = /\[download\]\s+(\d+(?:\.\d+)?)%/;

/**
 * 视频扩展名集合；yt-dlp 合并输出固定为 mp4，这里兜底识别常见容器。
 */
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm'];

/**
 * yt-dlp 分轨中间产物正则：合并前的单流文件（如 `Title [id].f137.mp4`）。
 * 成功合并后 yt-dlp 会自动清理；仅当音频流失败或用户取消时才会残留，
 * 此类文件没有音轨，不得当作合并成品。
 */
const INTERMEDIATE_VIDEO_PATTERN = /\.f\d+\.(mp4|mkv|webm)$/i;

/**
 * 基于 child_process 的 yt-dlp 网关实现。
 *
 * 与 FfmpegProcessRunner 同一范式：spawn + 逐行解析 stdout 进度 +
 * OutputTail 保留 stderr 尾部 + SIGTERM→SIGKILL 优雅取消。
 * 产物文件路径优先取 `--print after_move:filepath` 的输出，
 * 并在结束时回扫输出目录兜底（字幕文件不保证逐个打印）。
 */
@injectable()
export class YtDlpProcessGatewayImpl implements YtDlpGateway {
    private readonly logger = getMainLogger('YtDlpProcessGatewayImpl');


    /**
     * 启动一个可取消的 yt-dlp 下载任务。
     *
     * 参数约定：
     * - 单视频（--no-playlist），优先 mp4 容器，合成交给项目自带的 ffmpeg；
     * - 同时抓官方与自动字幕（en/zh-Hans 系）并统一转成 srt；
     * - 代理通过进程环境变量继承（HTTP(S)_PROXY 已由 ProxyService 写入）。
     */
    public download(request: YtDlpDownloadRequest): YtDlpRunningTask {
        const startedAt = Date.now();
        const stderrTail = new OutputTail();
        let cancelRequested = false;
        let processRef: ChildProcess | null = null;
        let sigkillTimer: NodeJS.Timeout | undefined;

        // 下载落盘的二进制可能丢失执行位，启动前显式补齐（Windows 上为无害操作）。
        if (process.platform !== 'win32') {
            fs.chmodSync(request.ytDlpBinaryPath, 0o755);
        }

        const args = [
            '--no-playlist',
            '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
            '--merge-output-format', 'mp4',
            '--write-subs', '--write-auto-subs',
            // 只取英语与简中两轨：通配符会抓大量字幕轨，连续请求易触发 timedtext 429 限流。
            '--sub-langs', 'en,en-orig,zh-Hans',
            '--convert-subs', 'srt',
            // HTTP 429 限流需要退避重试；字幕逐轨下载之间再加间隔。
            '--retry-sleep', 'http:4',
            '--sleep-subtitles', '1',
            // 合并与字幕转格式依赖 ffmpeg，指向项目运行时 lib 目录（内含 ffmpeg/ffprobe）。
            '--ffmpeg-location', getRuntimeResourcePath('lib'),
            '--newline', '--progress',
            '--print', 'after_move:filepath', '--no-simulate',
            // 字幕轨被限流（429）时不能拖死整个任务：跳过该轨继续下载视频，
            // 视频落盘后由“视频为主”语义兜底，缺字幕在结果里如实呈现。
            '--ignore-errors',
            // 先试 android 客户端（部分 IP 下可绕过人机验证，LingoTube 即此路线），失败退回默认客户端。
            '--extractor-args', 'youtube:player_client=android,default',
            ...(request.cookiesFilePath ? ['--cookies', request.cookiesFilePath] : []),
            '-P', request.outputDir,
            // 标题截断到 80 字节，避免超长文件名触碰到文件系统上限。
            '-o', '%(title).80B [%(id)s].%(ext)s',
            request.url,
        ];

        const result = new Promise<YtDlpDownloadResult>((resolve, reject) => {
            const child = spawn(request.ytDlpBinaryPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env },
            });
            processRef = child;

            const producedPaths: string[] = [];

            child.stdout?.on('data', (chunk) => {
                for (const line of chunk.toString('utf8').split(/\r?\n/).filter(Boolean)) {
                    const progress = this.tryParseProgress(line);
                    if (progress !== null) {
                        request.onProgress?.(progress, line);
                        continue;
                    }
                    // 非方括号日志、非进度行即 `--print` 输出的产物绝对路径。
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('[') && !trimmed.includes('%')) {
                        producedPaths.push(trimmed);
                    }
                }
            });

            child.stderr.on('data', (chunk) => {
                stderrTail.push(chunk.toString('utf8'));
            });

            child.on('error', (error) => {
                reject(error);
            });

            child.on('close', (code) => {
                if (sigkillTimer) {
                    clearTimeout(sigkillTimer);
                }
                const durationMs = Date.now() - startedAt;
                // 取消优先判定：SIGTERM/SIGKILL 后视频流可能已部分落盘，
                // 部分产物不代表成功，用户取消必须如实上报而不是被“视频为主”吞掉。
                if (cancelRequested && code !== 0) {
                    reject(new CancelByUserError(`yt-dlp 已取消（退出码 ${code}）`));
                    return;
                }
                // 视频为主、字幕尽力：字幕下载失败等可恢复情形会让 yt-dlp 以非零码退出，
                // 但完整视频已落盘时仍按成功处理，由上层在结果里体现“无字幕”。
                if (code === 0 || this.hasCompletedVideo(request.outputDir)) {
                    if (code !== 0) {
                        this.logger.warn('yt-dlp exited nonzero but video completed; treating as success', {
                            exitCode: code,
                            stderrTail: stderrTail.logTail(),
                        });
                    }
                    resolve(this.collectResult(request.outputDir, producedPaths, durationMs));
                    return;
                }
                reject(new Error(
                    `yt-dlp 下载失败（退出码 ${code}，耗时 ${(durationMs / 1000).toFixed(1)}s）：`
                    + stderrTail.logTail().join(' '),
                ));
            });
        });

        const cancel = () => {
            cancelRequested = true;
            if (!processRef || processRef.killed) return;
            processRef.kill('SIGTERM');
            sigkillTimer = setTimeout(() => {
                if (!processRef || processRef.killed) return;
                processRef.kill('SIGKILL');
            }, 1200);
        };

        return { result, cancel };
    }

    /**
     * 判断输出目录里是否已有完整落盘的视频文件。
     *
     * 只认视频扩展名且大小大于零的普通文件；`.part` 半成品扩展名不同，天然排除；
     * 无音轨的分轨中间产物（`.fNNN.mp4`）不算完成，避免音频流失败时把无声视频当成品。
     *
     * @param outputDir 输出目录。
     * @returns 存在完整视频时返回 `true`。
     */
    private hasCompletedVideo(outputDir: string): boolean {
        try {
            for (const name of fs.readdirSync(outputDir)) {
                if (INTERMEDIATE_VIDEO_PATTERN.test(name)) {
                    continue;
                }
                if (!VIDEO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
                    continue;
                }
                const stat = fs.statSync(path.join(outputDir, name));
                if (stat.isFile() && stat.size > 0) {
                    return true;
                }
            }
        } catch {
            return false;
        }
        return false;
    }

    /**
     * 汇总本次下载产物：视频取首个视频容器路径（stdout 未打印时回扫输出目录），
     * 字幕取输出目录下全部 srt（与视频同基名）。
     */
    private collectResult(outputDir: string, producedPaths: string[], durationMs: number): YtDlpDownloadResult {
        const existed = new Set(producedPaths);
        try {
            for (const name of fs.readdirSync(outputDir)) {
                existed.add(path.join(outputDir, name));
            }
        } catch {
            // 输出目录不可读时只信任 stdout 收集结果，后续定位不到视频会显式报错。
        }
        // 排除分轨中间产物：失败/取消残留的 `.fNNN.mp4` 没有音轨，不能被选成成品视频。
        const all = [...existed].filter((p) => !INTERMEDIATE_VIDEO_PATTERN.test(p));
        const videoPath = all.find((p) => VIDEO_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)));
        if (!videoPath) {
            throw new Error(`yt-dlp 结束但未找到视频产物（耗时 ${(durationMs / 1000).toFixed(1)}s），输出目录：${outputDir}`);
        }
        const videoBaseName = path.basename(videoPath, path.extname(videoPath));
        const srtPaths = all.filter((p) => {
            if (!p.toLowerCase().endsWith('.srt')) return false;
            return path.basename(p).startsWith(videoBaseName);
        });
        return { videoPath, srtPaths };
    }

    /**
     * 从 stdout 行解析下载百分比；非进度行返回 null。
     */
    private tryParseProgress(line: string): number | null {
        const match = PROGRESS_LINE_PATTERN.exec(line);
        if (!match) return null;
        const percent = parseFloat(match[1]);
        return Number.isFinite(percent) ? percent : null;
    }
}
