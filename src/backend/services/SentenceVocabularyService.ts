import { inject, injectable, optional } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import type { WordMatchService } from '@/backend/services/WordMatchService';
import { analyzeWords } from '@/backend/utils/language/VocabularyMatcher';
import { isContentLemma } from '@/common/learning/contentWords';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import type {
    SentenceMemoryHints,
    SentenceVocabularyVO,
    SentenceWordEntry,
} from '@/common/types/vo/SentenceVocabularyVO';
import type { Word } from '@/backend/infrastructure/db/tables/words';

/**
 * 句子生词服务契约：用一个句子产出「值得重点认识的词」与「句内逐词释义」。
 */
export default interface SentenceVocabularyService {
    pick(text: string): Promise<SentenceVocabularyVO>;
}

const MEANING_MAX_PARTS = 2;
const MEMORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const IGNORE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MASTERY_FILTER_THRESHOLD = 0.8;
const MAX_PICKS = 4;
const COMMON_RANK_CUTOFF = 4500;

/** 仅实质内容词性允许默认入选焦点词；连词/介词/代词/助动词等除非在个人生词本里否则不入选。 */
const ALLOWED_CONTENT_POS = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);

/** 初高中大纲核心标签：初中及极常见高中词汇过滤；保留 cet6/ky/toefl/ielts/gre。 */
const COMMON_EXAM_TAGS = new Set(['zk', 'gk']);
const ADVANCED_EXAM_TAGS = new Set(['cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre']);

/** 常见功能副词、模糊代词及高频口语基础词黑名单（避免缺失词频元数据的词钻空子）。 */
const EXTRA_STOP_LEMMAS = new Set([
    'actually', 'really', 'maybe', 'probably', 'possibly', 'always', 'never', 'often',
    'usually', 'sometimes', 'already', 'almost', 'quite', 'rather', 'either', 'neither',
    'else', 'even', 'still', 'however', 'although', 'though', 'while', 'whereas', 'unless',
    'whether', 'because', 'since', 'until', 'during', 'through', 'without', 'within',
    'against', 'between', 'among', 'around', 'behind', 'beside', 'something', 'someone',
    'somebody', 'somewhere', 'anything', 'anyone', 'anybody', 'anywhere', 'everything',
    'everyone', 'everybody', 'everywhere', 'nothing', 'nobody', 'nowhere', 'everyone',
    'anyway', 'somehow', 'whenever', 'wherever', 'whatever', 'whoever', 'whichever',
    'today', 'tomorrow', 'yesterday', 'tonight', 'now', 'soon', 'later', 'early', 'late',
    'very', 'pretty', 'really', 'well', 'much', 'many', 'little', 'few', 'thing', 'things',
    'people', 'person', 'time', 'way', 'day', 'year', 'know', 'think', 'want', 'need',
    'look', 'come', 'take', 'give', 'tell', 'work', 'call', 'try', 'ask', 'feel', 'seem',
    'leave', 'keep', 'let', 'begin', 'help', 'talk', 'turn', 'start', 'show', 'hear',
    'play', 'run', 'move', 'like', 'live', 'believe', 'hold', 'bring', 'happen', 'write',
    'sit', 'stand', 'lose', 'pay', 'meet', 'continue', 'set', 'learn', 'change', 'watch',
    'follow', 'stop', 'speak', 'read', 'open', 'walk', 'remember', 'love', 'wait', 'send',
    'stay', 'fall', 'cut', 'kind', 'sort', 'mean', 'sure', 'fine', 'good', 'bad', 'great',
    'nice', 'big', 'small', 'old', 'new', 'young', 'long', 'short', 'high', 'low', 'right',
    'wrong', 'true', 'false', 'hard', 'easy', 'different', 'same', 'first', 'last', 'next',
]);

type Candidate = {
    word: SentenceWordEntry;
    order: number;
    priority: number;
};

