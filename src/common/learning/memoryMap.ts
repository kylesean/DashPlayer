import type {
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
 * 构建一个主题簇的展示数据。
 */
export const buildMemoryTopic = (args: {
    key: string;
    label: string | null;
    words: MemoryMapWordVO[];
}): MemoryMapTopicVO => ({
    key: args.key,
    label: args.label,
    wordCount: args.words.length,
    counts: countByStatus(args.words),
    words: selectTopicWords(args.words),
});
