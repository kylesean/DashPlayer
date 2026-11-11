import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import type SentenceVocabularyService from '@/backend/services/SentenceVocabularyService';
import type { WordMatchService } from '@/backend/services/WordMatchService';
import { analyzeWords } from '@/backend/utils/language/VocabularyMatcher';
import { ObjUtil } from '@/backend/utils/ObjUtil';
import {
    recommendContext,
    type ContextCandidateInput,
} from '@/common/learning/contextRecommendation';
import { isContentLemma } from '@/common/learning/contentWords';
import type {
    ContextPackParams,
    ContextPackVO,
    ContextTokenVO,
} from '@/common/types/contextPack';
import type { WordEncounterAction } from '@/common/types/vocabulary';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTION_WINDOW_MS = 90 * DAY_MS;
const IGNORE_SUPPRESS_MS = 14 * DAY_MS;
const SUGGESTION_COOLDOWN_MS = 90 * 1000;
const SAME_WORD_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 6;
const MAX_PICKED_WORDS = 12;
const TRACKED_ACTIONS = ['open', 'lookup', 'save', 'ignore', 'seen'] as const satisfies readonly WordEncounterAction[];

/**
 * 为一句话生成 ContextPack 的服务契约。
 */
export default interface ContextPackService {
    /**
     * 生成候选评分、理由与每句唯一建议。
     *
     * @param params 句子与提示强度。
     * @returns 本地确定性 ContextPack。
     */
    build(params: ContextPackParams): Promise<ContextPackVO>;
}

/**
 * ContextPack 实现。
 *
 * 实时路径只读本地词典、用户词表与事件流，不调用模型、不访问网络。
 */
@injectable()
export class ContextPackServiceImpl implements ContextPackService {
    constructor(
        @inject(TYPES.SentenceVocabularyService) private readonly sentenceVocabularyService: SentenceVocabularyService,
        @inject(TYPES.WordMatchService) private readonly wordMatchService: WordMatchService,
        @inject(TYPES.ReviewCardRepository) private readonly reviewCardRepository: ReviewCardRepository,
        @inject(TYPES.WordEncounterRepository) private readonly encounterRepository: WordEncounterRepository,
    ) {}

    public async build(params: ContextPackParams): Promise<ContextPackVO> {
        const text = params.text?.trim() ?? '';
        if (!text) {
            throw new Error('句子不能为空');
        }

        const now = Date.now();
        const [picked, userWords, recentActions] = await Promise.all([
            this.sentenceVocabularyService.pick(text),
            this.wordMatchService.getVocabularyWords(),
            this.encounterRepository.listActionsSince(
                new Date(now - ACTION_WINDOW_MS).toISOString(),
                TRACKED_ACTIONS,
            ),
        ]);
        const userWordMap = new Map(
            userWords.map((word) => [word.word.toLowerCase(), word]),
        );
        const lookupCounts = new Map<string, number>();
        const lastSavedAt = new Map<string, number>();
        const lastIgnoredAt = new Map<string, number>();
        const lastSeenAt = new Map<string, number>();
        let lastSuggestionShownAt = 0;
        for (const action of recentActions) {
            const lemma = action.lemma.toLowerCase();
            const actionAt = Date.parse(action.createdAt) || 0;
            if (action.action === 'open' || action.action === 'lookup') {
                lookupCounts.set(lemma, (lookupCounts.get(lemma) ?? 0) + 1);
            } else if (action.action === 'save') {
                lastSavedAt.set(lemma, Math.max(
                    lastSavedAt.get(lemma) ?? 0,
                    actionAt,
                ));
            } else if (action.action === 'ignore') {
                lastIgnoredAt.set(lemma, Math.max(
                    lastIgnoredAt.get(lemma) ?? 0,
                    actionAt,
                ));
            } else if (action.action === 'seen') {
                lastSeenAt.set(lemma, Math.max(lastSeenAt.get(lemma) ?? 0, actionAt));
                lastSuggestionShownAt = Math.max(lastSuggestionShownAt, actionAt);
            }
        }

        const analyzedTokens = analyzeWords(text);
        let wordCount = 0;
        let contentWords = 0;
        const tokens: ContextTokenVO[] = analyzedTokens.map((token, order) => {
            const lemma = token.lemma.toLowerCase();
            const isWord = token.type === 'word';
            const isContentWord = isWord && isContentLemma(lemma);
            if (isWord) {
                wordCount += 1;
            }
            if (isContentWord) {
                contentWords += 1;
            }
            return {
                text: token.text,
                lemma,
                isContentWord,
                order,
            };
        });

        const pickedWords = picked.picks.slice(0, MAX_PICKED_WORDS);
        const dueEntries = await Promise.all(pickedWords.map(async (word) => {
            const lemma = word.word.toLowerCase();
            if (!userWordMap.has(lemma)) {
                return [lemma, null] as const;
            }
            const card = await this.reviewCardRepository.findByWord(lemma);
            return [lemma, card?.due_at ?? null] as const;
        }));
        const dueMap = new Map(dueEntries);

        const candidates: ContextCandidateInput[] = [];
        for (const word of pickedWords) {
            const lemma = word.word.toLowerCase();
            const userWord = userWordMap.get(lemma);
            const ignoredAt = lastIgnoredAt.get(lemma) ?? 0;
            const savedAt = lastSavedAt.get(lemma) ?? 0;
            const suppressed = !userWord
                && ignoredAt > savedAt
                && now - ignoredAt <= IGNORE_SUPPRESS_MS;
            if (suppressed) {
                continue;
            }
            const surfaces = new Set(word.surfaces.map((surface) => surface.toLowerCase()));
            const order = tokens.findIndex((token) => (
                surfaces.has(token.text.toLowerCase())
                || token.lemma === lemma
            ));
            candidates.push({
                word: word.word,
                surface: word.surfaces[0] ?? word.word,
                phonetic: word.phonetic,
                meaning: word.meaning,
                tags: word.tags,
                order: order >= 0 ? order : Number.MAX_SAFE_INTEGER,
                isUserWord: Boolean(userWord),
                status: userWord?.status ?? null,
                mastery: userWord?.mastery ?? 0,
                confidence: userWord?.confidence ?? 0,
                dueAt: dueMap.get(lemma) ?? null,
                lookupCount: lookupCounts.get(lemma) ?? 0,
                savedBefore: savedAt > 0,
            });
        }

        const recommendation = recommendContext({
            guidance: params.guidance,
            now,
            sentenceWordCount: wordCount,
            contentWords,
            candidates,
        });
        const topCandidates = recommendation.candidates.slice(0, MAX_CANDIDATES);
        let suggestion = recommendation.suggestion;
        if (suggestion && now - lastSuggestionShownAt < SUGGESTION_COOLDOWN_MS) {
            suggestion = null;
        }
        if (suggestion && now - (lastSeenAt.get(suggestion.word) ?? 0) < SAME_WORD_COOLDOWN_MS) {
            suggestion = null;
        }

        return {
            sentenceHash: ObjUtil.hash({ text }),
            fileHash: params.fileHash,
            sentenceIndex: params.sentenceIndex,
            vocabularyRevision: this.wordMatchService.getVocabularyRevision(),
            guidance: params.guidance,
            tokens,
            contentWords,
            candidates: topCandidates,
            suggestion: suggestion && topCandidates.some((candidate) => candidate.word === suggestion.word)
                ? suggestion
                : null,
            density: {
                active: suggestion ? 1 : 0,
                max: 1,
            },
        };
    }
}
