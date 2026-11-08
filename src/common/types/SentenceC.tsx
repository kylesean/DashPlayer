import type { SentenceStruct } from '@/common/types/SentenceStruct';


export interface SrtSentence {
    fileHash: string;
    filePath: string;
    sentences: Sentence[];
    /**
     * 本组句子是否为意群重切分行。练习记录等按 (fileHash, index) 引用句子的功能
     * 据此隔离键：开关切换后序号含义整体重排，键里缺开关状态会让历史挂到另一句话上。
     */
    resegmented: boolean;
}

export interface Sentence {
    fileHash: string;
    index: number;

    start: number;

    end: number;

    adjustedStart: number | null;
    adjustedEnd: number | null;

    /**
     * 字幕英文原文
     */
    text: string;

    /**
     * 字幕中文原文
     */
    textZH: string;

    key: string;

    /**
     * 批量翻译的分组, 从1开始
     */
    transGroup: number;

    /**
     * renderer 定位键，格式为 `fileHash:index`。
     * 说明：仅用于后端回推译文时让前端找到对应句子，不参与翻译缓存寻址。
     */
    translationKey: string;

    struct: SentenceStruct;
}
