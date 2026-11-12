/** 词典发音请求的超时时间（毫秒）：超时立刻退回本地离线 TTS，避免点词卡顿。 */
const DICTIONARY_FETCH_TIMEOUT_MS = 3000;
const MIN_VALID_AUDIO_BYTES = 512;

/**
 * 判断输入是否适合走“词典真人单词发音”。
 *
 * 只匹配单个英文单词或常见连字符/所有格复合词（如 `well-known`、`don't`），
 * 句子和短语直接走自然语义 TTS 合成。
 */
export const extractSingleEnglishWord = (text: string): string | null => {
    const normalized = text.trim().replace(/[’‘]/g, "'");
    if (!normalized || normalized.length > 40) {
        return null;
    }
    return /^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(normalized) ? normalized : null;
};

/**
 * 校验下载到的音频体确为合法音频（防止把 HTML 报错页或空响应写入缓存）。
 */
export const isValidAudioBuffer = (bytes: Uint8Array, contentType?: string | null): boolean => {
    if (bytes.byteLength < MIN_VALID_AUDIO_BYTES) {
        return false;
    }
    const lowerType = contentType?.toLowerCase() ?? '';
    if (lowerType.startsWith('text/') || lowerType.includes('json') || lowerType.includes('html')) {
        return false;
    }
    const hasId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const hasMpegSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    const hasOgg = bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
    const hasRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    return hasId3 || hasMpegSync || hasOgg || hasRiff || lowerType.startsWith('audio/');
};

async function fetchAudioBuffer(url: string): Promise<Buffer | null> {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(DICTIONARY_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
            return null;
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        return isValidAudioBuffer(bytes, res.headers.get('content-type')) ? bytes : null;
    } catch {
        return null;
    }
}

async function fetchFromFreeDictionaryApi(word: string, accent: 'en-US' | 'en-GB'): Promise<Buffer | null> {
    try {
        const res = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
            { signal: AbortSignal.timeout(DICTIONARY_FETCH_TIMEOUT_MS) },
        );
        if (!res.ok) {
            return null;
        }
        const payload = (await res.json()) as Array<{ phonetics?: Array<{ audio?: string }> }>;
        const urls = (payload[0]?.phonetics ?? [])
            .map((entry) => entry.audio?.trim() ?? '')
            .filter((audioUrl) => audioUrl.startsWith('http'));
        if (urls.length === 0) {
            return null;
        }
        const accentPattern = accent === 'en-GB' ? /-uk\.(mp3|ogg)/i : /-us\.(mp3|ogg)/i;
        const preferred = urls.find((url) => accentPattern.test(url)) ?? urls[0];
        return fetchAudioBuffer(preferred);
    } catch {
        return null;
    }
}

/**
 * 为单个英语单词拉取真人词典录音。
 *
 * 先走高可用低延迟真人词典接口，缺失时尝试开放词典 API；离线或未收录时返回 `null`，
 * 由调用方静默回退到本地离线神经语音（Kokoro / Piper）。
 */
export async function fetchDictionaryPronunciation(
    word: string,
    accent: 'en-US' | 'en-GB',
): Promise<Buffer | null> {
    const youdaoType = accent === 'en-GB' ? 1 : 2;
    const primaryUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${youdaoType}`;
    const primaryAudio = await fetchAudioBuffer(primaryUrl);
    if (primaryAudio) {
        return primaryAudio;
    }
    return fetchFromFreeDictionaryApi(word, accent);
}
