/**
 * 清理跟读/听写字幕中的非人声标注（舞台提示、音效、音乐符号、说话人前缀）。
 *
 * 典型脏数据：YouTube/播客自动字幕里的 `[music]`、`[laughter]`、`[applause]`、
 * `(sighs)`、`♪`、`>>`、`SPEAKER 1:`。如果不剥离，会被当成期望单词计入分母，
 * 导致莫名扣分并污染音节/音素对齐。
 */

const BRACKET_STAGE_CUE_RE = /\[[^\]]*\]/g;
const PAREN_SOUND_CUE_RE = /\([^)]*\b(?:music|applause|laughter|laughing|cheering|sighs?|groans?|coughs?|inaudible|silence|noise|sfx|singing|panting|screaming|crying|whispering|snoring|bleep|beep)\b[^)]*\)/gi;
const MUSIC_SYMBOL_RE = /[♪♫]+/g;
const SPEAKER_CHEVRON_RE = /(?:^|\s)>>+\s*/g;
const SPEAKER_PREFIX_RE = /^(?:[A-Z][A-Z0-9 _.-]{0,20}|Speaker\s+\d+)\s*:\s*/;

/**
 * 剥离字幕文本中的非语音舞台/音效标注，返回干净的可跟读文本。
 */
export const stripNonSpeechAnnotations = (text: string): string => {
    if (!text) return '';
    return text
        .replace(BRACKET_STAGE_CUE_RE, ' ')
        .replace(PAREN_SOUND_CUE_RE, ' ')
        .replace(MUSIC_SYMBOL_RE, ' ')
        .replace(SPEAKER_CHEVRON_RE, ' ')
        .trim()
        .replace(SPEAKER_PREFIX_RE, '')
        .replace(/\s+([,.!?;:])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
};
