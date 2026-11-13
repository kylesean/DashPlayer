/**
 * 深度可选映射：把一个对象类型的所有属性变为可选并递归应用到嵌套对象。
 *
 * 常用于「流式/部分可达」的视图模型——数据还在逐步抵达时，
 * 中间形态的每个字段都可能缺席。当前主要消费者是 sentenceStudyHelpers
 * 的划词分词签名（focalPoint 可为部分对象）。
 */
export type DeepPartial<T> = T extends (infer U)[]
    ? Array<DeepPartial<U | undefined>>
    : T extends object
        ? { [K in keyof T]?: DeepPartial<T[K]> }
        : T;
