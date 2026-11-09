/**
 * 用户导入词典的跨进程契约。
 *
 * 导入只接受用户自己合法持有的词典文件（StarDict / CSV / SQLite）；
 * 应用不内置、不下载任何版权词典内容。
 */

/** 支持的导入格式。 */
export type ImportedDictionaryFormat = 'stardict' | 'csv' | 'sqlite';

/** 一条已导入词典的展示信息。 */
export interface ImportedDictionaryVO {
    /** 稳定词典 ID。 */
    id: string;
    /** 展示名（StarDict 取 bookname，其余取文件名）。 */
    name: string;
    /** 导入时的源格式。 */
    format: ImportedDictionaryFormat;
    /** 词条数量。 */
    entryCount: number;
    /** 是否参与查词。 */
    enabled: boolean;
    /** 导入时间（UTC ISO 8601）。 */
    importedAt: string;
}
