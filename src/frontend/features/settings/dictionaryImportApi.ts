import type { ImportedDictionaryVO } from '@/common/contracts/imported-dictionary';
import type { BuiltinDictionaryMetaVO } from '@/common/contracts/builtin-dictionary';
import { backendClient } from '@/frontend/infrastructure/electron/backendClient';

/** 文件选择器允许的扩展名（不带点）。 */
const DICTIONARY_FILE_FORMATS = ['ifo', 'csv', 'sqlite', 'db', 'sqlite3'];

/**
 * 用户导入词典的前端 API 封装。
 */
export const dictionaryImportApi = {
    /**
     * 读取内置词典的元信息。
     *
     * @returns 词条数与数据源版本。
     */
    builtinMeta: (): Promise<BuiltinDictionaryMetaVO> => backendClient.call('dictionary/builtin-meta'),

    /**
     * 列出已导入词典。
     *
     * @returns 已导入词典列表。
     */
    list: (): Promise<ImportedDictionaryVO[]> => backendClient.call('dictionary/list'),

    /**
     * 导入一个用户自备的词典文件。
     *
     * @param filePath 文件绝对路径。
     * @returns 新导入词典的展示信息。
     */
    import: (filePath: string): Promise<ImportedDictionaryVO> =>
        backendClient.call('dictionary/import', { filePath }),

    /**
     * 删除一个导入词典。
     *
     * @param id 词典 ID。
     * @returns 删除完成后结束。
     */
    remove: (id: string): Promise<void> => backendClient.call('dictionary/remove', { id }),

    /**
     * 启用或停用词典。
     *
     * @param id 词典 ID。
     * @param enabled 是否参与查词。
     * @returns 保存完成后结束。
     */
    setEnabled: (id: string, enabled: boolean): Promise<void> =>
        backendClient.call('dictionary/set-enabled', { id, enabled }),

    /**
     * 打开文件选择对话框，只允许词典相关扩展名。
     *
     * @returns 用户选中的文件路径；取消时为空数组。
     */
    selectFile: (): Promise<string[]> => backendClient.call('system/select-file', DICTIONARY_FILE_FORMATS),
};
