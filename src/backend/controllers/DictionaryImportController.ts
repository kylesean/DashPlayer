import { z } from 'zod';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema } from '@/backend/controllers/ipc/routeSchemas';
import type ImportedDictionaryService from '@/backend/services/ImportedDictionaryService';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import TYPES from '@/backend/ioc/types';

/**
 * 用户导入词典的 IPC：列表、导入、删除、启停。
 *
 * 只处理用户自备的词典文件；应用不提供任何版权词典的下载入口。
 */
@injectable()
export default class DictionaryImportController implements Controller {
    /**
     * 构造导入词典控制器。
     *
     * @param importedDictionaryService 导入词典服务。
     */
    constructor(
        @inject(TYPES.ImportedDictionaryService)
        private readonly importedDictionaryService: ImportedDictionaryService,
        @inject(TYPES.BuiltinDictionaryStore)
        private readonly builtinDictionaryStore: BuiltinDictionaryStore,
    ) {}

    /** 注册导入词典路由。 */
    public registerRoutes(): void {
        registerRoute('dictionary/builtin-meta', async () => this.builtinDictionaryStore.meta());
        registerRoute('dictionary/list', async () => this.importedDictionaryService.list());
        registerRoute('dictionary/import', (p) => this.importedDictionaryService.importFromFile(p.filePath), {
            schema: z.object({ filePath: nonEmptyStringSchema }),
        });
        registerRoute('dictionary/remove', async (p) => {
            this.importedDictionaryService.remove(p.id);
        }, {
            schema: z.object({ id: nonEmptyStringSchema }),
        });
        registerRoute('dictionary/set-enabled', async (p) => {
            this.importedDictionaryService.setEnabled(p.id, p.enabled);
        }, {
            schema: z.object({ id: nonEmptyStringSchema, enabled: z.boolean() }),
        });
    }
}
