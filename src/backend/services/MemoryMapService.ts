import path from 'node:path';
import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type WatchHistoryRepository from '@/backend/services/repositories/WatchHistoryRepository';
import { WatchHistoryProjectType } from '@/backend/services/repositories/WatchHistoryRepository';
import {
    buildCooccurrenceEdges,
    buildMemoryTopic,
    normalizeTopicLabel,
} from '@/common/learning/memoryMap';
import { extractTopicKeywords } from '@/common/learning/topicKeywords';
import {
    buildForgettingCurvePoints,
    estimateRetrievability,
    LEECH_LAPSES,
} from '@/common/learning/reviewScheduler';
import { isActiveWordStatus } from '@/common/types/vocabulary';
import type {
    MemoryForecastDayVO,
    MemoryHealthOverviewVO,
    MemoryMapParams,
    MemoryMapVO,
    MemoryMapWordVO,
} from '@/common/types/memoryMap';

const DEFAULT_TOPIC_LIMIT = 8;
const MAX_TOPIC_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_HORIZON_DAYS = 14;

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
/** 图谱底表快照的 TTL：遭遇事件上万后全量加载是常驻开销，短缓存摊平峰值。 */
const SNAPSHOT_TTL_MS = 60_000;

/** 图谱底表快照。 */
interface MemoryMapSnapshot {
    at: number;
    words: Awaited<ReturnType<LearningDataRepository['listUserWords']>>;
    encounters: Awaited<ReturnType<LearningDataRepository['listEncounters']>>;
    cards: Awaited<ReturnType<LearningDataRepository['listReviewCards']>>;
    records: Awaited<ReturnType<WatchHistoryRepository['listByProjectType']>>;
}

@injectable()
export class MemoryMapServiceImpl implements MemoryMapService {
    private snapshot: MemoryMapSnapshot | null = null;

    constructor(
        @inject(TYPES.LearningDataRepository) private readonly learningDataRepository: LearningDataRepository,
        @inject(TYPES.WatchHistoryRepository) private readonly watchHistoryRepository: WatchHistoryRepository,
    ) {}

    /**
     * 加载图谱底表（词表 + 全部遭遇事件 + 复习卡 + 观看记录），60 秒内复用。
     *
     * 代价换取：刚写入的遭遇事件最多延迟 1 分钟出现在图谱里，对概览视图可接受；
     * 词表导入/恢复走的是 LearningDataService 的缓存失效链，与本快照无关，
     * 短 TTL 会自然覆盖。
     */
    private async loadSnapshot(): Promise<MemoryMapSnapshot> {
        if (this.snapshot && Date.now() - this.snapshot.at < SNAPSHOT_TTL_MS) {
            return this.snapshot;
        }
        const [words, encounters, cards, fileRecords, dirRecords] = await Promise.all([
            this.learningDataRepository.listUserWords(),
            this.learningDataRepository.listEncounters(),
            this.learningDataRepository.listReviewCards(),
            this.watchHistoryRepository.listByProjectType(WatchHistoryProjectType.FILE),
            this.watchHistoryRepository.listByProjectType(WatchHistoryProjectType.DIRECTORY),
        ]);
        const recordById = new Map<string, (typeof fileRecords)[number]>();
        for (const rec of [...fileRecords, ...dirRecords]) {
            if (!recordById.has(rec.id)) {
                recordById.set(rec.id, rec);
            }
        }
        this.snapshot = { at: Date.now(), words, encounters, cards, records: Array.from(recordById.values()) };
        return this.snapshot;
    }

