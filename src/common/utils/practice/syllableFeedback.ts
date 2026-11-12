/**
 * 音节级发音反馈。
 *
 * 这里刻意不做音素识别：真正的音素级评分需要强制对齐（forced alignment）
 * 与音素声学模型，本地没有这类模型时任何「音素准确度」都是编造的。可行的
 * 做法是用词典 IPA 提供参考音节结构，再用录音里已经能测到的时长与能量，
 * 指出「哪个音节被吞掉/粘连/没重读」——这些结论可解释、可复现，也不假装
 * 知道用户具体发错了哪个音。
 */

/**
 * 一个参考音节。
 *
 * 由 IPA 音标切分得到：元音是音节核，辅音归属到相邻音节。
 */
export interface ReferenceSyllable {
    /** 音节文本，例如 `ˈdɪp`。 */
    text: string;
    /** 是否带主重音标记。 */
    stressed: boolean;
    /** 音节在词内的序号。 */
    index: number;
}

/**
 * IPA 中的元音字符。
 *
 * 只收窄式符号：`e` / `o` 在宽式标音里是 `ɛ` / `ʊ`、`oʊ` 的一部分，
 * 把它们当独立元音会把 `loʊ` 拆成两个音节。
 */
const IPA_VOWELS = new Set([
    'a', 'i', 'u', 'y',
    'ɑ', 'æ', 'ɐ', 'ɒ', 'ɔ', 'ə', 'ɘ', 'ɛ', 'ɜ', 'ɞ', 'ɪ', 'ɨ', 'ʊ', 'ʉ', 'ʌ', 'ɯ',
    'ɤ', 'ɵ', 'ø', 'œ', 'ɶ', 'ɤ', 'ɚ', 'ɝ', 'ɹ',
    'ᵻ', 'ᵿ', 'ɐ', 'ɪ̈', 'ʊ̈',
]);

/**
 * 双元音的第二个成分。
 *
 * 紧跟在一个元音之后时不开启新音节：`loʊ` 是一个音节，不是 `l-o-ʊ` 两个。
 * 单独出现时仍按元音处理（`ə` 本身就是弱读音节核）。
 */
const IPA_GLIDES = new Set(['ɪ', 'ʊ', 'ɚ']);

/** 重音标记：主重音、次重音。 */
const PRIMARY_STRESS = 'ˈ';
const SECONDARY_STRESS = 'ˌ';

const stripSlashes = (phonetic: string): string =>
    phonetic.replace(/^\/+|\/+$/gu, '').trim();

const isVowel = (char: string): boolean => IPA_VOWELS.has(char);

/**
 * 把词典 IPA 切成音节。
 *
 * 规则是最小可解释版本：每个元音核开启一个音节，元音之间的辅音串整体归入
 * 后一个音节（英语里 `bet.ter` 这类双辅音分界对评分没有影响，因为我们只比较
 * 音节数量与重音位置，不比较辅音归属）。没有元音的输入返回空数组。
 *
 * @param phonetic 词典音标，可带或不带 `/`。
 * @returns 按顺序排列的音节；无法切分时返回空数组。
 */
export const splitIpaSyllables = (phonetic: string): ReferenceSyllable[] => {
    const ipa = stripSlashes(phonetic);
    if (!ipa) {
        return [];
    }
    const syllables: ReferenceSyllable[] = [];
    let buffer = '';
    let stressed = false;
    let hasNucleus = false;
    let previousChar = '';

    const flush = () => {
        if (hasNucleus && buffer) {
            syllables.push({
                text: buffer,
                stressed,
                index: syllables.length,
            });
        }
        buffer = '';
        stressed = false;
        hasNucleus = false;
        previousChar = '';
    };

    for (const char of ipa) {
        if (char === PRIMARY_STRESS || char === SECONDARY_STRESS) {
            // 重音标记出现在音节开头；若当前音节已经有元音核，说明它属于下一个音节。
            if (hasNucleus) {
                flush();
            }
            stressed = char === PRIMARY_STRESS;
            buffer += char;
            continue;
        }
        if (isVowel(char)) {
            // 紧跟元音之后的 ɪ/ʊ/ɚ 属于双元音的第二段；`ə` 只有在同样
            // 紧跟元音时才按滑音处理（`aɪə` 这类），单独出现仍是音节核。
            const isGlideAfterNucleus = hasNucleus
                && (IPA_GLIDES.has(char) || char === 'ə')
                && isVowel(previousChar);
            if (hasNucleus && !isGlideAfterNucleus) {
                flush();
            }
            buffer += char;
            hasNucleus = true;
            previousChar = char;
            continue;
        }
        buffer += char;
        previousChar = char;
    }
    flush();
    return syllables;
};

