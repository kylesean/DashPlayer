import type { SrtLine } from './types';
import { dedupeRollingLines } from './rolling-dedup';

/**
 * 意群重切分：把滚动式碎片字幕（YouTube 自动字幕的典型形态——cue 时间轴重叠、
 * 句子被拦腰切断、常无句末标点）重切成"完整意群"级别的字幕行。
 *
 * 与旧版贪心实现的区别：
 * 1. 先用 {@link dedupeRollingLines} 去掉滚动重复尾巴，避免拼出重复文本；
 * 2. 把字幕摊平成"词 + 估算时间"序列，用动态规划求全局最优切分，
 *    而不是"标点说了算、超长再回溯逗号"的局部补丁；
 * 3. 词内时间按音节权重插值（英文里音节数比字符数与发音时长更相关）。
 *
 * 这里不读音频：解析层要求纯函数、毫秒级返回。声学信号若要做，必须走
 * 「先出文本结果、后台算完再静默替换」的懒加载路径，不能阻塞字幕渲染。
 */

/** 句末标点：允许其后紧跟收尾引号/括号；省略号同样算收束。 */
const TERMINAL_END_PATTERN = /[.!?…]["'”』」)\]]?$/;

/** 从句标点：逗号、分号、冒号，是弱于句末的意群边界。 */
const CLAUSE_END_PATTERN = /[,;:]["'”』」)\]]?$/;

/** 说话人切换标记：YouTube 自动字幕用 `>>` 表示换人，视为强制句边界。 */
const SPEAKER_MARK_PATTERN = />>/g;

/** 整条 cue 只有背景音/音乐等方括号或圆括号标记（如 `[Music]`）。 */
const BRACKET_MARKER_PATTERN = /^\s*[[(][^\])]*[\])]\s*$/;

/** 时间比较的浮点容差。 */
const EPS = 0.001;

/** 单个意群的字符数上限：防止无标点段落归并出巨块。 */
const MAX_BLOCK_CHARS = 220;

/** 单个意群的词数上限。 */
const MAX_BLOCK_WORDS = 40;

/** 单个意群的有声时长上限（秒）。 */
const MAX_BLOCK_SECONDS = 12;

/** 切分后子区间的最小时长（秒），保证 createSrtLine 的严格递增校验。 */
const MIN_SEGMENT_SECONDS = 0.2;

/** 行最短展示字符数：低于它按差值惩罚，避免孤零零的短行。 */
const MIN_LINE_CHARS = 24;

/**
 * 行舒适字符数。
 *
 * 学习场景要的是「完整意群」，不是电视台式的两行短字幕：一条 80~100 字符的
 * 完整句子远好过两条各 40 字符的残句。因此这个阈值明显高于广播字幕的 42，
 * 只在接近 {@link MAX_BLOCK_CHARS} 时才明显施压。
 */
const LONG_LINE_CHARS = 110;

/** 阅读速度舒适上限（字符/秒）。 */
const COMFORT_CPS = 18;

/** 断点代价：句末标点且下一词大写开头，是天然句边界。 */
const BREAK_TERMINAL = 0;

/** 断点代价：句末标点但下一词非大写（如 `etc. and`），略高于天然边界。 */
const BREAK_TERMINAL_NO_CAP = 12;

/** 断点代价：逗号/分号/冒号。 */
const BREAK_CLAUSE = 40;

/** 断点代价：cue 之间有明显停顿（≥0.6s）。 */
const BREAK_PAUSE_STRONG = 20;

/** 断点代价：cue 之间有中等停顿（≥0.3s）。 */
const BREAK_PAUSE_MEDIUM = 60;

/** 断点代价：cue 边界但测不到停顿（滚动字幕常态）。 */
const BREAK_CUE = 110;

/** 断点代价：cue 内部、无任何文本或停顿信号，最不希望切。 */
const BREAK_HARD = 170;

/** 每行基础代价：让总代价在同分时偏向更少的行。 */
const LINE_BASE_COST = 1;

/** 短行代价斜率：每少一个字符加多少代价。 */
const SHORT_LINE_COST_PER_CHAR = 6;

