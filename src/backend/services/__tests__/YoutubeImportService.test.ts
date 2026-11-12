import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import { DpTaskState, type DpTask, type DpTaskUpdate } from '@/common/contracts/dp-task';
import type DpTaskService from '@/backend/services/DpTaskService';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type YtDlpGateway from '@/backend/services/gateways/ytdlp/YtDlpGateway';
import type {
    YtDlpDownloadRequest,
    YtDlpDownloadResult,
    YtDlpRunningTask,
} from '@/backend/services/gateways/ytdlp/YtDlpGateway';
import type WatchHistoryService from '@/backend/services/WatchHistoryService';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import { parseYoutubeVideoId } from '@/common/utils/youtubeUrl';
import { YoutubeImportServiceImpl } from '../YoutubeImportService';

// 日志基建依赖 electron app（AppStatePath → app.isPackaged），服务层测试替换为空实现。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const VIDEO_ID = 'dQw4w9WgXcQ';
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const VIDEO_BASE_NAME = `Test Video [${VIDEO_ID}]`;

/**
 * 以忠实状态机模拟 DpTaskService：任务状态落在内存 Map，取消语义与实现一致。
 */
class FakeDpTaskService implements DpTaskService {
    public readonly tasks = new Map<number, DpTask>();
    private nextId = 1;
    private readonly cancelQueue = new Set<number>();
    private readonly cancelables = new Map<number, Array<{ cancel(): void }>>();

    public async detail(id: number): Promise<DpTask | null> {
        return this.tasks.get(id) ?? null;
    }

    public async details(ids: number[]): Promise<Map<number, DpTask>> {
        const map = new Map<number, DpTask>();
        for (const id of ids) {
            const task = this.tasks.get(id);
            if (task) map.set(id, task);
        }
        return map;
    }

    public async create(): Promise<number> {
        const id = this.nextId++;
        this.tasks.set(id, {
            id,
            status: DpTaskState.INIT,
            progress: '任务创建成功',
            result: null,
            created_at: '',
            updated_at: '',
        });
        return id;
    }

    public update(task: DpTaskUpdate): void {
        if (task.id === undefined) return;
        const current = this.tasks.get(task.id);
        if (!current) return;
        Object.assign(current, task);
    }

    public process(id: number, info: DpTaskUpdate): void {
        this.update({ ...info, id, status: DpTaskState.IN_PROGRESS });
    }

    public finish(id: number, info: DpTaskUpdate): void {
        this.update({ ...info, id, status: DpTaskState.DONE });
    }

    public fail(id: number, info: DpTaskUpdate): void {
        this.update({ ...info, id, status: DpTaskState.FAILED });
    }

    public cancel(id: number): void {
        this.cancelQueue.add(id);
        this.cancelables.get(id)?.forEach((cancelable) => cancelable.cancel());
    }

    public checkCancel(id: number): void {
        if (this.cancelQueue.has(id)) {
            this.update({ id, status: DpTaskState.CANCELLED, progress: '任务取消' });
            throw new CancelByUserError();
        }
    }

    public registerTask(taskId: number, cancelable: { cancel(): void }): void {
        const list = this.cancelables.get(taskId) ?? [];
        list.push(cancelable);
        this.cancelables.set(taskId, list);
        if (this.cancelQueue.has(taskId)) {
            cancelable.cancel();
        }
    }

    public async recoverInterruptedTasks(): Promise<void> {}

    public async cleanupExpiredTasks(): Promise<void> {}
}

/**
 * 可编程行为的 yt-dlp 网关测试替身；产物文件真实写入内存文件系统。
 */
class FakeYtDlpGateway implements YtDlpGateway {
    /** success：产出视频与双语字幕；no-srt：只产出视频；fail：直接失败；hang：挂起直到取消。 */
    public mode: 'success' | 'no-srt' | 'fail' | 'hang' = 'success';
    public readonly downloads: YtDlpDownloadRequest[] = [];

    constructor(private readonly fsGateway: MemoryFileSystemGateway) {}

