import path from 'node:path';
import { app, dialog } from 'electron';
import { inject, injectable } from 'inversify';
import { z } from 'zod';

import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import TYPES from '@/backend/ioc/types';
import type LearningDataService from '@/backend/services/LearningDataService';
import type { LearningSessionSummaryParams } from '@/common/types/learningSession';
import type { LearningDataExportResultVO } from '@/common/types/learningData';

/**
 * 学习数据 IPC 控制器：会话摘要、导出与清除。
 */
@injectable()
export default class LearningDataController implements Controller {
    constructor(
        @inject(TYPES.LearningDataService) private readonly learningDataService: LearningDataService,
    ) {}

    /**
     * 查询当前播放会话的学习摘要。
     */
    public async getSessionSummary(params: LearningSessionSummaryParams) {
        return this.learningDataService.getSessionSummary(params);
    }

    /**
     * 打开保存对话框并把学习数据写成 JSON。
     */
    public async exportData(): Promise<LearningDataExportResultVO> {
        const date = new Date().toISOString().slice(0, 10);
        const result = await dialog.showSaveDialog({
            title: '导出学习数据',
            defaultPath: path.join(app.getPath('documents'), `dashplayer-learning-data-${date}.json`),
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }
        try {
            const { bytes } = await this.learningDataService.exportToJson(result.filePath);
            return { success: true, path: result.filePath, bytes };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * 清除学习事件、复习卡与掌握字段；词表和用户状态保留。
     */
    public async resetLearningData() {
        return this.learningDataService.resetLearningData();
    }

    public registerRoutes(): void {
        registerRoute('learning-data/session-summary', (p) => this.getSessionSummary(p), {
            schema: z.object({
                videoId: z.string().min(1).optional(),
                fileHash: z.string().min(1).optional(),
                since: z.string().min(1),
                limit: positiveIntSchema.max(100).optional(),
            }).refine((value) => Boolean(value.videoId || value.fileHash), {
                message: 'videoId 或 fileHash 至少提供一个',
            }),
        });
        registerRoute('learning-data/export', () => this.exportData());
        registerRoute('learning-data/reset', () => this.resetLearningData());
    }
}
