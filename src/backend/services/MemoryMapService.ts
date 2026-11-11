import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type WatchHistoryRepository from '@/backend/services/repositories/WatchHistoryRepository';
import { WatchHistoryProjectType } from '@/backend/services/repositories/WatchHistoryRepository';
import {
    buildMemoryTopic,
    normalizeTopicLabel,
} from '@/common/learning/memoryMap';
import { isActiveWordStatus } from '@/common/types/vocabulary';
import type {
    MemoryMapParams,
    MemoryMapVO,
    MemoryMapWordVO,
} from '@/common/types/memoryMap';

const DEFAULT_TOPIC_LIMIT = 8;
const MAX_TOPIC_LIMIT = 20;

/**
 * 个人记忆图谱契约。
 */
export default interface MemoryMapService {
    /**
     * 汇总用户词表、遭遇上下文、复习卡与视频标题，生成主题 × 记忆阶段图谱。
     *
     * 只读本地数据，不调用模型、不访问网络。
     */
    getMap(params: MemoryMapParams): Promise<MemoryMapVO>;
}

/**
 * 本地记忆图谱实现。
 */
@injectable()
export class MemoryMapServiceImpl implements MemoryMapService {
    constructor(
        @inject(TYPES.LearningDataRepository) private readonly learningDataRepository: LearningDataRepository,
        @inject(TYPES.WatchHistoryRepository) private readonly watchHistoryRepository: WatchHistoryRepository,
    ) {}

    public async getMap(params: MemoryMapParams): Promise<MemoryMapVO> {
        const limit = Math.max(1, Math.min(MAX_TOPIC_LIMIT, Math.trunc(params.limit ?? DEFAULT_TOPIC_LIMIT)));
        const [words, encounters, cards, records] = await Promise.all([
            this.learningDataRepository.listUserWords(),
            this.learningDataRepository.listEncounters(),
            this.learningDataRepository.listReviewCards(),
            this.watchHistoryRepository.listByProjectType(WatchHistoryProjectType.FILE),
        ]);
        const now = Date.now();
        const cardMap = new Map(cards.map((card) => [card.word.toLowerCase(), card]));
        const titleMap = new Map(records.map((record) => [record.id, record.file_name]));
        const userWords = words.filter((word) => word.source !== 'default');
        const wordMap = new Map(userWords.map((word) => [word.word.toLowerCase(), word]));

        const byTopic = new Map<string, {
            label: string | null;
            words: Map<string, MemoryMapWordVO>;
            lastSeenAt: string;
        }>();
        const looseWords = new Map<string, MemoryMapWordVO>();

        for (const encounter of encounters) {
            const lemma = encounter.lemma.toLowerCase();
            const word = wordMap.get(lemma);
            if (!word || word.source === 'default') {
                continue;
            }
            const card = cardMap.get(lemma);
            const topicKey = encounter.video_id
                ? `video:${encounter.video_id}`
                : encounter.file_hash
                    ? `subtitle:${encounter.file_hash}`
                    : null;
            if (topicKey) {
                const topic = byTopic.get(topicKey) ?? {
                    label: encounter.video_id
                        ? normalizeTopicLabel(titleMap.get(encounter.video_id))
                        : null,
                    words: new Map<string, MemoryMapWordVO>(),
                    lastSeenAt: encounter.created_at,
                };
                topic.lastSeenAt = topic.lastSeenAt > encounter.created_at
                    ? topic.lastSeenAt
                    : encounter.created_at;
                topic.words.set(lemma, mergeWord(topic.words.get(lemma), word, card, encounter, now));
                byTopic.set(topicKey, topic);
                continue;
            }

            looseWords.set(lemma, mergeWord(looseWords.get(lemma), word, card, encounter, now));
        }

        // 没有遭遇事件、但已手动标记的词也要出现在图谱里，否则用户会误以为数据丢失。
        for (const word of userWords) {
            if (word.source === 'default' || byTopicHasWord(byTopic, word.word) || looseWords.has(word.word)) {
                continue;
            }
            const card = cardMap.get(word.word.toLowerCase());
            looseWords.set(word.word, {
                word: word.word,
                translate: word.translate,
                status: word.status,
                mastery: word.mastery,
                encounters: 0,
                due: Boolean(card && isActiveWordStatus(word.status) && Date.parse(card.due_at) <= now),
                lastSeenAt: word.last_seen_at ?? word.updated_at,
                context: null,
            });
        }

        const topics = Array.from(byTopic.entries())
            .map(([key, topic]) => ({
                topic,
                value: buildMemoryTopic({
                    key,
                    label: topic.label,
                    words: Array.from(topic.words.values()),
                }),
            }))
            .sort((left, right) => right.topic.lastSeenAt.localeCompare(left.topic.lastSeenAt))
            .slice(0, limit)
            .map((entry) => entry.value);

        const loose = looseWords.size > 0
            ? buildMemoryTopic({
                key: 'loose',
                label: null,
                words: Array.from(looseWords.values()),
            })
            : null;

        return {
            generatedAt: new Date().toISOString(),
            totalWords: userWords.length,
            activeWords: userWords.filter((word) => isActiveWordStatus(word.status)).length,
            topics,
            looseWords: loose,
        };
    }
}

/**
 * 合并同一词在同一主题下的多次遭遇。
 */
const mergeWord = (
    existing: MemoryMapWordVO | undefined,
    word: {
        word: string;
        translate: string | null;
        status: MemoryMapWordVO['status'];
        mastery: number;
    },
    card: { due_at: string } | undefined,
    encounter: { created_at: string; context: string | null },
    now: number,
): MemoryMapWordVO => {
    const next: MemoryMapWordVO = existing ?? {
        word: word.word,
        translate: word.translate,
        status: word.status,
        mastery: word.mastery,
        encounters: 0,
        due: Boolean(card && isActiveWordStatus(word.status) && Date.parse(card.due_at) <= now),
        lastSeenAt: encounter.created_at,
        context: encounter.context,
    };
    next.encounters += 1;
    if (encounter.created_at >= next.lastSeenAt) {
        next.lastSeenAt = encounter.created_at;
        next.context = encounter.context ?? next.context;
    }
    return next;
};

/**
 * 判断某个词是否已出现在任意主题里。
 */
const byTopicHasWord = (
    byTopic: Map<string, { words: Map<string, MemoryMapWordVO> }>,
    word: string,
): boolean => {
    const lemma = word.toLowerCase();
    for (const topic of byTopic.values()) {
        if (topic.words.has(lemma)) {
            return true;
        }
    }
    return false;
};