    public download(request: YtDlpDownloadRequest): YtDlpRunningTask {
        this.downloads.push(request);
        let rejectRef!: (error: Error) => void;
        const result = new Promise<YtDlpDownloadResult>((resolve, reject) => {
            rejectRef = reject;
            if (this.mode === 'fail') {
                setTimeout(() => reject(new Error('模拟下载失败：网络不可达')), 0);
                return;
            }
            if (this.mode === 'hang') {
                return;
            }
            setTimeout(() => {
                const videoPath = path.join(request.outputDir, `${VIDEO_BASE_NAME}.mp4`);
                const srtPaths = this.mode === 'success'
                    ? [
                        path.join(request.outputDir, `${VIDEO_BASE_NAME}.en.srt`),
                        path.join(request.outputDir, `${VIDEO_BASE_NAME}.zh-Hans.srt`),
                    ]
                    : [];
                this.fsGateway.files.set(path.normalize(videoPath), 'video');
                for (const srtPath of srtPaths) {
                    this.fsGateway.files.set(path.normalize(srtPath), 'srt');
                }
                request.onProgress?.(45, '[download]  45.0%');
                resolve({ videoPath, srtPaths });
            }, 0);
        });
        return {
            result,
            cancel: () => rejectRef(new CancelByUserError('yt-dlp 已取消')),
        };
    }
}

/**
 * 记录调用的观看历史服务替身；create 返回顺序生成的记录 ID。
 */
class FakeWatchHistoryService {
    public readonly createdPaths: string[][] = [];
    public readonly attached: Array<{ videoPath: string; srtPath: string | 'same' }> = [];
    private nextId = 1;

    public async create(filePaths: string[]): Promise<string[]> {
        this.createdPaths.push([...filePaths]);
        return filePaths.map(() => `wh-${this.nextId++}`);
    }

    public async attachSrt(videoPath: string, srtPath: string | 'same'): Promise<void> {
        this.attached.push({ videoPath, srtPath });
    }
}

/**
 * 按目录目标返回固定虚拟路径的存储目录提供器。
 */
class FakeStorageDirectoryProvider implements StorageDirectoryProvider {
    constructor(private readonly fsGateway: MemoryFileSystemGateway) {}

    private readonly roots = new Map<StorageDirectoryTarget, string>([
        [StorageDirectoryTarget.LIBRARY_ROOT, '/storage'],
        [StorageDirectoryTarget.VIDEOS, '/storage/videos'],
        [StorageDirectoryTarget.TEMP, '/storage/temp'],
        [StorageDirectoryTarget.BIN, '/storage/bin'],
        [StorageDirectoryTarget.MODELS, '/storage/models'],
        [StorageDirectoryTarget.PRACTICE, '/storage/practice'],
    ]);

    public async provideDirectory(target: StorageDirectoryTarget): Promise<string> {
        const directory = this.roots.get(target)!;
        await this.fsGateway.ensureDirectory(directory);
        return directory;
    }

    public async ensurePathAccessPermissionIfExists(): Promise<void> {}

    public async getRootStatus(): Promise<never> {
        throw new Error('测试中不应查询存储根目录状态');
    }
}

/**
 * 等待任务到达终态；超时抛错避免测试悬挂。
 */
