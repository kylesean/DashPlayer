/**
 * 英英释义增强包的跨进程契约。
 *
 * 数据来自 Princeton WordNet 3.1（WordNet License），由应用在用户主动
 * 下载后解析为本地 SQLite；不随主安装包分发。
 */

/** 一条英英释义（synset 视角）。 */
export interface EnglishDictionarySense {
    /** 词性（noun/verb/adj/adv）。 */
    partOfSpeech: string;
    /** 英文释义。 */
    definition: string;
    /** WordNet 例句。 */
    examples: string[];
    /** 同义词（同 synset 的其他词条）。 */
    synonyms: string[];
    /** 反义词。 */
    antonyms: string[];
}

/** 增强包安装状态。 */
export interface EnglishDictionaryStatusVO {
    /** 是否已安装可用。 */
    installed: boolean;
    /** 是否正在下载/构建。 */
    downloading: boolean;
    /** 已下载字节数。 */
    downloadedBytes: number;
    /** 归档总字节数。 */
    totalBytes: number;
    /** 最近一次失败的错误信息；无错误时为 null。 */
    error: string | null;
}
