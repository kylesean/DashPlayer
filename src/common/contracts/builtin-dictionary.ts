/**
 * 内置词典（ECDICT）的跨进程契约。
 *
 * 内置词典随应用打包、只读、无需配置；这里只暴露设置页需要展示的元信息，
 * 不暴露数据文件路径等实现细节。
 */

/** 内置词典的元信息。 */
export interface BuiltinDictionaryMetaVO {
    /** 数据来源标识，例如 ecdict。 */
    source: string;
    /** 数据源版本。 */
    sourceVersion: string;
    /** 收录词条数。 */
    wordCount: number;
}