/**
 * 比较参考音节数与用户实际说出的音节数。
 *
 * 用户音节数由录音时长与语速估计，而不是真的数出来；因此只在差异达到
 * 两个音节以上时才给出结论，避免把正常的连读/缩读判成错误。
 */
export interface SyllableCountVerdict {
    reference: number;
    estimated: number;
    /** 用户说得明显更少（吞音）时为 `fewer`。 */
    verdict: 'match' | 'fewer' | 'more' | 'unknown';
}

/** 每个音节的平均发音时长参考值（秒）；英语自然语速约 4–5 音节/秒。 */
const SECONDS_PER_SYLLABLE = 0.22;
/** 允许的估计误差（音节数）。 */
const SYLLABLE_TOLERANCE = 2;

/**
 * 用录音时长估算音节数，并与参考音节数比较。
 *
 * @param referenceSyllables 参考音节数。
 * @param speechDurationSec 用户实际说话时长（秒），静音已被裁掉。
 * @returns 比较结论；输入不可用时返回 `unknown`。
 */
export const compareSyllableCount = (
    referenceSyllables: number,
    speechDurationSec: number,
): SyllableCountVerdict => {
    if (referenceSyllables <= 0 || speechDurationSec <= 0) {
        return { reference: referenceSyllables, estimated: 0, verdict: 'unknown' };
    }
    const estimated = Math.max(1, Math.round(speechDurationSec / SECONDS_PER_SYLLABLE));
    const delta = estimated - referenceSyllables;
    if (Math.abs(delta) < SYLLABLE_TOLERANCE) {
        return { reference: referenceSyllables, estimated, verdict: 'match' };
    }
    return {
        reference: referenceSyllables,
        estimated,
        verdict: delta < 0 ? 'fewer' : 'more',
    };
};

/** 音节间能量差达到该值才认为存在可辨识的重音落点。 */
export const SYLLABLE_STRESS_MARGIN = 0.15;

/**
 * 逐词音节反馈。
 */
export interface WordSyllableFeedback {
    word: string;
    /** 词典音标；没有音标时为 null。 */
    phonetic: string | null;
    /** 参考音节；没有音标时为空数组。 */
    syllables: ReferenceSyllable[];
    /** 主重音所在音节序号；没有音标或没有重音标记时为 null。 */
    stressIndex: number | null;
    /**
     * 用户在这个词上的相对重读位置。
     *
     * 由录音能量分布折算到音节序号；无法判断时为 null。
     */
    spokenStressIndex: number | null;
    /** 重音位置是否一致；任一侧未知时为 null。 */
    stressAligned: boolean | null;
}

/**
 * 为一个词生成音节级反馈。
 *
 * @param word 词形。
 * @param phonetic 词典音标。
 * @param syllableEnergies 逐音节能量（0–1），由调用方在真实录音上按音节时间片测量；
 *   缺省时只返回参考音节结构，不给出「用户重读在哪」的结论。
 */
export const buildWordSyllableFeedback = (
    word: string,
    phonetic: string | null,
    syllableEnergies: readonly number[] | null = null,
): WordSyllableFeedback => {
    const syllables = phonetic ? splitIpaSyllables(phonetic) : [];
    const stressIndex = syllables.findIndex((syllable) => syllable.stressed);
    const resolvedStressIndex = stressIndex >= 0 ? stressIndex : null;

    // 只有在音节数对得上、且能量差异足够明显时才判断用户重读位置；
    // 否则宁可说「不确定」，也不把一次随机波动说成发音问题。
    const usable = syllableEnergies !== null
        && syllables.length > 1
        && syllableEnergies.length === syllables.length;
    let spokenStressIndex: number | null = null;
    if (usable) {
        let peak = 0;
        for (let index = 1; index < syllableEnergies.length; index += 1) {
            if (syllableEnergies[index] > syllableEnergies[peak]) {
                peak = index;
            }
        }
        const min = Math.min(...syllableEnergies);
        const max = syllableEnergies[peak];
        // 起伏太小说明各音节一样重，谈不上「重音落在某处」。
        if (max - min >= SYLLABLE_STRESS_MARGIN) {
            spokenStressIndex = peak;
        }
    }
    const stressAligned = resolvedStressIndex !== null && spokenStressIndex !== null
        ? resolvedStressIndex === spokenStressIndex
        : null;

    return {
        word,
        phonetic,
        syllables,
        stressIndex: resolvedStressIndex,
        spokenStressIndex,
        stressAligned,
    };
};

