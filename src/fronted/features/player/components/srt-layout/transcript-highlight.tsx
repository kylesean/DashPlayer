import React from 'react';
import { cn } from '@/fronted/lib/utils';

const QUERY_RANGES_CACHE = new Map<string, Array<{ start: number; end: number }>>();
const MAX_CACHE_SIZE = 128;

function getQueryRanges(fullText: string, query: string): Array<{ start: number; end: number }> {
    const q = query.trim().toLowerCase();
    if (!q || !fullText) return [];

    const key = `${fullText}::${q}`;
    const cached = QUERY_RANGES_CACHE.get(key);
    if (cached !== undefined) return cached;

    const ranges: Array<{ start: number; end: number }> = [];
    const lowerFull = fullText.toLowerCase();
    if (lowerFull.includes(q)) {
        let pos = lowerFull.indexOf(q);
        while (pos !== -1) {
            ranges.push({ start: pos, end: pos + q.length });
            pos = lowerFull.indexOf(q, pos + q.length);
        }
    }
    if (QUERY_RANGES_CACHE.size >= MAX_CACHE_SIZE) {
        const firstKey = QUERY_RANGES_CACHE.keys().next().value;
        if (firstKey) QUERY_RANGES_CACHE.delete(firstKey);
    }
    QUERY_RANGES_CACHE.set(key, ranges);
    return ranges;
}

/**
 * 文本切片搜索高亮工具函数。
 *
 * 可以在不打散原始分词/Word组件边界的前提下，精准高亮跨词、词内或标点区间的搜索结果。
 *
 * @param fullText 完整行或整句文本。
 * @param slice 当前待渲染的子文本切片（单个单词、标点或间隙）。
 * @param sliceStart 当前切片在 fullText 中的起始字符偏移。
 * @param query 用户输入的搜索字符串。
 * @param isActive 是否为当前正在穿梭浏览的激活命中项。
 * @returns 包含高亮 mark 的 ReactNode，无命中时直接返回原始切片字符串。
 */
export function highlightSlice(
    fullText: string,
    slice: string,
    sliceStart: number,
    query: string,
    isActive?: boolean
): React.ReactNode {
    if (!query || !query.trim() || !slice || !fullText) {
        return slice;
    }

    const ranges = getQueryRanges(fullText, query);
    if (ranges.length === 0) {
        return slice;
    }

    const safeSliceStart = Math.max(0, Math.min(sliceStart, fullText.length));
    const safeSliceEnd = Math.max(safeSliceStart, Math.min(sliceStart + slice.length, fullText.length));

    // 过滤与当前切片 [safeSliceStart, safeSliceEnd) 有重叠的命中区间
    const overlapping = ranges.filter((r) => r.end > safeSliceStart && r.start < safeSliceEnd);
    if (overlapping.length === 0) {
        return slice;
    }

    type Segment = { text: string; isMatch: boolean };
    const segments: Segment[] = [];
    let currentCursor = safeSliceStart;

    for (const r of overlapping) {
        const matchStartInSlice = Math.max(r.start, safeSliceStart);
        const matchEndInSlice = Math.min(r.end, safeSliceEnd);

        if (matchStartInSlice > currentCursor) {
            segments.push({
                text: fullText.slice(currentCursor, matchStartInSlice),
                isMatch: false,
            });
        }
        const actualMatchStart = Math.max(matchStartInSlice, currentCursor);
        if (matchEndInSlice > actualMatchStart) {
            segments.push({
                text: fullText.slice(actualMatchStart, matchEndInSlice),
                isMatch: true,
            });
            currentCursor = matchEndInSlice;
        }
    }

    if (currentCursor < safeSliceEnd) {
        segments.push({
            text: fullText.slice(currentCursor, safeSliceEnd),
            isMatch: false,
        });
    }

    if (segments.length === 0) {
        return slice;
    }

    return segments.map((seg, i) =>
        seg.isMatch ? (
            <mark
                key={i}
                className={cn(
                    'rounded-[2px] px-0.5 font-medium transition-colors',
                    isActive
                        ? 'bg-amber-500 text-black dark:text-zinc-950 font-semibold shadow-xs'
                        : 'bg-amber-400/35 text-amber-950 dark:text-amber-200'
                )}
            >
                {seg.text}
            </mark>
        ) : (
            seg.text
        )
    );
}
