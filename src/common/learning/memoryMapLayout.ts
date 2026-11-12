import type { MemoryMapTopicVO, MemoryMapWordVO } from '@/common/types/memoryMap';
import type { WordStatus } from '@/common/types/vocabulary';

/** 图谱布局中的一个节点。 */
export interface MemoryMapNodeVO {
    /** 节点唯一键：主题键 + 词，避免跨主题同形词互相覆盖。 */
    id: string;
    word: string;
    topicKey: string;
    topicLabel: string;
    status: WordStatus;
    due: boolean;
    /** 归一化坐标 0–1，渲染层只负责乘以画布尺寸。 */
    x: number;
    y: number;
    /** 相对半径 0–1：共现越多、遇见越多的词越大。 */
    radius: number;
}

/** 图谱布局中的一条边。 */
export interface MemoryMapEdgeVO {
    from: string;
    to: string;
    weight: number;
}

/** 一次图谱布局的结果。 */
export interface MemoryMapLayoutVO {
    nodes: MemoryMapNodeVO[];
    edges: MemoryMapEdgeVO[];
}

/** 单个主题最多画多少个词；再多就只是噪声。 */
const MAX_NODES_PER_TOPIC = 6;
/** 主题环的半径，留出中心与标签空间。 */
const TOPIC_RING_RADIUS = 0.32;
/** 主题内词的散开半径。 */
const WORD_RING_RADIUS = 0.11;
/** 边的最小共现次数：只出现一次的同句共现证据太弱。 */
const MIN_EDGE_WEIGHT = 2;

/**
 * 计算记忆图谱的确定性布局。
 *
 * 不做力导向模拟：力导向每次渲染的坐标都会漂移，用户刚认出的位置下一帧就变了。
 * 这里用「主题均匀分布在外环、主题内词再均匀分布」的固定布局，同一份数据
 * 永远得到同一张图，读图成本才稳定。
 *
 * @param topics 主题簇。
 * @param looseWords 无视频上下文的词簇；为 null 时不参与。
 * @returns 节点与边。
 */
export const buildMemoryMapLayout = (
    topics: MemoryMapTopicVO[],
    looseWords: MemoryMapTopicVO | null,
): MemoryMapLayoutVO => {
    const groups: Array<{ key: string; label: string; words: MemoryMapWordVO[] }> = topics
        .map((topic) => ({
            key: topic.key,
            label: topic.label ?? topic.key,
            words: topic.words.slice(0, MAX_NODES_PER_TOPIC),
        }))
        .filter((group) => group.words.length > 0);
    if (looseWords && looseWords.words.length > 0) {
        groups.push({
            key: looseWords.key,
            label: looseWords.label ?? looseWords.key,
            words: looseWords.words.slice(0, MAX_NODES_PER_TOPIC),
        });
    }

    const nodes: MemoryMapNodeVO[] = [];
    const maxEncounters = groups.reduce(
        (max, group) => group.words.reduce((inner, word) => Math.max(inner, word.encounters), max),
        1,
    );

    groups.forEach((group, groupIndex) => {
        // 只有一个主题时放在正中，避免所有词挤在一个小环上。
        const groupAngle = groups.length === 1
            ? 0
            : (Math.PI * 2 * groupIndex) / groups.length - Math.PI / 2;
        const centerX = groups.length === 1 ? 0.5 : 0.5 + Math.cos(groupAngle) * TOPIC_RING_RADIUS;
        const centerY = groups.length === 1 ? 0.5 : 0.5 + Math.sin(groupAngle) * TOPIC_RING_RADIUS;
        const wordCount = group.words.length;

        group.words.forEach((word, wordIndex) => {
            const wordAngle = (Math.PI * 2 * wordIndex) / wordCount - Math.PI / 2;
            // 单主题多词时扩大散开半径，让词之间不重叠。
            const spread = groups.length === 1 && wordCount > 1
                ? Math.min(0.3, WORD_RING_RADIUS + wordCount * 0.02)
                : WORD_RING_RADIUS;
            nodes.push({
                id: `${group.key}::${word.word}`,
                word: word.word,
                topicKey: group.key,
                topicLabel: group.label,
                status: word.status,
                due: word.due,
                x: clamp01(centerX + Math.cos(wordAngle) * spread),
                y: clamp01(centerY + Math.sin(wordAngle) * spread),
                radius: 0.35 + 0.65 * (word.encounters / Math.max(1, maxEncounters)),
            });
        });
    });

    return { nodes, edges: buildEdges(nodes, groups) };
};

/**
 * 由节点的共现邻居生成边。
 *
 * 只在同一主题内连边：跨主题的共现说明不了「一起复习」这件事，
 * 而且会让图变成一团无法阅读的网。
 */
const buildEdges = (
    nodes: MemoryMapNodeVO[],
    groups: Array<{ key: string; words: MemoryMapWordVO[] }>,
): MemoryMapEdgeVO[] => {
    const nodeByWord = new Map<string, MemoryMapNodeVO>();
    for (const node of nodes) {
        nodeByWord.set(`${node.topicKey}::${node.word}`, node);
    }

    const edges: MemoryMapEdgeVO[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
        for (const word of group.words) {
            const from = nodeByWord.get(`${group.key}::${word.word}`);
            if (!from) {
                continue;
            }
            for (const neighbor of word.neighbors ?? []) {
                if (neighbor.weight < MIN_EDGE_WEIGHT) {
                    continue;
                }
                const to = nodeByWord.get(`${group.key}::${neighbor.word}`);
                if (!to) {
                    continue;
                }
                // 共现是双向的：无向边只画一次，避免同一对词两条线重叠。
                const edgeKey = [from.id, to.id].sort().join('|');
                if (seen.has(edgeKey)) {
                    continue;
                }
                seen.add(edgeKey);
                edges.push({ from: from.id, to: to.id, weight: neighbor.weight });
            }
        }
    }
    return edges;
};

/**
 * 把坐标夹在 0–1，避免边缘节点被裁掉。
 */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