/** 长行代价系数：超过舒适字符数后按平方增长。 */
const LONG_LINE_COST_K = 0.02;

/** 语速过快代价系数与封顶。 */
const FAST_CPS_COST_K = 0.5;
const FAST_CPS_COST_CAP = 300;

/** 行时长超过该值（秒）后线性惩罚。 */
const LONG_DURATION_START_SECONDS = 12;
const LONG_DURATION_COST_PER_SECOND = 12;

/** 行内横跨明显停顿（≥0.35s）的惩罚：把两句话硬并成一行是最差形态。 */
const INTERNAL_PAUSE_COST = 220;
const INTERNAL_PAUSE_SECONDS = 0.35;

/**
 * 行尾悬空虚词惩罚。
 *
 * 这是旧贪心算法最容易犯的错：`... are going to talk about` / `a topic that ...`
 * 在 cue 边界被切开，前半句停在一个介词上。这类断点对学习者毫无意义——
 * 它既不是一个意群，翻译模型也拿不到完整结构。因此凡是行尾落在虚词上，
 * 断句代价直接加上这个值，迫使动态规划继续吞并下一条 cue。
 */
const DANGLING_FUNCTION_WORD_COST = 260;

/**
 * 不能作为句尾的虚词集合：冠词、介词、连词、代词、助动词、关系词。
 *
 * 只收「后面必然还需要内容」的词。副词与形容词虽然也可能悬空，但它们本身
 * 带语义，强行惩罚会过度合并。
 */
const DANGLING_WORDS = new Set([
    'a', 'an', 'the',
    'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about', 'into',
    'over', 'under', 'between', 'through', 'during', 'without', 'within', 'across',
    'against', 'toward', 'towards', 'upon', 'onto', 'per', 'via',
    'and', 'or', 'but', 'nor', 'so', 'yet', 'because', 'although', 'though',
    'while', 'whereas', 'unless', 'until', 'since', 'if', 'when', 'whenever',
    'where', 'wherever', 'whether', 'than', 'as', 'like',
    'that', 'which', 'who', 'whom', 'whose', 'what',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their', 'this', 'these', 'those',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'do', 'does', 'did', 'have', 'has', 'had',
    'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
    'not', 'no', 'very', 'just', 'also', 'too', 'only', 'even', 'still',
]);

/** 停顿分级阈值（秒）。 */
const STRONG_PAUSE_SECONDS = 0.6;
const MEDIUM_PAUSE_SECONDS = 0.3;

/** 摊平后的一个词及其估算时间。 */
interface Word {
    /** 词文本（可能带尾随标点）。 */
    text: string;
    /** 估算开始时间（秒）。 */
    start: number;
    /** 估算结束时间（秒）。 */
    end: number;
    /** 所属 cue 下标。 */
    cueIndex: number;
    /** 所属 cue 的开始时间。 */
    cueStart: number;
    /** 所属 cue 的结束时间。 */
    cueEnd: number;
    /** 是否为所属 cue 的第一个词。 */
    isCueFirst: boolean;
    /** 所属 cue 是否因滚动重叠被截短（末词的 end 已按截断点收缩）。 */
    cueTruncated: boolean;
    /** 是否因 `>>` 说话人标记强制在此词前断句。 */
    forcedBreak: boolean;
}

/**
 * 估算一个词的音节数，作为时间插值的权重。
 *
 * 英文里音节数与发音时长的相关性明显强于字符数：`strength`（8 字符 1 音节）
 * 与 `idea`（4 字符 3 音节）的字符占比会把时间摊错。这里用元音串计数做近似，
 * 并对词尾不发音的 `e` 做修正；非拉丁文本退化为按字符数。
 *
 * @param word 词文本。
 * @returns 音节权重，最小为 1。
 */
const syllableWeight = (word: string): number => {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
    if (cleaned.length === 0) {
        return 0.5;
    }
    const groups = cleaned.match(/[aeiouy]+/g);
    let count = groups ? groups.length : 1;
    if (cleaned.length > 2 && cleaned.endsWith('e') && count > 1) {
        count -= 1;
    }
    return Math.max(1, count);
};

