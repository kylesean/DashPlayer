import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';

/**
 * 内置词典的元信息。
 *
 * 设置页用它回答「内置词典收了多少词」，让「装了几本词典」
 * 成为一个能直接看到的事实，而不是只能靠猜。
 */
export interface BuiltinDictionaryMetaVO {
    /** 数据来源标识，例如 ecdict。 */
    source: string;
    /** 数据源版本。 */
    sourceVersion: string;
    /** 收录词条数。 */
    wordCount: number;
}

/**
 * 预置词典数据读取接口。
 *
 * 数据来源是随应用打包的只读 SQLite（resources/dictionary.sqlite，ECDICT 常用词子集），
 * 不依赖任何密钥配置，用于在用户未配置词典服务时提供开箱即用的查词能力。
 */
export default interface BuiltinDictionaryStore {
    /**
     * 查询单词，未命中返回 null。
     *
     * 行为说明：
     * - 大小写不敏感，首尾空白会被清理；
     * - 原样查询未命中时，先还原为原始形态（lemma）再查一次，覆盖复数、时态等变体；
     * - 数据文件缺失或版本不匹配时直接抛错（打包问题必须显式暴露，不做静默回退）。
     *
     * @param word 用户点击的单词原文。
     */
    lookup(word: string): OpenAIDictionaryResult | null;

    /**
     * 读取内置词典的元信息。
     *
     * 与 {@link lookup} 共用同一个懒加载连接，不会为了一次展示再打开一份数据。
     * 数据文件缺失或版本不匹配时直接抛错（打包问题必须显式暴露）。
     *
     * @returns 词条数与数据源版本。
     */
    meta(): BuiltinDictionaryMetaVO;
}
