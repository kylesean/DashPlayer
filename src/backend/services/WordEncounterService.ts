import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import { lemmatizeWord } from '@/backend/utils/language/VocabularyMatcher';
import type { WordEncounterInput } from '@/common/types/vocabulary';

/**
 * 记录用户在播放器里与单词的真实遭遇。
 *
 * R0 只负责可靠落库；R1 会基于这些事件计算掌握度、复习和推荐解释。
 */
export default interface WordEncounterService {
    record(params: WordEncounterInput): Promise<void>;
}

@injectable()
export class WordEncounterServiceImpl implements WordEncounterService {
    constructor(
        @inject(TYPES.WordEncounterRepository) private readonly repository: WordEncounterRepository,
    ) {}

    public async record(params: WordEncounterInput): Promise<void> {
        const word = params.word?.trim() ?? '';
        if (!word) {
            return;
        }
        const lemma = lemmatizeWord(word);
        if (!lemma) {
            return;
        }

        await this.repository.record({
            word,
            lemma,
            action: params.action,
            video_id: params.videoId ?? null,
            file_hash: params.fileHash ?? null,
            sentence_index: params.sentenceIndex ?? null,
            sentence_hash: params.sentenceHash ?? null,
            context: params.context ?? null,
        });
    }
}