/**
 * 判断一条 cue 是否只是背景音标记（如 `[Music]`、`(applause)`）。
 *
 * @param text 已剥掉说话人标记的文本。
 * @returns 纯标记时返回 true。
 */
const isBracketMarkerOnly = (text: string): boolean => BRACKET_MARKER_PATTERN.test(text);

/**
 * 把一条 cue 的文本按 `>>` 切成若干段，并标记哪些段需要强制断句。
 *
 * @param text 原始 cue 文本。
 * @returns 文本段及其强制断句标记；空段被丢弃。
 */
const splitBySpeakerMark = (text: string): Array<{ text: string; forcedBreak: boolean }> => {
    const parts = text.split(SPEAKER_MARK_PATTERN);
    const result: Array<{ text: string; forcedBreak: boolean }> = [];
    for (let index = 0; index < parts.length; index++) {
        const trimmed = parts[index].trim();
        if (!trimmed) {
            continue;
        }
        // 第一段没有前置 `>>`；后续每段都跟在一次换人之后。
        result.push({ text: trimmed, forcedBreak: index > 0 });
    }
    return result;
};

/**
 * 把字幕行摊平成词序列，并在每条 cue 内部按音节权重插值时间。
 *
 * 只保证 cue 内部时间单调：跨 cue 的文本顺序才是语义顺序，而滚动字幕的
 * cue 时间本身可能重叠甚至倒挂，强行全局单调会把时间轴扭曲得更厉害。
 *
 * @param lines 已去重的字幕行。
 * @returns 词序列。
 */
const flattenWords = (lines: readonly SrtLine[]): Word[] => {
    const words: Word[] = [];
    let cueIndex = -1;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const segments = splitBySpeakerMark(line.contentEn);
        const cueText = segments.map((segment) => segment.text).join(' ');
        if (!cueText || isBracketMarkerOnly(cueText)) {
            continue;
        }
        cueIndex += 1;
        /*
          有效发声窗口的终点。

          滚动字幕的 `end` 是「这行滚出屏幕」的时刻，不是「这句话说完」的时刻：
          实测 99.6% 的 cue 结束时间都晚于下一条 cue 的开始时间，平均多出 2.12s。
          直接拿 `end - start` 当发声时长，词时间会按比例被拉长，整句随之右移——
          用户看到的就是「字幕还在，音频已经下一句了」。

          因此用下一条 cue 的起点截断：同一时刻开始说下一句，说明这一句最多说到那时。
          只在截断后仍有有效时长时才采用，避免相邻 cue 完全重叠时把窗口压成 0。
        */
        const nextCue = lines[lineIndex + 1];
        /*
          只对「滚动重叠」截断，不对「插话嵌套」截断。

          两者形态相似但语义相反：
          - 滚动重叠：后一条 cue 向前压进前一条的尾巴（实测占 954/956，重叠约占后句 33%），
            说明前一条已经说完、屏幕还在显示，可以安全截断；
          - 插话嵌套：后一条 cue 完全落在前一条区间内（如音效、旁人短句），
            前一条仍在继续，截断会把主句压成插话的长度。
        */
        const isRollingOverlap = nextCue !== undefined
            && nextCue.start > line.start
            && nextCue.start < line.end
            && nextCue.end > line.end;
        const speechEnd = isRollingOverlap ? nextCue.start : line.end;
        const duration = Math.max(speechEnd - line.start, EPS);
        const pending: Array<{ text: string; forcedBreak: boolean }> = [];
        for (const segment of segments) {
            const tokens = segment.text.split(/\s+/).filter(Boolean);
            for (let index = 0; index < tokens.length; index++) {
                pending.push({ text: tokens[index], forcedBreak: segment.forcedBreak && index === 0 });
            }
        }
        if (pending.length === 0) {
            cueIndex -= 1;
            continue;
        }
        const weights = pending.map((item) => syllableWeight(item.text));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let cumulative = 0;
        for (let index = 0; index < pending.length; index++) {
            const before = cumulative;
            cumulative += weights[index];
            words.push({
                text: pending[index].text,
                start: line.start + duration * (before / totalWeight),
                end: line.start + duration * (cumulative / totalWeight),
                cueIndex,
                cueStart: line.start,
                cueEnd: line.end,
                isCueFirst: index === 0,
                cueTruncated: isRollingOverlap,
                forcedBreak: pending[index].forcedBreak,
            });
        }
    }
    return words;
};

