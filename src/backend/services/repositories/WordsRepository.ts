import type { InsertWord, Word } from '@/backend/infrastructure/db/tables/words';
import type { WordSource, WordStatus } from '@/common/types/vocabulary';

/**
 * 单词列表查询参数。
 */
export interface GetAllWordsQuery {
    search?: string;
    /**
     * 是否包含产品内置 starter pack。
     *
     * 默认排除：`source=default` 不是用户个人词表，不应出现在词汇工坊或正文标注中。
     */
    includeDefault?: boolean;
}

/**
 * 单词写入内容。
 */
export interface WordContent {
    /** 单词（基础形态，小写）。 */
    word: string;
    /** 中文释义，可为空。 */
    translate: string | null;
    /** 初始学习状态；未提供时使用 learning。 */
    status?: WordStatus;
    /** 状态来源；未提供时使用 manual。 */
    source?: WordSource;
}

/**
 * 单词状态更新参数。
 */
export interface WordStateUpdate {
    status: WordStatus;
    source?: WordSource;
}

/**
 * 单词仓储接口。
 */
export default interface WordsRepository {
    getAll(query?: GetAllWordsQuery): Promise<Word[]>;
    replaceAll(values: InsertWord[]): Promise<void>;
    /**
     * 按单词查找记录，匹配不区分大小写。
     *
     * @param word 单词。
     * @returns 命中的记录；不存在时返回 null。
     */
    findByWord(word: string): Promise<Word | null>;
    /**
     * 更新单词学习状态；不存在时由调用方决定是否插入。
     *
     * @param word 单词。
     * @param state 新状态与可选来源。
     */
    updateState(word: string, state: WordStateUpdate): Promise<void>;
    /**
     * 插入单个单词。
     *
     * @param value 单词与释义。
     */
    insertOne(value: WordContent): Promise<void>;
    /**
     * 按旧单词定位记录并更新单词与释义（匹配不区分大小写）。
     *
     * @param oldWord 更新前的单词。
     * @param value 更新后的单词与释义。
     */
    updateByWord(oldWord: string, value: WordContent): Promise<void>;
    /**
     * 按单词删除记录，匹配不区分大小写。
     *
     * @param word 单词。
     */
    deleteByWord(word: string): Promise<void>;
}