/**
 * 判断本地词典词条是否属于「非焦点常用词」：
 * - 牛津核心 / 柯林斯 3 星及以上 / 高中及以下核心标签 / BNC 或 COCA 前 4500 高频词；
 * - 若词典元数据缺失（bnc/frq/tags 全为空），同样保守视作常见口语词，避免把未标频次的虚词/简单词顶成焦点。
 */
const isWorthLearningFromDictionary = (entry: OpenAIDictionaryResult): boolean => {
    if (entry.oxford && entry.oxford > 0) {
        return false;
    }
    if ((entry.collins ?? 0) >= 3) {
        return false;
    }
    if ((entry.bnc ?? 0) > 0 && (entry.bnc ?? 0) <= COMMON_RANK_CUTOFF) {
        return false;
    }
    if ((entry.frq ?? 0) > 0 && (entry.frq ?? 0) <= COMMON_RANK_CUTOFF) {
        return false;
    }
    const tags = entry.tags ?? [];
    if (tags.some((tag) => COMMON_EXAM_TAGS.has(tag))) {
        return false;
    }
    const hasAdvancedTag = tags.some((tag) => ADVANCED_EXAM_TAGS.has(tag));
    const isRareRank = (entry.bnc ?? 0) > COMMON_RANK_CUTOFF || (entry.frq ?? 0) > COMMON_RANK_CUTOFF;
    return hasAdvancedTag || isRareRank;
};

const addPick = (target: Map<string, Candidate>, candidate: Candidate): void => {
    const existing = target.get(candidate.word.word);
    if (existing) {
        existing.word.surfaces.push(...candidate.word.surfaces);
        existing.priority = Math.max(existing.priority, candidate.priority);
        return;
    }
    target.set(candidate.word.word, candidate);
};

const toMeaning = (entry: OpenAIDictionaryResult): string => entry.definitions
    .slice(0, MEANING_MAX_PARTS)
    .map((definition) => (definition.partOfSpeech
        ? `${definition.partOfSpeech} ${definition.meaning}`
        : definition.meaning))
    .join('；');

/**
 * 个人记忆加权的本地句子生词选词服务：
 * - 句内所有英文词仍保留在 `details` 中供随手点击/划词查询；
 * - 重点列表（`picks`，最多 4 个）严格过滤虚词、连词、代词、助动词与前 4500 常见基础词；
 * - 到期复习词 (`due`)、活跃学习词 (`learning`) 与高频点击词 (`lookup`) 自动优先保留，已掌握词 (`known`/`mastery>=0.8`) 自动退场。
 */
@injectable()
export class SentenceVocabularyServiceImpl implements SentenceVocabularyService {
    constructor(
        @inject(TYPES.BuiltinDictionaryStore) private readonly builtinDictionaryStore: BuiltinDictionaryStore,
        @inject(TYPES.WordMatchService) private readonly wordMatchService: WordMatchService,
        @optional() @inject(TYPES.ReviewCardRepository) private readonly reviewCardRepository?: ReviewCardRepository,
        @optional() @inject(TYPES.WordEncounterRepository) private readonly encounterRepository?: WordEncounterRepository,
    ) {}