    public async getMap(params: MemoryMapParams): Promise<MemoryMapVO> {
        const limit = Math.max(1, Math.min(MAX_TOPIC_LIMIT, Math.trunc(params.limit ?? DEFAULT_TOPIC_LIMIT)));
        const { words, encounters, cards, records } = await this.loadSnapshot();
        const nowDate = new Date();
        const now = nowDate.getTime();
        const cardMap = new Map(cards.map((card) => [card.word.toLowerCase(), card]));
        const recordMap = new Map(records.map((record) => [record.id, record]));
        const userWords = words.filter((word) => word.source !== 'default');
        const wordMap = new Map(userWords.map((word) => [word.word.toLowerCase(), word]));

        const byTopic = new Map<string, {
            label: string | null;
            videoId: string | null;
            videoPath: string | null;
            words: Map<string, MemoryMapWordVO>;
            lastSeenAt: string;
            /** 该主题下出现过的真实句子，用于推导关键词。 */
            contexts: string[];
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
                const matchedRecord = encounter.video_id ? recordMap.get(encounter.video_id) : undefined;
                const resolvedPath =
                    matchedRecord?.base_path && matchedRecord?.file_name
                        ? path.join(matchedRecord.base_path, matchedRecord.file_name)
                        : null;
                const topic = byTopic.get(topicKey) ?? {
                    label: encounter.video_id
                        ? normalizeTopicLabel(matchedRecord?.file_name)
                        : null,
                    videoId: encounter.video_id ?? null,
                    videoPath: resolvedPath,
                    words: new Map<string, MemoryMapWordVO>(),
                    lastSeenAt: encounter.created_at,
                    contexts: [],
                };
                if (encounter.context) {
                    topic.contexts.push(encounter.context);
                }
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
            const retrievability = card
                ? estimateRetrievability(
                    {
                        reps: card.reps,
                        stability: card.stability,
                        lastReviewAt: card.last_review_at,
                    },
                    new Date(now),
                )
                : null;
            looseWords.set(word.word, {
                word: word.word,
                translate: word.translate,
                status: word.status,
                mastery: word.mastery,
                encounters: 0,
                due: Boolean(card && isActiveWordStatus(word.status) && Date.parse(card.due_at) <= now),
                lastSeenAt: word.last_seen_at ?? word.updated_at,
                context: null,
                stability: card?.stability ?? 0,
                lapses: card?.lapses ?? 0,
                dueAt: card?.due_at ?? null,
                retrievability,
            });
        }

        // 关键词只对最终展示的主题计算：被 limit 截掉的簇不参与 IDF，
        // 否则用户没看到的主题会影响可见主题的关键词排序。
        const visibleTopics = Array.from(byTopic.entries())
            .sort((left, right) => right[1].lastSeenAt.localeCompare(left[1].lastSeenAt))
            .slice(0, limit);
        const keywordMap = extractTopicKeywords(
            visibleTopics.map(([key, topic]) => ({ key, texts: topic.contexts })),
        );
        const topics = visibleTopics.map(([key, topic]) => {
            const value = buildMemoryTopic({
                key,
                label: topic.label,
                videoId: topic.videoId,
                videoPath: topic.videoPath,
                words: Array.from(topic.words.values()),
            });
            const keywords = keywordMap.get(key);
            if (keywords && keywords.length > 0) {
                value.keywords = keywords;
            }
            return value;
        });

        const loose = looseWords.size > 0
            ? buildMemoryTopic({
                key: 'loose',
                label: null,
                words: Array.from(looseWords.values()),
            })
            : null;

        // 共现边按主题计算后回填到每个词上：同一句里一起出现过的词，
        // 才是真正可以放在一起复习的一组。
        const cooccurrenceEncounters = encounters.flatMap((encounter) => {
            const lemma = encounter.lemma.toLowerCase();
            if (!wordMap.has(lemma)) {
                return [];
            }
            const topicKey = encounter.video_id
                ? `video:${encounter.video_id}`
                : encounter.file_hash
                    ? `subtitle:${encounter.file_hash}`
                    : null;
            if (!topicKey) {
                return [];
            }
            return [{
                lemma,
                sentenceHash: encounter.sentence_hash,
                topicKey,
            }];
        });
        const edges = buildCooccurrenceEdges(cooccurrenceEncounters);
        for (const topic of topics) {
            for (const word of topic.words) {
                const neighbors = edges.get(word.word.toLowerCase());
                if (neighbors && neighbors.length > 0) {
                    word.neighbors = neighbors;
                }
            }
        }

        const memoryHealth = buildMemoryHealthOverview({
            userWords,
            cardMap,
            nowDate,
        });

        return {
            generatedAt: new Date().toISOString(),
            totalWords: userWords.length,
            activeWords: userWords.filter((word) => isActiveWordStatus(word.status)).length,
            topics,
            looseWords: loose,
            memoryHealth,
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
    card: {
        due_at: string;
        reps: number;
        lapses: number;
        stability: number;
        last_review_at: string | null;
    } | undefined,
    encounter: { created_at: string; context: string | null },
    now: number,
): MemoryMapWordVO => {
    const retrievability = card
        ? estimateRetrievability(
            {
                reps: card.reps,
                stability: card.stability,
                lastReviewAt: card.last_review_at,
            },
            new Date(now),
        )
        : null;
    const next: MemoryMapWordVO = existing ?? {
        word: word.word,
        translate: word.translate,
        status: word.status,
        mastery: word.mastery,
        encounters: 0,
        due: Boolean(card && isActiveWordStatus(word.status) && Date.parse(card.due_at) <= now),
        lastSeenAt: encounter.created_at,
        context: encounter.context,
        stability: card?.stability ?? 0,
        lapses: card?.lapses ?? 0,
        dueAt: card?.due_at ?? null,
        retrievability,
    };
    next.encounters += 1;
    if (encounter.created_at >= next.lastSeenAt) {
        next.lastSeenAt = encounter.created_at;
        next.context = encounter.context ?? next.context;
    }
    return next;
};

function startOfLocalDayMs(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function buildMemoryHealthOverview(args: {
    userWords: Array<{ word: string; status: MemoryMapWordVO['status'] }>;
    cardMap: Map<string, {
        due_at: string;
        reps: number;
        lapses: number;
        stability: number;
        last_review_at: string | null;
    }>;
    nowDate: Date;
}): MemoryHealthOverviewVO {
    const nowMs = args.nowDate.getTime();
    const todayStartMs = startOfLocalDayMs(args.nowDate);
    const buckets = {
        danger: 0,
        fading: 0,
        stable: 0,
        unreviewed: 0,
    };
    let leechCount = 0;
    const stabilities: number[] = [];

    const forecastCounts = new Array<number>(FORECAST_HORIZON_DAYS).fill(0);

    for (const word of args.userWords) {
        if (word.status === 'ignored') {
            continue;
        }
        const card = args.cardMap.get(word.word.toLowerCase());
        if (!card) {
            if (isActiveWordStatus(word.status)) {
                buckets.unreviewed += 1;
            } else {
                buckets.stable += 1;
            }
            continue;
        }

        if (card.lapses >= LEECH_LAPSES) {
            leechCount += 1;
        }
        if (card.stability > 0 && card.reps > 0) {
            stabilities.push(card.stability);
        }

        const dueMs = Date.parse(card.due_at);
        const isDue = Number.isFinite(dueMs) && dueMs <= nowMs && isActiveWordStatus(word.status);
        const retrievability = estimateRetrievability(
            {
                reps: card.reps,
                stability: card.stability,
                lastReviewAt: card.last_review_at,
            },
            args.nowDate,
        );

        if (retrievability === null) {
            if (isDue) {
                buckets.danger += 1;
            } else {
                buckets.unreviewed += 1;
            }
        } else if (isDue || retrievability < 0.6) {
            buckets.danger += 1;
        } else if (retrievability < 0.85) {
            buckets.fading += 1;
        } else {
            buckets.stable += 1;
        }

        if (isActiveWordStatus(word.status) && Number.isFinite(dueMs)) {
            const diffDays = Math.floor((dueMs - todayStartMs) / DAY_MS);
            if (diffDays <= 0) {
                forecastCounts[0] += 1;
            } else if (diffDays < FORECAST_HORIZON_DAYS) {
                forecastCounts[diffDays] += 1;
            }
        }
    }

    const avgStabilityDays = stabilities.length > 0
        ? Number((stabilities.reduce((a, b) => a + b, 0) / stabilities.length).toFixed(1))
        : null;

    const forecastDays: MemoryForecastDayVO[] = forecastCounts.map((dueCount, dayOffset) => {
        if (dayOffset === 0) {
            return { dayOffset, dateLabel: 'today', dueCount };
        }
        const date = new Date(todayStartMs + dayOffset * DAY_MS);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return { dayOffset, dateLabel: `${mm}-${dd}`, dueCount };
    });

    return {
        retrievabilityBuckets: buckets,
        leechCount,
        avgStabilityDays,
        forecastDays,
        decayCurve: buildForgettingCurvePoints(avgStabilityDays ?? 3),
    };
}

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
