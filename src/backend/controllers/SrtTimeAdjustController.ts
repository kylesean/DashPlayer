import type {SubtitleTimestampAdjustmentInput} from '@/common/contracts/subtitle-timestamp-adjustment';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    nonEmptyStringSchema,
    subtitleTimestampAdjustmentInputSchema,
} from '@/backend/controllers/ipc/routeSchemas';
import type Controller from '@/backend/controllers/Controller';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type SrtTimeAdjustService from '@/backend/services/SrtTimeAdjustService';

/**
 * 字幕时间偏移调整 IPC 控制器。
 */
@injectable()
export default class SrtTimeAdjustController implements Controller {
    /**
     * 构造字幕时间调整控制器。
     *
     * @param srtTimeAdjustService 字幕时间调整业务服务。
     */
    constructor(
        @inject(TYPES.SrtTimeAdjustService) private readonly srtTimeAdjustService: SrtTimeAdjustService,
    ) {}

    /**
     * 记录调整时间
     * @param e
     */
    public async record(e: SubtitleTimestampAdjustmentInput): Promise<void> {
        await this.srtTimeAdjustService.record(e);
    }

    /**
     * 删除调整时间
     * @param key
     */
    public async deleteByKey(key: string): Promise<void> {
        await this.srtTimeAdjustService.deleteByKey(key);
    }

    /**
     * 删除调整时间
     * @param fileHash
     */
    public async deleteByFile(fileHash: string): Promise<void> {
        await this.srtTimeAdjustService.deleteByFile(fileHash);
    }

    registerRoutes(): void {
        registerRoute('subtitle-timestamp/delete/by-file-hash', (p) => this.deleteByFile(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('subtitle-timestamp/delete/by-key', (p) => this.deleteByKey(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('subtitle-timestamp/update', (p) => this.record(p), {
            schema: subtitleTimestampAdjustmentInputSchema,
        });
    }
}
