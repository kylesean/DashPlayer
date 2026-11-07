import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { injectable } from 'inversify';
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
 * 基于 child_process 的 yt-dlp 网关实现。
 *
 * 与 FfmpegProcessRunner 同一范式：spawn + 逐行解析 stdout 进度 +
 * OutputTail 保留 stderr 尾部 + SIGTERM→SIGKILL 优雅取消。
 * 产物文件路径优先取 `--print after_move:filepath` 的输出，
 * 并在结束时回扫输出目录兜底（字幕文件不保证逐个打印）。
 */
@injectable()
export class YtDlpProcessGatewayImpl implements YtDlpGateway {

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
            '--sub-langs', 'en,en-orig,en.*,zh-Hans,zh-Hans.*',
            '--convert-subs', 'srt',
            // 合并与字幕转格式依赖 ffmpeg，指向项目运行时 lib 目录（内含 ffmpeg/ffprobe）。
            '--ffmpeg-location', getRuntimeResourcePath('lib'),
            '--newline', '--progress',
            '--print', 'after_move:filepath', '--no-simulate',
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
                if (code === 0) {
                    resolve(this.collectResult(request.outputDir, producedPaths, durationMs));
                    return;
                }
                if (cancelRequested) {
                    reject(new CancelByUserError(`yt-dlp 已取消（退出码 ${code}）`));
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
        const all = [...existed];
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