    public async pick(text: string): Promise<SentenceVocabularyVO> {
        const details: Record<string, SentenceWordEntry> = {};
        const picked = new Map<string, Candidate>();
        const focusWords = new Set<string>();
        const masteredWords = new Set<string>();
        const seen = new Set<string>();

        const now = Date.now();
        const [vocabularyIndex, recentSignal] = await Promise.all([
            this.buildVocabularyIndex(),
            this.loadRecentEncounterSignals(now),
        ]);

        const tokens = analyzeWords(text);
        const activeLookups: Array<{
            lemma: string;
            normalizedLemma: string;
            surface: string;
            pos: string;
            order: number;
            vocabularyEntry: Word | null;
            dictionaryEntry: OpenAIDictionaryResult | null;
        }> = [];

        tokens.forEach((token, order) => {
            if (token.type !== 'word') {
                return;
            }
            if (token.text.includes('\'') || token.text.includes('’')) {
                return;
            }
            const surface = token.text.toLowerCase();
            if (surface.length <= 2 || /^\d+$/.test(surface) || seen.has(surface)) {
                return;
            }
            if (order > 0 && /^[A-Z]/.test(token.text)) {
                return;
            }
            seen.add(surface);

            const dictionaryEntry = this.lookup(token.lemma, surface);
            const vocabularyEntry = this.matchVocabulary(vocabularyIndex, token.lemma, surface);
            if (!dictionaryEntry && !vocabularyEntry) {
                return;
            }
            const canonical = (vocabularyEntry?.word ?? dictionaryEntry?.word ?? surface).toLowerCase();
            const normalizedLemma = (token.lemma || canonical).toLowerCase().trim();
            activeLookups.push({
                lemma: canonical,
                normalizedLemma,
                surface,
                pos: token.pos,
                order,
                vocabularyEntry,
                dictionaryEntry,
            });
        });

        const dueSet = new Set<string>();
        if (this.reviewCardRepository) {
            await Promise.all(activeLookups.map(async (item) => {
                if (!item.vocabularyEntry) return;
                const card = await this.reviewCardRepository!.findByWord(item.lemma);
                if (card && Date.parse(card.due_at) <= now) {
                    dueSet.add(item.lemma);
                }
            }));
        }

        for (const item of activeLookups) {
            const { lemma, normalizedLemma, surface, pos, order, vocabularyEntry, dictionaryEntry } = item;
            const meaning = (vocabularyEntry?.translate ?? '').trim()
                || (dictionaryEntry ? toMeaning(dictionaryEntry) : '');
            if (!meaning) {
                continue;
            }

            const isUserManaged = Boolean(vocabularyEntry && vocabularyEntry.source !== 'default');
            const isMastered = Boolean(
                isUserManaged && vocabularyEntry && (
                    vocabularyEntry.status === 'known'
                    || vocabularyEntry.status === 'ignored'
                    || (vocabularyEntry.mastery ?? 0) >= MASTERY_FILTER_THRESHOLD
                ),
            );
            const isRecentlyIgnored = !isUserManaged && recentSignal.ignoredRecently.has(lemma);
            const isDue = dueSet.has(lemma);
            const isActiveLearning = Boolean(
                isUserManaged && vocabularyEntry && (
                    vocabularyEntry.status === 'learning' || vocabularyEntry.status === 'familiar'
                ),
            );
            const lookupCount = recentSignal.lookupCounts.get(lemma) ?? 0;

            let memoryTag: SentenceWordEntry['memoryTag'] = 'new';
            if (isDue) {
                memoryTag = 'due';
            } else if (isActiveLearning) {
                memoryTag = 'learning';
            } else if (lookupCount > 0) {
                memoryTag = 'lookup';
            }

            const word: SentenceWordEntry = {
                word: lemma,
                phonetic: dictionaryEntry?.phonetic ?? '',
                meaning,
                tags: dictionaryEntry?.tags ?? [],
                surfaces: [surface],
                memoryTag: isMastered ? undefined : memoryTag,
                mastery: vocabularyEntry?.mastery,
            };
            // 悬停/点击划词对整句任何单词开放（含虚词/熟词）
            details[surface] = word;

            if (isMastered || isRecentlyIgnored) {
                masteredWords.add(lemma);
                continue;
            }

            if (isDue) {
                focusWords.add(lemma);
                addPick(picked, { word, order, priority: 4 });
                continue;
            }
            if (isActiveLearning) {
                focusWords.add(lemma);
                addPick(picked, { word, order, priority: 3 });
                continue;
            }

            // 非个人生词本条目：先严格剔除虚词、连词、代词、助动词与基础常用黑名单词，
            // 避免仅仅因为播放悬停多看了一眼 `think` / `yourself` 就被顶进重点生词区
            if (!isContentLemma(normalizedLemma) || !isContentLemma(lemma)) {
                continue;
            }
            if (EXTRA_STOP_LEMMAS.has(normalizedLemma) || EXTRA_STOP_LEMMAS.has(lemma) || EXTRA_STOP_LEMMAS.has(surface)) {
                continue;
            }
            if (pos && !ALLOWED_CONTENT_POS.has(pos)) {
                continue;
            }
            if (lookupCount >= 2) {
                focusWords.add(lemma);
                addPick(picked, { word, order, priority: 2 });
                continue;
            }
            if (dictionaryEntry && isWorthLearningFromDictionary(dictionaryEntry)) {
                addPick(picked, { word, order, priority: 1 });
            }
        }

        const prioritized = [...picked.values()]
            .sort((a, b) => (b.priority - a.priority) || (a.order - b.order))
            .slice(0, MAX_PICKS)
            .sort((a, b) => a.order - b.order)
            .map((candidate) => candidate.word);

        const memoryHints: SentenceMemoryHints = {
            focusWords: [...focusWords].slice(0, 6),
            masteredWords: [...masteredWords].slice(0, 12),
        };

        return {
            picks: prioritized,
            details,
            memoryHints,
        };
    }

