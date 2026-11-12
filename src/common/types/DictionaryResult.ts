import type { EnglishDictionarySense } from '@/common/contracts/english-dictionary';

/**
 * 释义来源。
 *
 * 单词卡第一层只展示本地词典或 AI 的结果，来源必须显式告诉用户：
 * 同一个词在不同来源下的义项详略差别很大，用户需要知道自己看的是哪一本。
 *
 * - imported：用户导入的词典（优先级最高）；
 * - builtin：随应用打包的内置 ECDICT；
 * - ai：在线/本地大模型生成（词典都未命中时）。
 */
export type DictionarySource = 'imported' | 'builtin' | 'ai';

/**
 * OpenAI 字典中的例句项。
 */
export interface OpenAIDictionaryExample {
    /** 英文例句原文。 */
    sentence: string;
    /** 例句中文翻译。 */
    translation: string;
}

/**
 * OpenAI 字典中的释义项。
 */
export interface OpenAIDictionaryDefinition {
    /** 词性（如 noun/verb/adj），未知时为空字符串。 */
    partOfSpeech: string;
    /** 中文释义。 */
    meaning: string;
    /** 与该释义对应的例句列表。 */
    examples: OpenAIDictionaryExample[];
}

/**
 * OpenAI 单词卡返回结构（简化版）。
 *
 * 说明：
 * - 该结构同时承载 AI 生成与预置词典（ECDICT）两种数据来源的单词卡；
 * - 词库元信息字段（collins/oxford/bnc/frq/tags）只有预置词典命中的结果才会填充，
 *   AI 生成结果不携带这些字段；
 * - englishSenses 只有安装了英英释义增强包时才会填充。
 */
export interface OpenAIDictionaryResult {
    /** 查询词。 */
    word: string;
    /** 音标（IPA），未知时为空字符串。 */
    phonetic: string;
    /** 释义列表，至少可能为空数组。 */
    definitions: OpenAIDictionaryDefinition[];
    /** 释义来源；历史缓存或流式中间态可能缺失。 */
    source?: DictionarySource;
    /** 英英释义（需要安装增强包）；未安装或未命中时为 undefined。 */
    englishSenses?: EnglishDictionarySense[];
    /** Collins 词典星级（1-5，数值越大越常用），仅预置词典数据提供。 */
    collins?: number;
    /** Oxford 词典收录标记（0-3，>0 表示收录），仅预置词典数据提供。 */
    oxford?: number;
    /** BNC 语料库词频排名（1 起，越小越常用），仅预置词典数据提供。 */
    bnc?: number;
    /** COCA 语料库词频排名（1 起，越小越常用），仅预置词典数据提供。 */
    frq?: number;
    /** 考试大纲标签（zk/gk/cet4/cet6/ky/toefl/ielts/gre），仅预置词典数据提供。 */
    tags?: string[];
}
