import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import { resolveDictionaryDifficulty } from '@/backend/services/dictionaryDifficulty';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';
import { analyzeWords } from '@/backend/utils/language/VocabularyMatcher';
import { estimateComprehension } from '@/common/learning/comprehension';
import { isContentLemma } from '@/common/learning/contentWords';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import type {
    ComprehensionWordInput,
    SubtitleComprehensionParams,
    SubtitleComprehensionVO,
} from '@/common/types/subtitleComprehension';

const CLAUSE_PATTERN = /[,;:—–]|\b(?:because|although|though|while|whereas|unless|if|which|whose)\b/gi;

/**
 * 句子理解度服务契约。
 */
export default interface SubtitleComprehensionService {
    /**
     * 使用本地词典与用户词状态估算句子理解度。
     *
     * @param params 句子文本与可选播放定位。
     * @returns 可解释的理解度快照。
     */
    build(params: SubtitleComprehensionParams): Promise<SubtitleComprehensionVO>;
}

/**
 * 按本地词典难度与用户记忆估算句子理解度。
 *
 * 该服务只用于调节中文字幕的视觉权重，不会隐藏内容，也不进入翻译生成链路。
 */
@injectable()
export class SubtitleComprehensionServiceImpl implements SubtitleComprehensionService {
    constructor(
        @inject(TYPES.WordsRepository) private readonly wordsRepository: WordsRepository,
        @inject(TYPES.BuiltinDictionaryStore) private readonly dictionaryStore: BuiltinDictionaryStore,
    ) {}

    public async build(params: SubtitleComprehensionParams): Promise<SubtitleComprehensionVO> {
        const text = params.text?.trim() ?? '';
        if (!text) {
            throw new Error('句子不能为空');
        }

        const userWordMap = await this.loadUserWordMap();
        const analyzed = analyzeWords(text);
        const contentWords: ComprehensionWordInput[] = [];
        let wordCount = 0;
        let longWordCount = 0;

        analyzed.forEach((token, order) => {
            if (token.type !== 'word') {
                return;
            }
            wordCount += 1;
            const surface = token.text.toLowerCase();
            const lemma = token.lemma.toLowerCase();
            if (!isContentLemma(lemma) || surface.includes('\'') || surface.includes('’')) {
                return;
            }
            // 句首之外的大写词按专名处理，不把作品名、人名误判为学习者不认识的生词。
            if (order > 0 && /^[A-Z]/.test(token.text)) {
                return;
            }

            const entry = this.lookup(lemma, surface);
            const userWord = userWordMap.get(lemma) ?? userWordMap.get(surface);
            if (lemma.length >= 9) {
                longWordCount += 1;
            }
            contentWords.push({
                lemma,
                difficulty: resolveDictionaryDifficulty(entry),
                userStatus: userWord?.status,
                mastery: userWord?.mastery,
            });
        });

        const clauseCount = (text.match(CLAUSE_PATTERN) ?? []).length;
        const estimate = estimateComprehension({
            words: contentWords,
            wordCount,
            clauseCount,
            longWordCount,
        });
        return {
            ...estimate,
            fileHash: params.fileHash,
            sentenceIndex: params.sentenceIndex,
        };
    }

    /**
     * 读取用户个人词表；默认 starter pack 不参与“已掌握”判断。
     *
     * @returns 小写词形到词条的索引。
     */
    private async loadUserWordMap(): Promise<Map<string, Word>> {
        const words = await this.wordsRepository.getAll();
        return new Map(words.map((word) => [word.word.toLowerCase(), word]));
    }

    /**
     * 查询本地词典；lemma 未命中时退回句中原形。
     *
     * @param lemma 归一化词形。
     * @param surface 句中实际词形。
     * @returns 本地词典词条；未命中时为 null。
     */
    private lookup(lemma: string, surface: string): OpenAIDictionaryResult | null {
        return this.dictionaryStore.lookup(lemma) ?? this.dictionaryStore.lookup(surface);
    }

}
