import type {
    SentencePracticeMode,
    SentencePracticeResultVO,
    SentencePracticeWordResult,
} from '@/common/contracts/sentence-practice';
import type { WordEncounterAction } from '@/common/types/vocabulary';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { revalidateReviewQueue } from '@/fronted/features/video-learning/reviewQueue';

const logger = getRendererLogger('PracticeWordEvidence');

/**
 * 一次练习对应的句子上下文。
 */
export interface PracticeSentenceContext {
    fileHash: string;
    sentenceIndex: number;
    sentenceHash: string;
    text: string;
}

/**
 * 把逐词对齐结果换算为 0-100 的记忆证据分。
 *
 * extra 是用户多说/多写的词，不属于原句目标词，不能作为记忆证据。
 *
 * @param word 单个词的对齐结果。
 * @returns 证据分；extra 返回 null。
 */
export function practiceWordScore(word: SentencePracticeWordResult): number | null {
    switch (word.status) {
        case 'match':
            return 100;
        case 'sub':
            return Math.round(Math.max(0, Math.min(1, word.similarity ?? 0.5)) * 100);
        case 'missing':
            return 0;
        case 'extra':
            return null;
    }
}

/**
 * 跟读/听写完成后，把每个目标词的记忆证据异步写入后端。
 *
 * 写入失败只记日志，不影响评分展示与历史记录；后端只会更新已经在用户词表里的词，
 * 因此普通字幕词不会被顺手加入个人词表。
 *
 * @param result 本次练习结果。
 * @param mode 练习模式。
 * @param sentence 练习句子上下文。
 */
export function recordPracticeWordEvidence(
    result: SentencePracticeResultVO,
    mode: SentencePracticeMode,
    sentence: PracticeSentenceContext,
): void {
    const action: WordEncounterAction = mode === 'shadowing' ? 'shadow' : 'dictation';
    const tasks = result.words.flatMap((word) => {
        const score = practiceWordScore(word);
        if (score === null || !word.expected.trim()) {
            return [];
        }
        return [videoLearningApi.recordWordEncounter({
            word: word.expected,
            action,
            fileHash: sentence.fileHash,
            sentenceIndex: sentence.sentenceIndex,
            sentenceHash: sentence.sentenceHash,
            context: sentence.text,
            score,
        })];
    });
    if (tasks.length === 0) {
        return;
    }

    void Promise.allSettled(tasks).then((outcomes) => {
        let recorded = 0;
        for (const outcome of outcomes) {
            if (outcome.status === 'fulfilled') {
                recorded += 1;
            } else {
                logger.error('failed to record practice word evidence', {
                    error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
                    mode,
                });
            }
        }
        if (recorded > 0) {
            revalidateReviewQueue();
        }
    });
}
