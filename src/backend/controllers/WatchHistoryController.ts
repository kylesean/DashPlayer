import { z } from 'zod';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { finiteNonNegativeNumberSchema, nonEmptyStringSchema } from '@/backend/controllers/ipc/routeSchemas';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type Controller from '@/backend/controllers/Controller';
import type WatchHistoryService from '@/backend/services/WatchHistoryService';
import type { SubtitleResolution } from '@/common/contracts/subtitle-resolution';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';

/**
 * 观看历史、播放详情与字幕绑定 IPC 控制器。
 */
@injectable()
export default class WatchHistoryController implements Controller {
    /**
     * 构造观看历史控制器。
     *
     * @param watchHistoryService 观看历史业务服务。
     */
    constructor(
        @inject(TYPES.WatchHistoryService) private readonly watchHistoryService: WatchHistoryService,
    ) {}

    public async updateProgress({ file, currentPosition }: {
        file: string, currentPosition: number
    }): Promise<void> {
        return this.watchHistoryService.updateProgress(file, currentPosition);
    }

    public async create(files: string[], concatLibrary = false): Promise<string[]> {
        return this.watchHistoryService.create(files, concatLibrary);
    }

    public async attachSrt({ videoPath, srtPath }: { videoPath: string, srtPath: string | 'same' }): Promise<void> {
        await this.watchHistoryService.attachSrt(videoPath, srtPath);
    }

    public async groupDelete(id: string): Promise<void> {
        return this.watchHistoryService.groupDelete(id);
    }

    public async list(p = ''): Promise<WatchHistoryVO[]> {
        return this.watchHistoryService.list(p);
    }

    public async listBasic(p = ''): Promise<WatchHistoryVO[]> {
        return this.watchHistoryService.listBasic(p);
    }

    public async detail(id: string): Promise<WatchHistoryVO | null> {
        if (!id) {
            return null;
        }
        return this.watchHistoryService.detail(id);
    }

    /**
     * 获取不执行媒体探测和字幕扫描的播放启动详情。
     *
     * @param id 观看记录 ID。
     * @returns 轻量播放详情。
     */
    public async playerDetail(id: string): Promise<WatchHistoryVO | null> {
        return this.watchHistoryService.playerDetail(id);
    }

    /**
     * 独立解析播放记录应使用的字幕。
     *
     * @param id 观看记录 ID。
     * @returns 字幕解析结论；没有匹配字幕时 `subtitlePath` 为空字符串。
     */
    public async playerSubtitle(id: string): Promise<SubtitleResolution> {
        return this.watchHistoryService.playerSubtitle(id);
    }

    public async getNextVideo(currentId: string): Promise<WatchHistoryVO | null> {
        return this.watchHistoryService.getNextVideo(currentId);
    }

    public async setPodcastModePreference({ videoId, podcastMode }: {
        videoId: string, podcastMode: boolean
    }): Promise<void> {
        return this.watchHistoryService.setPodcastModePreference(videoId, podcastMode);
    }

    registerRoutes(): void {
        registerRoute('watch-history/list', (p) => this.list(p), {
            schema: z.string().optional(),
        });
        registerRoute('watch-history/list/basic', (p) => this.listBasic(p), {
            schema: z.string().optional(),
        });
        registerRoute('watch-history/progress/update', (p) => this.updateProgress(p), {
            schema: z.object({
                file: nonEmptyStringSchema,
                currentPosition: finiteNonNegativeNumberSchema,
            }),
        });
        registerRoute('watch-history/create', (p) => this.create(p), {
            schema: z.array(nonEmptyStringSchema),
        });
        registerRoute('watch-history/create/from-library', (p) => this.create(p, true), {
            schema: z.array(nonEmptyStringSchema),
        });
        registerRoute('watch-history/group-delete', (p) => this.groupDelete(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('watch-history/detail', (p: string) => this.detail(p), {
            schema: z.string(),
        });
        registerRoute('watch-history/player-detail', (p) => this.playerDetail(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('watch-history/player-subtitle', (p) => this.playerSubtitle(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('watch-history/attach-srt', (p) => this.attachSrt(p), {
            schema: z.object({
                videoPath: nonEmptyStringSchema,
                srtPath: nonEmptyStringSchema,
            }),
        });
        registerRoute('watch-history/get-next-video', (p) => this.getNextVideo(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('watch-history/set-podcast-mode-preference', (p) => this.setPodcastModePreference(p), {
            schema: z.object({
                videoId: nonEmptyStringSchema,
                podcastMode: z.boolean(),
            }),
        });
    }
}