const waitForTerminalTask = async (dpTaskService: FakeDpTaskService, taskId: number): Promise<DpTask> => {
    for (let i = 0; i < 200; i++) {
        const task = await dpTaskService.detail(taskId);
        if (task && [DpTaskState.DONE, DpTaskState.FAILED, DpTaskState.CANCELLED].includes(task.status)) {
            return task;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('任务未在限时内到达终态');
};

describe('YouTube 导入服务', () => {
    let fsGateway: MemoryFileSystemGateway;
    let dpTaskService: FakeDpTaskService;
    let ytDlpGateway: FakeYtDlpGateway;
    let watchHistoryService: FakeWatchHistoryService;
    let settingsValues: Map<string, string>;
    let service: YoutubeImportServiceImpl;

    beforeEach(() => {
        fsGateway = new MemoryFileSystemGateway();
        dpTaskService = new FakeDpTaskService();
        ytDlpGateway = new FakeYtDlpGateway(fsGateway);
        watchHistoryService = new FakeWatchHistoryService();
        settingsValues = new Map([
            ['youtubeImport.enabled', 'true'],
            ['youtubeImport.cookiesFilePath', ''],
        ]);
        // 预置已就绪的 yt-dlp 二进制，避免测试触发真实网络下载。
        fsGateway.files.set(path.normalize('/storage/bin/yt-dlp/yt-dlp_linux'), 'binary');

        const settingsStore = {
            get: (key: string) => settingsValues.get(key),
            set: (key: string, value: string | undefined | null) => {
                if (value === undefined || value === null) {
                    settingsValues.delete(key);
                } else {
                    settingsValues.set(key, value);
                }
                return true;
            },
        } as SettingsStore;

        service = new YoutubeImportServiceImpl(
            dpTaskService as unknown as DpTaskService,
            ytDlpGateway as unknown as YtDlpGateway,
            new FakeStorageDirectoryProvider(fsGateway),
            fsGateway,
            settingsStore,
            watchHistoryService as unknown as WatchHistoryService,
            { fireAndForget: vi.fn() } as unknown as RendererGateway,
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('链接解析', () => {
        it('可以解析 watch、youtu.be、shorts 三种地址形态', () => {
            expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(VIDEO_ID);
            expect(parseYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe(VIDEO_ID);
            expect(parseYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(VIDEO_ID);
        });

        it('可以解析移动端域名地址', () => {
            expect(parseYoutubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(VIDEO_ID);
        });

        it('拒绝仅与 youtube.com 后缀相似的仿冒域名', () => {
            expect(parseYoutubeVideoId('https://evil-youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
            expect(parseYoutubeVideoId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
            expect(parseYoutubeVideoId('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
        });

        it('拒绝非 http(s) 链接', () => {
            expect(parseYoutubeVideoId('file:///etc/passwd')).toBeNull();
        });

        it('拒绝非法长度的视频 ID', () => {
            expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
            expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=')).toBeNull();
            expect(parseYoutubeVideoId('https://youtu.be/short')).toBeNull();
        });

        it('无法识别非 YouTube 链接', () => {
            expect(parseYoutubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
            expect(parseYoutubeVideoId('不是链接')).toBeNull();
        });
    });

    describe('发起导入', () => {
        it('下载成功后视频移入视频库、挂载英语字幕并完成任务', async () => {
            const { taskId } = await service.start(VIDEO_URL);
            const task = await waitForTerminalTask(dpTaskService, taskId);

            expect(task.status).toBe(DpTaskState.DONE);
            const result = JSON.parse(task.result ?? '{}');
            expect(result.fileName).toBe(`${VIDEO_BASE_NAME}.mp4`);
            expect(result.attachedSrtFileName).toBe(`${VIDEO_BASE_NAME}.en.srt`);

            // 入库的是移动后的目标路径
            const targetPath = `/storage/videos/YouTube/${VIDEO_BASE_NAME}.mp4`;
            expect(watchHistoryService.createdPaths[0]).toEqual([targetPath]);
            expect(watchHistoryService.attached[0]).toEqual({
                videoPath: targetPath,
                srtPath: `/storage/videos/YouTube/${VIDEO_BASE_NAME}.en.srt`,
            });
            // 文件真实移动：临时目录不再有产物，目标目录已有
            expect(fsGateway.files.has(path.normalize(targetPath))).toBe(true);
            expect(fsGateway.files.has(path.normalize(`/storage/videos/YouTube/${VIDEO_BASE_NAME}.zh-Hans.srt`))).toBe(true);
            const tempNames = await fsGateway.listFileNames('/storage/temp');
            expect(tempNames.filter((name) => name.includes(VIDEO_ID))).toEqual([]);
        });

        it('无字幕的视频也能成功入库，只是不挂字幕', async () => {
            ytDlpGateway.mode = 'no-srt';
            const { taskId } = await service.start(VIDEO_URL);
            const task = await waitForTerminalTask(dpTaskService, taskId);

            expect(task.status).toBe(DpTaskState.DONE);
            const result = JSON.parse(task.result ?? '{}');
            expect(result.attachedSrtFileName).toBeNull();
            expect(watchHistoryService.attached).toEqual([]);
        });

        it('无法识别的链接直接报错，不创建任务', async () => {
            await expect(service.start('https://example.com/watch?v=abc')).rejects.toThrow('无法识别的 YouTube 链接');
            expect(dpTaskService.tasks.size).toBe(0);
            expect(ytDlpGateway.downloads).toEqual([]);
        });

        it('同一视频正在导入时拒绝重复发起', async () => {
            ytDlpGateway.mode = 'hang';
            const first = await service.start(VIDEO_URL);
            await expect(service.start(VIDEO_URL)).rejects.toThrow('正在导入中');

            // 清理挂起任务
            await service.cancel(first.taskId);
            await waitForTerminalTask(dpTaskService, first.taskId);
        });

        it('用户取消后任务进入取消态，不再写入库', async () => {
            ytDlpGateway.mode = 'hang';
            const { taskId } = await service.start(VIDEO_URL);
            await service.cancel(taskId);
            const task = await waitForTerminalTask(dpTaskService, taskId);

            expect(task.status).toBe(DpTaskState.CANCELLED);
            expect(watchHistoryService.createdPaths).toEqual([]);
            // 临时工作目录被清理
            const tempDirs = await fsGateway.listDirectoryNames('/storage/temp');
            expect(tempDirs.filter((name) => name.includes(VIDEO_ID))).toEqual([]);
        });

        it('下载失败时任务失败并带出错误信息', async () => {
            ytDlpGateway.mode = 'fail';
            const { taskId } = await service.start(VIDEO_URL);
            const task = await waitForTerminalTask(dpTaskService, taskId);

            expect(task.status).toBe(DpTaskState.FAILED);
            expect(task.result).toContain('模拟下载失败');
            expect(watchHistoryService.createdPaths).toEqual([]);
        });

        it('库内已有同视频产物时直接复用，不重复下载', async () => {
            const targetPath = `/storage/videos/YouTube/${VIDEO_BASE_NAME}.mp4`;
            fsGateway.files.set(path.normalize(targetPath), 'video');

            const { taskId } = await service.start(VIDEO_URL);
            const task = await waitForTerminalTask(dpTaskService, taskId);

            expect(task.status).toBe(DpTaskState.DONE);
            expect(ytDlpGateway.downloads).toEqual([]);
            expect(watchHistoryService.createdPaths[0]).toEqual([targetPath]);
        });

        it('功能开关关闭时拒绝导入', async () => {
            settingsValues.set('youtubeImport.enabled', 'false');
            await expect(service.start(VIDEO_URL)).rejects.toThrow('已在设置中关闭');
            expect(dpTaskService.tasks.size).toBe(0);
        });

        it('配置了 cookies 文件时把路径传给下载网关', async () => {
            settingsValues.set('youtubeImport.cookiesFilePath', '/home/kyle/cookies.txt');
            const { taskId } = await service.start(VIDEO_URL);
            await waitForTerminalTask(dpTaskService, taskId);

            expect(ytDlpGateway.downloads[0].cookiesFilePath).toBe('/home/kyle/cookies.txt');
        });

        it('未配置 cookies 时不向网关传 cookies 参数', async () => {
            const { taskId } = await service.start(VIDEO_URL);
            await waitForTerminalTask(dpTaskService, taskId);

            expect(ytDlpGateway.downloads[0].cookiesFilePath).toBeUndefined();
        });
    });

    describe('设置读写', () => {
        it('保存开关与 cookies 路径会写回存储并可读回', async () => {
            const saved = await service.saveSetting({ enabled: false, cookiesFilePath: ' /tmp/cookies.txt ' });
            expect(saved.enabled).toBe(false);
            expect(saved.cookiesFilePath).toBe('/tmp/cookies.txt');

            const detail = await service.getSettingDetail();
            expect(detail.enabled).toBe(false);
            expect(detail.cookiesFilePath).toBe('/tmp/cookies.txt');
        });
    });
});