/**
 * 词级增量贡献，供候选行指标在 O(1) 时间内扩展。
 *
 * 动态规划对每个终点从右向左扩展行首，同一批词会被反复纳入不同候选行。
 * 若每次都重新切片并排序求并集，复杂度会退化成 O(n² log n)，一小时素材
 * 就要几百毫秒。这里把每个词的贡献预先算好，扩展时只做累加。
 */
interface WordDelta {
    /** 该词自身字符数。 */
    chars: number;
    /** 与前一词之间是否达到行内停顿阈值。 */
    pauseBefore: boolean;
    /** 开始时间。 */
    start: number;
    /** 结束时间。 */
    end: number;
}

/**
 * 预计算每个词的增量贡献。
 *
 * 词间空格不放进增量：候选行的行首词不贡献空格，而行首由动态规划决定，
 * 预先算进增量会让每个候选行都多算一个字符。
 *
 * @param words 词序列。
 * @returns 与 `words` 等长的增量表。
 */
const buildDeltas = (words: readonly Word[]): WordDelta[] => words.map((word, index) => {
    const previous = index > 0 ? words[index - 1] : null;
    const crossesCue = previous !== null && previous.cueIndex !== word.cueIndex;
    return {
        chars: word.text.length,
        pauseBefore: crossesCue && word.cueStart - previous.cueEnd >= INTERNAL_PAUSE_SECONDS,
        start: word.start,
        end: word.end,
    };
});

/**
 * 从右向左扩展行首时逐步累加的行指标。
 *
 * 词区间的并集时长用「新增区间的长度减去与已覆盖包络的重叠」增量维护：
 * 同一 cue 内区间按音节顺序相接、跨 cue 时按文本顺序推进，因此只需维护
 * 已覆盖的 [minStart, maxEnd] 包络即可，无需排序。
 */
interface RunningMetrics {
    chars: number;
    words: number;
    /** 行内已确认的停顿次数（不含当前行首词之前的那次）。 */
    internalPauseCount: number;
    /**
     * 当前行首词之前的停顿。
     *
     * 从右向左扩展时，每次新加入的词都会成为新的行首，它前面的停顿因此
     * 从「行内停顿」退化为「行边界」。这里先暂存，等再有词加入、它确实
     * 变成行内词时，才计入 {@link internalPauseCount}。
     */
    headPauseBefore: boolean;
    /** 已覆盖区间的最小开始时间。 */
    minStart: number;
    /** 已覆盖区间的最大结束时间。 */
    maxEnd: number;
    /** 已覆盖区间的并集时长。 */
    unionSec: number;
}

/**
 * 新建空的行指标累加器。
 *
 * @returns 初始为空的累加器。
 */
const createRunningMetrics = (): RunningMetrics => ({
    chars: 0,
    words: 0,
    internalPauseCount: 0,
    headPauseBefore: false,
    minStart: Number.POSITIVE_INFINITY,
    maxEnd: Number.NEGATIVE_INFINITY,
    unionSec: 0,
});

/**
 * 把一个词的增量并入正在扩展的候选行（原地修改）。
 *
 * @param running 当前累计指标。
 * @param delta 待并入词的增量。
 */
const extendMetrics = (running: RunningMetrics, delta: WordDelta): void => {
    if (running.words === 0) {
        running.chars = delta.chars;
        running.words = 1;
        running.headPauseBefore = delta.pauseBefore;
        running.minStart = delta.start;
        running.maxEnd = delta.end;
        running.unionSec = Math.max(0, delta.end - delta.start);
        return;
    }
    // 行内词之间固定一个空格；行首词不贡献空格。
    running.chars += delta.chars + 1;
    // 原行首词现在成了行内词，它之前那次停顿才算行内停顿。
    if (running.headPauseBefore) {
        running.internalPauseCount += 1;
    }
    running.headPauseBefore = delta.pauseBefore;
    running.words += 1;
    const overlap = Math.max(0, Math.min(running.maxEnd, delta.end) - Math.max(running.minStart, delta.start));
    running.unionSec += Math.max(0, delta.end - delta.start) - overlap;
    running.minStart = Math.min(running.minStart, delta.start);
    running.maxEnd = Math.max(running.maxEnd, delta.end);
};

