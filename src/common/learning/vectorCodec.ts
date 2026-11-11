/**
 * 向量与 Float32 字节之间的编解码。
 *
 * 落库时用 Float32 而不是 JSON：768 维的 JSON 文本约 9 KB，Float32 只要
 * 3072 字节，读写都不需要逐字符解析。Float32 的精度对余弦相似度足够，
 * 因为最终只用相似度的相对排序。
 */

/** 向量维度与字节长度的换算；每个分量 4 字节。 */
export const float32ByteLength = (dimension: number): number => dimension * Float32Array.BYTES_PER_ELEMENT;

/**
 * 把向量编码为 Float32 小端字节。
 *
 * @param vector 原始向量。
 * @returns 可直接写入 BLOB 的 Buffer。
 */
export function encodeVector(vector: readonly number[]): Buffer {
    const floats = Float32Array.from(vector);
    return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
}

/**
 * 从 Float32 小端字节还原向量。
 *
 * 字节长度必须是 4 的倍数且与期望维度一致；不一致时返回 `null` 而不是
 * 补零或截断——错位的向量会让相似度静默失真，比直接降级更危险。
 *
 * @param blob 数据库读出的字节。
 * @param dimension 期望维度。
 * @returns 还原后的向量；不合法时为 `null`。
 */
export function decodeVector(blob: Buffer | Uint8Array | null, dimension: number): number[] | null {
    if (!blob) {
        return null;
    }
    if (dimension <= 0 || blob.byteLength !== float32ByteLength(dimension)) {
        return null;
    }
    const bytes = Buffer.isBuffer(blob)
        ? blob
        : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
    // 复制一份独立缓冲区，避免 Buffer 池的偏移问题。
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const floats = new Float32Array(copy.buffer);
    return Array.from(floats);
}
