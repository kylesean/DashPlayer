import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MemoryMapVO } from '@/common/types/memoryMap';
import type { WordStatus } from '@/common/types/vocabulary';
import {
    buildMemoryMapLayout,
    type MemoryMapNodeVO,
} from '@/common/learning/memoryMapLayout';
import { cn } from '@/fronted/lib/utils';

/** 画布逻辑尺寸；实际显示宽度由 CSS 决定。 */
const VIEW_BOX = 320;
/** 节点半径（逻辑单位）。 */
const NODE_RADIUS = 9;

/**
 * 记忆图谱的可视化布局。
 *
 * 用确定性径向布局而不是力导向：力导向每次渲染都会重新漂移，用户刚认出的
 * 位置下一帧就变了。这里主题固定分布在外环、主题内词固定分布在内圈，
 * 同一份数据永远画出同一张图。
 */
export default function MemoryMapGraph({
    data,
    onSelectWord,
}: {
    data: MemoryMapVO;
    onSelectWord: (word: string) => void;
}) {
    const { t } = useTranslation('memoryMap');
    const layout = useMemo(
        () => buildMemoryMapLayout(data.topics, data.looseWords),
        [data.topics, data.looseWords],
    );
    const nodeById = useMemo(
        () => new Map(layout.nodes.map((node) => [node.id, node])),
        [layout.nodes],
    );

    if (layout.nodes.length === 0) {
        return null;
    }

    return (
        <div className="mt-3 rounded-xl border border-border/50 bg-background/40 p-2">
            <svg
                viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`}
                role="img"
                aria-label={t('graphLabel')}
                className="mx-auto block h-auto w-full max-w-[420px]"
            >
                {layout.edges.map((edge) => {
                    const from = nodeById.get(edge.from);
                    const to = nodeById.get(edge.to);
                    if (!from || !to) return null;
                    return (
                        <line
                            key={`${edge.from}|${edge.to}`}
                            x1={from.x * VIEW_BOX}
                            y1={from.y * VIEW_BOX}
                            x2={to.x * VIEW_BOX}
                            y2={to.y * VIEW_BOX}
                            stroke="currentColor"
                            strokeWidth={0.6 + Math.min(1.8, edge.weight * 0.35)}
                            className="text-border"
                            opacity={0.7}
                        />
                    );
                })}
                {layout.nodes.map((node) => (
                    <GraphNode
                        key={node.id}
                        node={node}
                        onSelectWord={onSelectWord}
                    />
                ))}
            </svg>
            <p className="mt-1 text-center text-metadata text-muted-foreground/70">
                {t('graphHint')}
            </p>
        </div>
    );
}

/**
 * 单个词节点：圆点 + 词面。
 */
function GraphNode({
    node,
    onSelectWord,
}: {
    node: MemoryMapNodeVO;
    onSelectWord: (word: string) => void;
}) {
    const cx = node.x * VIEW_BOX;
    const cy = node.y * VIEW_BOX;
    const radius = NODE_RADIUS * (0.75 + node.radius * 0.45);
    // 词面放在点的外侧，避免盖住连线与相邻节点。
    const labelX = cx + (node.x < 0.5 ? -1 : 1) * (radius + 2);
    const anchor = node.x < 0.5 ? 'end' : 'start';

    return (
        <g
            role="button"
            tabIndex={0}
            aria-label={node.word}
            onClick={() => onSelectWord(node.word)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectWord(node.word);
                }
            }}
            className="cursor-pointer focus:outline-none"
        >
            <title>{`${node.word} · ${node.topicLabel}`}</title>
            <circle
                cx={cx}
                cy={cy}
                r={radius}
                className={cn(statusClassName(node.status, node.due))}
            />
            <text
                x={labelX}
                y={cy + 3}
                textAnchor={anchor}
                className="fill-current text-[9px] text-foreground"
            >
                {node.word}
            </text>
        </g>
    );
}

/**
 * 节点颜色只表达记忆阶段；到期用描边而不是换色，避免两种语义抢同一通道。
 */
const statusClassName = (status: WordStatus, due: boolean): string => {
    const base = status === 'known'
        ? 'fill-success/60 stroke-success'
        : status === 'familiar'
            ? 'fill-accent/45 stroke-accent/70'
            : status === 'ignored'
                ? 'fill-muted-foreground/25 stroke-muted-foreground/40'
                : 'fill-accent stroke-accent';
    return due ? `${base} [stroke-width:2]` : `${base} [stroke-width:1]`;
};