/**
 * 判断一个词是否会让句子「悬空」——即后面必然还需要内容。
 *
 * 剥掉尾随标点与引号后查表，因此 `about,` / `about` / `about.` 一视同仁。
 * 句末标点结尾的词不算悬空：`... talk about.` 是一个完整的（省略了宾语的）句子。
 *
 * @param word 行尾词。
 * @returns 悬空时返回 true。
 */
const isDanglingWord = (word: string): boolean => {
    if (TERMINAL_END_PATTERN.test(word)) {
        return false;
    }
    const cleaned = word
        .toLowerCase()
        .replace(/^["'“”‘’([\]]+/, '')
        .replace(/["'“”‘’)\],;:]+$/, '')
        .trim();
    return DANGLING_WORDS.has(cleaned);
};

/**
 * 计算在第 `start` 个词之前断行的代价。
 *
 * 信号强度从强到弱：`>>` 换人 / 句末标点 / 明显停顿 / 从句标点 /
 * 中等停顿 / 裸 cue 边界 / cue 内部硬切。
 *
 * @param words 词序列。
 * @param start 断点所在词下标。
 * @returns 断点代价。
 */
const breakCost = (words: readonly Word[], start: number): number => {
    if (start <= 0) {
        return 0;
    }
    const previous = words[start - 1];
    const current = words[start];
    if (current.forcedBreak) {
        return BREAK_TERMINAL;
    }
    if (TERMINAL_END_PATTERN.test(previous.text)) {
        return /^["“']?[A-Z]/.test(current.text) ? BREAK_TERMINAL : BREAK_TERMINAL_NO_CAP;
    }
    // 行尾悬空虚词：不管 cue 边界多自然，都不是一个可学的意群。
    if (isDanglingWord(previous.text)) {
        return DANGLING_FUNCTION_WORD_COST;
    }
    if (CLAUSE_END_PATTERN.test(previous.text)) {
        return BREAK_CLAUSE;
    }
    if (current.cueIndex !== previous.cueIndex) {
        const gap = current.cueStart - previous.cueEnd;
        if (gap >= STRONG_PAUSE_SECONDS) {
            return BREAK_PAUSE_STRONG;
        }
        if (gap >= MEDIUM_PAUSE_SECONDS) {
            return BREAK_PAUSE_MEDIUM;
        }
        return BREAK_CUE;
    }
    return BREAK_HARD;
};

/**
 * 计算一条候选行的展示代价：阅读速度过快、行过短/过长、行时长过久
 * 与行内横跨停顿都会被惩罚。
 *
 * @param metrics 行指标。
 * @returns 行代价。
 */
const lineCost = (metrics: RunningMetrics): number => {
    const duration = Math.max(metrics.unionSec, 0.2);
    const cps = metrics.chars / duration;
    const fastCost = Math.min(FAST_CPS_COST_CAP, FAST_CPS_COST_K * Math.max(0, cps - COMFORT_CPS) ** 2);
    const shortCost = SHORT_LINE_COST_PER_CHAR * Math.max(0, MIN_LINE_CHARS - metrics.chars);
    const longCost = LONG_LINE_COST_K * Math.max(0, metrics.chars - LONG_LINE_CHARS) ** 2;
    const lingeringCost = LONG_DURATION_COST_PER_SECOND * Math.max(0, metrics.unionSec - LONG_DURATION_START_SECONDS);
    return fastCost + shortCost + longCost + lingeringCost + metrics.internalPauseCount * INTERNAL_PAUSE_COST;
};

/**
 * 判断两个相邻词之间是否必须断句（不可合并进同一意群）。
 *
 * 强制断句有两种来源：
 * 1. `>>` 说话人切换——换人必然换句；
 * 2. 前一个词以句末标点收束——学习单元必须是完整句子，不能把两句并成一行。
 *
 * @param words 词序列。
 * @param index 断点所在词下标。
 * @returns 必须断句时返回 true。
 */
const isMandatoryBreak = (words: readonly Word[], index: number): boolean => {
    if (index <= 0 || index >= words.length) {
        return false;
    }
    return words[index].forcedBreak || TERMINAL_END_PATTERN.test(words[index - 1].text);
};

/**
 * 用动态规划把词序列切成展示总代价最低的意群。
 *
 * `bestCost[i]` 为切完前 i 个词的最小总代价；行首从 i-1 向左扩展，
 * 任一硬约束（字符数/时长）越界后更长的行必然也越界，直接停止。
 * 单词行不受硬上限约束：超长单词也必须完整展示。
 *
 * 强制断句点（换人、句末标点）是不可跨越的边界：候选行一旦跨过它就不合法，
 * 因此这里对每个终点先求出它左侧最近的强制断点，行首不得越过该点。
 *
 * @param words 词序列。
 * @returns 每段的行首词下标（升序）。
 */
const solveBoundaries = (
    words: readonly Word[],
): number[] => {
    const total = words.length;
    if (total === 0) {
        return [];
    }
    const bestCost = new Array<number>(total + 1).fill(Number.POSITIVE_INFINITY);
    const bestFrom = new Array<number>(total + 1).fill(-1);
    // nearestMandatory[end] = 小于 end 的最大强制断点下标；候选行首不得小于它。
    const nearestMandatory = new Array<number>(total + 1).fill(0);
    let lastMandatory = 0;
    for (let end = 1; end <= total; end++) {
        if (isMandatoryBreak(words, end - 1)) {
            lastMandatory = end - 1;
        }
        nearestMandatory[end] = lastMandatory;
    }
    bestCost[0] = 0;
    const deltas = buildDeltas(words);
    for (let end = 1; end <= total; end++) {
        // 从右向左扩展行首，指标增量累加，避免每个候选都重扫一遍词。
        const running = createRunningMetrics();
        for (let start = end - 1; start >= nearestMandatory[end] && end - start <= MAX_BLOCK_WORDS; start--) {
            extendMetrics(running, deltas[start]);
            const metrics = running;
            const singleWord = end - start === 1;
            const withinLimits = singleWord
                || (metrics.chars <= MAX_BLOCK_CHARS && metrics.unionSec <= MAX_BLOCK_SECONDS);
            if (withinLimits) {
                const candidate = bestCost[start] + breakCost(words, start) + lineCost(metrics) + LINE_BASE_COST;
                if (candidate < bestCost[end]) {
                    bestCost[end] = candidate;
                    bestFrom[end] = start;
                }
            }
            if (!singleWord && (metrics.chars > MAX_BLOCK_CHARS || metrics.unionSec > MAX_BLOCK_SECONDS)) {
                break;
            }
        }
    }
    const starts: number[] = [];
    for (let boundary = total; boundary > 0; boundary = bestFrom[boundary]) {
        if (bestFrom[boundary] < 0) {
            // 理论上不可达（单词行恒可行）；兜底为逐词切分，绝不丢词。
            for (let index = 0; index < total; index++) {
                starts.push(index);
            }
            return starts;
        }
        starts.push(bestFrom[boundary]);
    }
    starts.reverse();
    return starts;
};

/**
 * 把词序列按行首下标拼回字幕行，并保证时间轴严格递增。
 *
 * 行的展示区间取覆盖词的包络 [minStart, maxEnd]：滚动字幕的时间本就重叠，
 * 包络能保证语音不被截断。随后做一次向前钳制，避免后一行起点早于前一行终点。
 *
 * 两端额外贴合 cue 的真实边界：cue 的首词向前贴到 cue 起点、末词向后贴到
 * cue 终点。词时间是按音节插值的估算值，若严格只用词时间，行尾会停在
 * 「最后一个词的估算终点」而不是语音真正结束的位置，句尾尾音与停顿被切掉，
 * 单句循环和自动暂停就会提前半拍。
 *
 * @param words 词序列。
 * @param starts 每段行首词下标。
 * @returns 字幕行（index 从 1 重新编号）。
 */
const buildLines = (words: readonly Word[], starts: readonly number[]): SrtLine[] => {
    const lines: SrtLine[] = [];
    let previousEnd = 0;
    for (let position = 0; position < starts.length; position++) {
        const from = starts[position];
        const to = position + 1 < starts.length ? starts[position + 1] : words.length;
        const slice = words.slice(from, to);
        if (slice.length === 0) {
            continue;
        }
        const text = slice.map((word) => word.text).join(' ')
            .replace(/\s+([,.;:!?…]+)/g, '$1')
            .trim();
        if (!text) {
            continue;
        }
        const first = slice[0];
        const last = slice[slice.length - 1];
        // 行首：本行含有该 cue 的首词时贴到 cue 起点，否则用词估算起点。
        // 同一条 cue 被拆成多行时，只有第一行贴 cue 起点，后续行按词时间推进。
        const rawStart = first.isCueFirst ? first.cueStart : first.start;
        /*
          行尾贴到「这一行最后一个词估算的结束时间」。

          不再用 `cueEnd`：它是滚动离场时刻，比真实说完时刻平均晚 2.12s，
          贴上去会把整行拉长，下一行则被 `previousEnd` 推后，误差逐句累积。
          词时间已经按有效发声窗口插值过，`last.end` 就是最接近真实发音结束的值。

          例外：插话嵌套的 cue 没有被截断，末词的 `last.end` 仍是它自己的结束时间，
          直接用它会把主句一起压短；这种情况贴回该 cue 的真实终点。
        */
        /*
          行尾取「本行覆盖到的最大真实终点」：
          - 被截断的 cue 用词估算终点（滚动离场时刻不可信）；
          - 未截断、且本行确实收在该 cue 末词时，用它的真实终点
            （插话嵌套时主句仍在继续，不能被插话压短）；
          - 同一 cue 被拆成多行时，只有最后一行才贴 cue 终点，
            否则第一行会吃掉整条 cue 的时长。
        */
        const isCueLastWord = last.cueIndex !== slice[slice.length - 2]?.cueIndex;
        const coveredCueEnd = slice.reduce(
            (max, word) => Math.max(
                max,
                word.cueTruncated || !isCueLastWord ? word.end : word.cueEnd,
            ),
            last.end,
        );
        const rawEnd = coveredCueEnd;
        const start = Math.max(rawStart, previousEnd);
        let end = Math.max(rawEnd, start + MIN_SEGMENT_SECONDS);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            continue;
        }
        if (end <= start) {
            end = start + MIN_SEGMENT_SECONDS;
        }
        lines.push({
            index: lines.length + 1,
            start,
            end,
            contentEn: text,
            contentZh: '',
        });
        previousEnd = end;
    }
    return lines;
};

/**
 * 把碎片字幕行重切分成完整意群行。
 *
 * 处理顺序：
 * 1. 双语字幕（任一行含中文）原样返回——人工对齐的双语文件重切分会错位；
 * 2. 去掉相邻 cue 的滚动重复尾巴；
 * 3. 摊平成带估算时间的词序列；
 * 4. 动态规划求全局最优切分；
 * 5. 拼回字幕行并保证时间轴严格递增。
 *
 * @param lines 解析产出的字幕行数组（应按时间升序）。
 * @returns 重切分后的字幕行（index 从 1 重新编号）；无需处理时原样返回。
 */
export const resegmentIntoMeaningGroups = (lines: SrtLine[]): SrtLine[] => {
    if (lines.length === 0) {
        return lines;
    }
    if (lines.some((line) => line.contentZh.trim().length > 0)) {
        return lines;
    }
    const deduped = dedupeRollingLines(lines);
    const words = flattenWords(deduped);
    if (words.length === 0) {
        return lines;
    }
    const starts = solveBoundaries(words);
    const result = buildLines(words, starts);
    return result.length > 0 ? result : lines;
};
