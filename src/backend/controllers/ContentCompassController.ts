import { inject, injectable } from 'inversify';
import { z } from 'zod';

import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type ContentCompassService from '@/backend/services/ContentCompassService';
import {
    CONTENT_COMPASS_ACTIONS,
    CONTENT_COMPASS_REASONS,
    type ContentCompassEventParams,
    type ContentCompassListParams,
    type ContentCompassStatsParams,
} from '@/common/types/contentCompass';

/**
 * 内容指南针查询、反馈与效果看板 IPC 控制器。
 */
@injectable()
export default class ContentCompassController implements Controller {
    constructor(
        @inject(TYPES.ContentCompassService) private readonly contentCompassService: ContentCompassService,
    ) {}

    public async list(params: ContentCompassListParams) {
        return this.contentCompassService.list(params);
    }

    public async recordEvent(params: ContentCompassEventParams): Promise<void> {
        await this.contentCompassService.recordEvent(params);
    }

    public async getStats(params: ContentCompassStatsParams) {
        return this.contentCompassService.getStats(params);
    }

    /**
     * 推荐的四段因果漏斗。
     */
    public async getAttribution(params: { days?: number }) {
        return this.contentCompassService.getAttribution(params);
    }

    registerRoutes(): void {
        registerRoute('content-compass/list', (params) => this.list(params), {
            schema: z.object({
                excludeVideoIds: z.array(z.string().min(1)).max(100).optional(),
                limit: z.number().int().min(1).max(6).optional(),
            }),
        });
        registerRoute('content-compass/event', (params) => this.recordEvent(params), {
            schema: z.object({
                videoId: z.string().min(1),
                action: z.enum(CONTENT_COMPASS_ACTIONS),
                score: z.number().min(0).max(1).optional(),
                reasonCode: z.enum(CONTENT_COMPASS_REASONS).optional(),
                surface: z.literal('home').optional(),
            }),
        });
        registerRoute('content-compass/stats', (params) => this.getStats(params), {
            schema: z.object({
                days: z.number().int().min(1).max(90).optional(),
            }),
        });
        registerRoute('content-compass/attribution', (params) => this.getAttribution(params), {
            schema: z.object({
                days: z.number().int().min(1).max(90).optional(),
            }),
        });
    }
}
