import { z } from 'zod';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema } from '@/backend/controllers/ipc/routeSchemas';
import type LocalAiService from '@/backend/services/LocalAiService';
import type { LocalEmbeddingRuntime } from '@/backend/infrastructure/ai/LocalEmbeddingRuntime';
import TYPES from '@/backend/ioc/types';

const modelIdParamSchema = z.object({ modelId: nonEmptyStringSchema });

/** 提供本地模型的设置页管理与实际推理检查。 */
@injectable()
export class LocalAiController implements Controller {
    /** 注入统一的模型管理与推理服务。 */
    public constructor(
        @inject(TYPES.LocalAiService) private readonly localAi: LocalAiService,
        @inject(TYPES.LocalEmbeddingRuntime) private readonly embedding: LocalEmbeddingRuntime,
    ) {}

    /** 注册状态、下载、取消、删除、切换使用模型和生成检查路由。 */
    public registerRoutes(): void {
        registerRoute('local-ai/status', () => this.localAi.getStatus());
        registerRoute('local-ai/use', ({ modelId }) => this.localAi.setActiveModelId(modelId), {
            schema: modelIdParamSchema,
        });
        registerRoute('local-ai/download', ({ modelId }) => this.localAi.download(modelId), {
            schema: modelIdParamSchema,
        });
        registerRoute('local-ai/cancel-download', () => this.localAi.cancelDownload());
        registerRoute('local-ai/delete', ({ modelId }) => this.localAi.deleteModel(modelId), {
            schema: modelIdParamSchema,
        });
        registerRoute('local-ai/speed-test', ({ modelId }) => this.localAi.speedTest(modelId), {
            schema: modelIdParamSchema,
        });
        registerRoute('local-ai/embedding-status', () => this.embedding.getStatus());
        registerRoute('local-ai/embedding-download', () => this.embedding.download());
        registerRoute('local-ai/embedding-multimodal-download', () => this.embedding.downloadMultimodal());
        registerRoute('local-ai/embedding-cancel-download', async () => this.embedding.cancelDownload());
        registerRoute('local-ai/embedding-remove', () => this.embedding.remove());
    }
}
