import type {
    ContextCandidateVO,
    ContextReasonCode,
} from '@/common/types/contextPack';
import type {
    VocabularyGuidance,
    WordStatus,
} from '@/common/types/vocabulary';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SUGGESTION_SCORE = 0.35;

/**
 * 评分所需的一个候选词输入。
 */
export interface ContextCandidateInput {
    word: string;
    surface: string;
    phonetic: string;
    meaning: string;
    tags: string[];
    order: number;
    isUserWord: boolean;
    status: WordStatus | null;
    mastery: number;
    confidence: number;
    dueAt: string | null;
    /** 最近查过/打开过的次数。 */
    lookupCount: number;
    /** 最近收藏过，即使后来删除了词条。 */
    savedBefore: boolean;
}

export interface ContextScoringInput {
    guidance: VocabularyGuidance;
    now: number;
    sentenceWordCount: number;
    contentWords: number;
    candidates: ContextCandidateInput[];
}

export interface ContextScoringResult {
    candidates: ContextCandidateVO[];
    suggestion: ContextCandidateVO | null;
}

const clampScore = (score: number): number => Math.max(0, Math.min(1, score));

/**
 * 计算一个候选词的可解释分数。
 *
 * 所有特征都是本地确定性规则：个人记忆需求优先，其次是难度与考试价值；
 * 已经在正文里高亮且掌握较稳的词会主动降权，避免建议与正文重复。
 */
const scoreCandidate = (
    candidate: ContextCandidateInput,
    input: ContextScoringInput,
): ContextCandidateVO => {
    let score = candidate.isUserWord ? 0.12 : 0.28;
    const reasonWeights = new Map<ContextReasonCode, number>();
    const addReason = (code: ContextReasonCode, weight: number): void => {
        score += weight;
        reasonWeights.set(code, (reasonWeights.get(code) ?? 0) + weight);
    };

    if (candidate.isUserWord) {
        if (candidate.status === 'learning') {
            addReason('learning', 0.2);
        } else if (candidate.status === 'familiar') {
            addReason('learning', 0.06);
        }
        if (candidate.mastery < 0.35) {
            addReason('needs_reinforcement', 0.14);
        } else if (candidate.mastery >= 0.8) {
            score -= 0.12;
        }
    }

    if (candidate.dueAt) {
        const dueIn = Date.parse(candidate.dueAt) - input.now;
        if (Number.isFinite(dueIn) && dueIn <= 0) {
            addReason('due_now', 0.55);
        } else if (Number.isFinite(dueIn) && dueIn <= 7 * DAY_MS) {
            addReason('due_soon', 0.25);
        }
    }

    if (candidate.lookupCount > 0) {
        addReason('previously_looked_up', Math.min(0.16, candidate.lookupCount * 0.07));
    }
    if (candidate.savedBefore) {
        addReason('saved_before', 0.08);
    }

    const tags = new Set(candidate.tags);
    if (tags.has('zk')) {
        score -= 0.22;
    } else if (tags.has('gre') || tags.has('toefl') || tags.has('ielts')) {
        addReason('stretch_word', 0.26);
    } else if (tags.has('cet6') || tags.has('ky')) {
        addReason('exam_core', 0.2);
    } else if (tags.has('cet4') || tags.has('gk')) {
        addReason('exam_core', 0.12);
    } else {
        addReason('useful_new_word', 0.05);
    }

    if (candidate.word.length >= 7) {
        score += 0.03;
    }
    if (input.sentenceWordCount > 28) {
        score -= 0.08;
    } else if (input.sentenceWordCount > 18) {
        score -= 0.03;
    }
    if (!candidate.isUserWord && candidate.word.length <= 4 && candidate.tags.length === 0) {
        score -= 0.05;
    }

    if (reasonWeights.size === 0) {
        addReason(candidate.isUserWord ? 'learning' : 'useful_new_word', 0);
    }

    const reasons = [...reasonWeights.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([code]) => code);

    return {
        word: candidate.word,
        surface: candidate.surface,
        phonetic: candidate.phonetic,
        meaning: candidate.meaning,
        tags: candidate.tags,
        isUserWord: candidate.isUserWord,
        status: candidate.status,
        mastery: candidate.mastery,
        confidence: candidate.confidence,
        dueAt: candidate.dueAt,
        score: Number(clampScore(score).toFixed(3)),
        reasons,
        order: candidate.order,
    };
};

/**
 * 对一句话的候选词评分，并执行「每句最多一个」的密度约束。
 *
 * @param input 候选词、提示强度与句子规模。
 * @returns 排序后的候选词和唯一建议。
 */
export const recommendContext = (input: ContextScoringInput): ContextScoringResult => {
    const candidates = input.candidates
        .map((candidate) => scoreCandidate(candidate, input))
        .sort((left, right) => (
            right.score - left.score
            || left.order - right.order
            || left.word.localeCompare(right.word)
        ));
    const top = candidates[0] ?? null;
    const suggestion = input.guidance === 'coach'
        && top !== null
        && top.score >= MIN_SUGGESTION_SCORE
        ? top
        : null;
    return { candidates, suggestion };
};
