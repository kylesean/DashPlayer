/**
 * 应用自己用 ffmpeg 生成的 PCM WAV 头信息。
 *
 * 只描述解码需要的字段，不暴露 chunk 布局：调用方要么按偏移读原始字节，
 * 要么交给 `decodePcm16Wav` 一次性解码。
 */
export interface Pcm16WavHeader {
    /** 采样率，单位 Hz。 */
    sampleRate: number;
    /** PCM 数据在文件中的字节偏移。 */
    dataOffset: number;
    /** PCM 数据字节数，取自 data 块的声明长度，可能大于实际可用字节。 */
    dataLength: number;
}

/**
 * 解析 16kHz 单声道 16-bit PCM WAV 头。
 *
 * 只接受 `audioFormat = 1`（未压缩 PCM）、单声道、16 位。其他格式返回
 * null，让调用方静默跳过分析，而不是拿错误解释的字节去算能量。
 *
 * 只读 chunk 头而不复制数据，因此传入整个文件或仅文件头都可以。
 * `dataLength` 是 data 块声明的长度，不按传入缓冲截断：只传文件头时必须
 * 再用 `resolveDataLength()` 按文件实际大小校正，否则会把声明长度当成可用
 * 长度而读越界。
 *
 * @param buffer 文件起始字节；至少 44 字节。
 * @returns 头信息；格式不受支持时为 null。
 */
export const parsePcm16WavHeader = (buffer: Uint8Array): Pcm16WavHeader | null => {
    if (buffer.byteLength < 44) {
        return null;
    }
    const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
    const wave = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
    if (riff !== 'RIFF' || wave !== 'WAVE') {
        return null;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    let offset = 12;
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let audioFormat = 0;
    let dataOffset = -1;
    let dataLength = 0;

    while (offset + 8 <= buffer.byteLength) {
        const chunkId = String.fromCharCode(
            buffer[offset],
            buffer[offset + 1],
            buffer[offset + 2],
            buffer[offset + 3],
        );
        const chunkSize = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (chunkId === 'fmt ' && body + 16 <= buffer.byteLength) {
            audioFormat = view.getUint16(body, true);
            channels = view.getUint16(body + 2, true);
            sampleRate = view.getUint32(body + 4, true);
            bitsPerSample = view.getUint16(body + 14, true);
        } else if (chunkId === 'data') {
            dataOffset = body;
            dataLength = chunkSize;
            break;
        }
        offset = body + chunkSize + (chunkSize % 2);
    }

    if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || sampleRate <= 0 || dataOffset < 0) {
        return null;
    }
    return { sampleRate, dataOffset, dataLength };
};

/**
 * 用文件实际大小校正 PCM 数据长度。
 *
 * 只读文件头时 `dataLength` 只能截断到已读字节；录制中断或写入未完成时
 * RIFF 头里的长度也可能大于实际文件。两种情况都必须按实际可用字节收敛，
 * 否则读取会越过文件末尾得到空块。
 *
 * @param header 解析出的头信息。
 * @param fileSize 文件总字节数。
 * @returns 校正后的数据长度；偏移越界时为 0。
 */
export const resolveDataLength = (header: Pcm16WavHeader, fileSize: number): number => {
    if (!Number.isFinite(fileSize) || fileSize <= header.dataOffset) {
        return 0;
    }
    return Math.min(header.dataLength, fileSize - header.dataOffset);
};