    private async loadRecentEncounterSignals(now: number): Promise<{
        lookupCounts: Map<string, number>;
        ignoredRecently: Set<string>;
    }> {
        const lookupCounts = new Map<string, number>();
        const ignoredRecently = new Set<string>();
        if (!this.encounterRepository) {
            return { lookupCounts, ignoredRecently };
        }
        try {
            const rows = await this.encounterRepository.listActionsSince(
                new Date(now - MEMORY_WINDOW_MS).toISOString(),
                ['open', 'lookup', 'ignore', 'save'],
            );
            const lastIgnoredAt = new Map<string, number>();
            const lastSavedAt = new Map<string, number>();
            for (const row of rows) {
                const lemma = row.lemma.toLowerCase();
                const at = Date.parse(row.createdAt) || 0;
                if (row.action === 'open' || row.action === 'lookup') {
                    lookupCounts.set(lemma, (lookupCounts.get(lemma) ?? 0) + 1);
                } else if (row.action === 'ignore') {
                    lastIgnoredAt.set(lemma, Math.max(lastIgnoredAt.get(lemma) ?? 0, at));
                } else if (row.action === 'save') {
                    lastSavedAt.set(lemma, Math.max(lastSavedAt.get(lemma) ?? 0, at));
                }
            }
            for (const [lemma, ignoredAt] of lastIgnoredAt.entries()) {
                const savedAt = lastSavedAt.get(lemma) ?? 0;
                if (ignoredAt > savedAt && now - ignoredAt <= IGNORE_WINDOW_MS) {
                    ignoredRecently.add(lemma);
                }
            }
        } catch {
            // 遭遇表未就绪时不阻塞选词
        }
        return { lookupCounts, ignoredRecently };
    }

    private async buildVocabularyIndex(): Promise<Map<string, Word>> {
        const words = await this.wordMatchService.getVocabularyWords();
        const index = new Map<string, Word>();
        words.forEach((entry) => {
            const key = entry.word?.trim().toLowerCase();
            if (key) {
                index.set(key, entry);
            }
        });
        return index;
    }

    private matchVocabulary(
        index: Map<string, Word>,
        lemma: string,
        surface: string,
    ): Word | null {
        const normalizedLemma = (lemma ?? '').toLowerCase().trim();
        return index.get(normalizedLemma) ?? index.get(surface) ?? null;
    }

    private lookup(lemma: string, surface: string): OpenAIDictionaryResult | null {
        const normalizedLemma = (lemma ?? '').toLowerCase().trim();
        if (normalizedLemma && normalizedLemma !== surface) {
            const byLemma = this.builtinDictionaryStore.lookup(normalizedLemma);
            if (byLemma) {
                return byLemma;
            }
        }
        return this.builtinDictionaryStore.lookup(surface);
    }
}
