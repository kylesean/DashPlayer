import path from 'node:path';
import { app, dialog } from 'electron';
import { inject, injectable } from 'inversify';
import { z } from 'zod';

import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import TYPES from '@/backend/ioc/types';
import type LearningDataService from '@/backend/services/LearningDataService';
import type LearningMetricsService from '@/backend/services/LearningMetricsService';
import type LearningRecapService from '@/backend/services/LearningRecapService';
import type MemoryMapService from '@/backend/services/MemoryMapService';
import type { LearningSessionSummaryParams } from '@/common/types/learningSession';
import type {
    LearningDataExportResultVO,
    LearningDataImportResultVO,
} from '@/common/types/learningData';
import { LearningDataSnapshotError } from '@/common/learning/learningDataSnapshot';
import type { MemoryMapParams } from '@/common/types/memoryMap';
import type { LearningMetricsParams } from '@/common/types/learningMetrics';
import type {
    LearningRecapParams,
    ProductionPracticeListParams,
    RetellEvaluationParams,
    RolePlayFeedbackParams,
} from '@/common/types/learningRecap';

/**
 * 学习数据 IPC 控制器：会话摘要、导出与清除。
 */
@injectable()
export default class LearningDataController implements Controller {
    constructor(
        @inject(TYPES.LearningDataService) private readonly learningDataService: LearningDataService,
        @inject(TYPES.LearningMetricsService) private readonly learningMetricsService: LearningMetricsService,
        @inject(TYPES.LearningRecapService) private readonly learningRecapService: LearningRecapService,
        @inject(TYPES.MemoryMapService) private readonly memoryMapService: MemoryMapService,
    ) {}

    /**
     * 查询当前播放会话的学习摘要。
     */
    public async getSessionSummary(params: LearningSessionSummaryParams) {
        return this.learningDataService.getSessionSummary(params);
    }

    /**
     * 生成当前播放会话的学习复盘。
     */
    public async getRecap(params: LearningRecapParams) {
        return this.learningRecapService.buildRecap(params);
    }

    /**
     * 检查用户对原句的复述。
     */
    public async evaluateRetell(params: RetellEvaluationParams) {
        return this.learningRecapService.evaluateRetell(params);
    }

    /**
     * 检查用户对场景开场白的书面回应。
     */
    public async evaluateRolePlay(params: RolePlayFeedbackParams) {
        return this.learningRecapService.evaluateRolePlay(params);
    }

    /**
     * 读取某个视频下最近的复述 / 角色扮演结果。
     */
    public async listProductionPractice(params: ProductionPracticeListParams) {
        return this.learningRecapService.listProductionPractice(params);
    }

    /**
     * 生成个人记忆图谱。
     */
    public async getMemoryMap(params: MemoryMapParams) {
        return this.memoryMapService.getMap(params);
    }

    /**
     * 学习指标看板：北极星指标与辅助指标。
     */
    public async getMetrics(params: LearningMetricsParams) {
        return this.learningMetricsService.getMetrics(params);
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

    /**
     * 打开文件对话框并从备份恢复学习数据。
     *
     * 结构错误单独给出可读提示，磁盘错误保持原始信息，避免用户误以为是文件选错。
     */
    public async importData(): Promise<LearningDataImportResultVO> {
        const result = await dialog.showOpenDialog({
            title: '导入学习数据',
            properties: ['openFile'],
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        const filePath = result.filePaths[0];
        if (result.canceled || !filePath) {
            return { success: false, canceled: true };
        }
        try {
            return await this.learningDataService.importFromJson(filePath);
        } catch (error) {
            return {
                success: false,
                error: error instanceof LearningDataSnapshotError
                    ? error.message
                    : error instanceof Error ? error.message : String(error),
            };
        }
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
        registerRoute('learning-data/import', () => this.importData());
        registerRoute('learning-data/reset', () => this.resetLearningData());
        registerRoute('learning-data/recap', (p) => this.getRecap(p), {
            schema: z.object({
                videoId: z.string().min(1).optional(),
                fileHash: z.string().min(1).optional(),
                since: z.string().min(1),
                locale: z.enum(['zh-CN', 'en-US']).optional(),
                forceRefresh: z.boolean().optional(),
            }).refine((value) => Boolean(value.videoId || value.fileHash), {
                message: 'videoId 或 fileHash 至少提供一个',
            }),
        });
        registerRoute('learning-data/retell-feedback', (p) => this.evaluateRetell(p), {
            schema: z.object({
                original: z.string().min(1).max(1_000),
                response: z.string().min(1).max(2_000),
                locale: z.enum(['zh-CN', 'en-US']).optional(),
                forceRefresh: z.boolean().optional(),
                videoId: z.string().min(1).optional(),
                fileHash: z.string().min(1).optional(),
                sentenceIndex: z.number().int().min(0).optional(),
            }),
        });
        registerRoute('learning-data/role-play-feedback', (p) => this.evaluateRolePlay(p), {
            schema: z.object({
                scenario: z.string().max(500).optional(),
                openingLine: z.string().min(1).max(1_000),
                response: z.string().min(1).max(2_000),
                targetExpressions: z.array(z.string().min(1).max(120)).max(3).optional(),
                locale: z.enum(['zh-CN', 'en-US']).optional(),
                forceRefresh: z.boolean().optional(),
                videoId: z.string().min(1).optional(),
                fileHash: z.string().min(1).optional(),
                sentenceIndex: z.number().int().min(0).optional(),
            }),
        });
        registerRoute('learning-data/production-practice', (p) => this.listProductionPractice(p), {
            schema: z.object({
                videoId: z.string().min(1).optional(),
                fileHash: z.string().min(1).optional(),
                limit: positiveIntSchema.max(50).optional(),
            }).refine((value) => Boolean(value.videoId || value.fileHash), {
                message: 'videoId 或 fileHash 至少提供一个',
            }),
        });
        registerRoute('learning-data/memory-map', (p) => this.getMemoryMap(p), {
            schema: z.object({
                limit: z.number().int().min(1).max(20).optional(),
            }),
        });
        registerRoute('learning-data/metrics', (p) => this.getMetrics(p), {
            schema: z.object({
                windowDays: z.union([z.literal(7), z.literal(30)]).optional(),
            }),
        });
    }
}
