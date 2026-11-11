import useSWR from 'swr';

import { cn } from '@/fronted/lib/utils';
import useSetting from '@/fronted/features/settings/settingsStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import type { ComprehensionBand } from '@/common/types/subtitleComprehension';
import type { Sentence } from '@/common/types/SentenceC';
import NormalLine from './NormalLine';

/**
 * 把理解度区间映射为中文行的视觉权重。
 *
 * 只改变透明度，不隐藏文本、不改变布局；hover 或键盘聚焦时恢复完整显示。
 *
 * @param band 理解度区间。
 * @returns 中文行的附加 class。
 */
export const adaptiveChineseOpacityClass = (band: ComprehensionBand | undefined): string => {
    if (band === 'high') {
        return 'opacity-[0.5]';
    }
    if (band === 'medium') {
        return 'opacity-[0.72]';
    }
    return 'opacity-100';
};

/**
 * 自适应中文行。
 *
 * 理解度高时降低中文视觉权重，引导先理解英文；用户悬停或聚焦字幕时
 * 立即恢复完整中文。关闭设置后不请求理解度，保持原来的固定展示。
 */
export default function AdaptiveChineseLine({
    sentence,
    text,
    order,
    source,
}: {
    sentence: Sentence;
    text: string;
    order: 'second' | 'third';
    source?: 'ai' | 'source';
}) {
    const adaptiveChinese = useSetting(
        (state) => state.values.get('player.adaptiveChinese'),
    ) === 'true';
    const { data } = useSWR(
        adaptiveChinese ? ['subtitle/comprehension', sentence.text] : null,
        () => playerApi.subtitleComprehension({
            text: sentence.text,
            fileHash: sentence.fileHash,
            sentenceIndex: sentence.index,
        }),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
            dedupingInterval: 5 * 60 * 1000,
        },
    );

    return (
        <div
            data-testid="adaptive-chinese-line"
            data-comprehension-band={data?.band ?? 'unknown'}
            className={cn(
                'w-full min-h-0 transition-opacity duration-300',
                'group-hover/subtitle:opacity-100 group-focus-within/subtitle:opacity-100',
                adaptiveChineseOpacityClass(data?.band),
            )}
        >
            <NormalLine text={text} order={order} source={source} />
        </div>
    );
}
