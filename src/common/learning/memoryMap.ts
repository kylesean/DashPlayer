import type {
    MemoryMapNeighborVO,
    MemoryMapTopicVO,
    MemoryMapWordVO,
} from '@/common/types/memoryMap';
import type { WordStatus } from '@/common/types/vocabulary';

/** 参与图谱分带的记忆阶段。 */
export const MEMORY_MAP_STATUSES: readonly WordStatus[] = [
    'learning',
    'familiar',
    'known',
    'ignored',
];

/**
 * 一条带句子定位的遭遇，用于计算共现。
 */
export interface CooccurrenceEncounter {
    lemma: string;
    /** 句子内容哈希；同一句的不同词共享该键。 */
    sentenceHash: string | null;
    /** 主题键，共现只在同一主题内计算。 */
    topicKey: string;
}

/**
 * 计算词与词在同一句里共现的次数。
 *
 * 只在同一句内统计：同一视频里从没同句出现过的两个词没有共现关系，
 * 按视频分组会把整集变成一个全连接图，边就没有信息量了。
 *
 * @param encounters 带句子定位的遭遇列表。
 * @param limitPerWord 每个词最多保留多少条边。
 * @returns 词 → 共现邻居（按权重降序）。
 */
export const buildCooccurrenceEdges = (
    encounters: readonly CooccurrenceEncounter[],
    limitPerWord = 3,
): Map<string, MemoryMapNeighborVO[]> => {
    // 先把同一句里的词聚成组，再在组内两两计数。
    const sentenceGroups = new Map<string, Set<string>>();
    for (const encounter of encounters) {
        if (!encounter.sentenceHash) {
            continue;
        }
        const key = `${encounter.topicKey}|${encounter.sentenceHash}`;
        const group = sentenceGroups.get(key) ?? new Set<string>();
        group.add(encounter.lemma.toLowerCase());
        sentenceGroups.set(key, group);
    }

    const counts = new Map<string, Map<string, number>>();
    const bump = (from: string, to: string) => {
        const neighbors = counts.get(from) ?? new Map<string, number>();
        neighbors.set(to, (neighbors.get(to) ?? 0) + 1);
        counts.set(from, neighbors);
    };
    for (const group of sentenceGroups.values()) {
        const lemmas = Array.from(group);
        if (lemmas.length < 2) {
            continue;
        }
        for (let left = 0; left < lemmas.length; left += 1) {
            for (let right = left + 1; right < lemmas.length; right += 1) {
                bump(lemmas[left], lemmas[right]);
                bump(lemmas[right], lemmas[left]);
            }
        }
    }

    const edges = new Map<string, MemoryMapNeighborVO[]>();
    for (const [lemma, neighbors] of counts) {
        edges.set(
            lemma,
            Array.from(neighbors.entries())
                .map(([word, weight]) => ({ word, weight }))
                .sort((left, right) => right.weight - left.weight || left.word.localeCompare(right.word))
                .slice(0, limitPerWord),
        );
    }
    return edges;
};

/**
 * 统计一个主题内各记忆阶段的词数。
 */
export const countByStatus = (words: MemoryMapWordVO[]): Record<WordStatus, number> => {
    const counts: Record<WordStatus, number> = {
        learning: 0,
        familiar: 0,
        known: 0,
        ignored: 0,
    };
    for (const word of words) {
        counts[word.status] += 1;
    }
    return counts;
};

/**
 * 按“先到期、再学习中、再熟悉、再已掌握”的优先级挑选主题内展示词。
 *
 * 最多 8 个，保持每个主题的卡片密度稳定；同优先级按最近遇见时间倒序。
 */
export const selectTopicWords = (words: MemoryMapWordVO[], limit = 8): MemoryMapWordVO[] => {
    const priority = (word: MemoryMapWordVO): number => {
        if (word.due) return 0;
        if (word.status === 'learning') return 1;
        if (word.status === 'familiar') return 2;
        if (word.status === 'known') return 3;
        return 4;
    };
    return words
        .slice()
        .sort((left, right) => {
            const diff = priority(left) - priority(right);
            if (diff !== 0) return diff;
            return right.lastSeenAt.localeCompare(left.lastSeenAt);
        })
        .slice(0, limit);
};

/**
 * 归一化主题标题：去掉扩展名，只保留可读的文件名。
 */
export const normalizeTopicLabel = (fileName: string | null | undefined): string | null => {
    const value = fileName?.trim();
    if (!value) {
        return null;
    }
    return value.replace(/\.[^.]+$/u, '').trim() || null;
};

/**
 * 构建一个主题簇的展示数据（含热力健康度与专题复习候选队列）。
 */
export const buildMemoryTopic = (args: {
    key: string;
    label: string | null;
    videoId?: string | null;
    videoPath?: string | null;
    words: MemoryMapWordVO[];
}): MemoryMapTopicVO => {
    const counts = countByStatus(args.words);
    const dueCount = args.words.filter((w) => w.due).length;
    const activeNonIgnored = args.words.filter((w) => w.status !== 'ignored');
    const stabilities = activeNonIgnored
        .map((w) => w.stability)
        .filter((val): val is number => typeof val === 'number' && val > 0);
    const avgStabilityDays = stabilities.length > 0
        ? Number((stabilities.reduce((a, b) => a + b, 0) / stabilities.length).toFixed(1))
        : null;

    // 计算主题记忆健康度（0–100）：综合当前提取率/掌握度，无数据时回退到阶段占比
    let healthScore = 100;
    if (activeNonIgnored.length > 0) {
        const sumScore = activeNonIgnored.reduce((acc, item) => {
            if (item.status === 'known') {
                return acc + (item.retrievability ?? 0.95);
            }
            if (typeof item.retrievability === 'number') {
                return acc + item.retrievability;
            }
            return acc + (item.status === 'familiar' ? 0.65 : 0.25);
        }, 0);
        healthScore = Math.round((sumScore / activeNonIgnored.length) * 100);
    }

    const reviewCandidates = selectTopicWords(
        activeNonIgnored.filter((w) => w.due || w.status === 'learning' || w.status === 'familiar'),
        25,
    );

    return {
        key: args.key,
        ...(args.videoId ? { videoId: args.videoId } : {}),
        ...(args.videoPath ? { videoPath: args.videoPath } : {}),
        label: args.label,
        wordCount: args.words.length,
        counts,
        words: selectTopicWords(args.words),
        dueCount,
        healthScore,
        avgStabilityDays,
        reviewWords: reviewCandidates.map((w) => w.word),
    };
};
