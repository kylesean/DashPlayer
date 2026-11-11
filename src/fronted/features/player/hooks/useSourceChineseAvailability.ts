import { useMemo } from 'react';

import { usePlayerState } from '@/fronted/features/player/playerState';

/**
 * 当前字幕文件是否包含可直接展示的中文行。
 *
 * “源字幕中文”只对字幕文件自带的中文行生效；没有中文行时，界面不应把
 * 它当成一条可用轨道，否则会出现“勾着双语却只有英文”的假状态。
 *
 * @returns 当前字幕是否至少有一行 `textZH`。
 */
export function useSourceChineseAvailability(): boolean {
    const sentences = usePlayerState((state) => state.sentences);
    return useMemo(
        () => sentences.some((sentence) => Boolean(sentence.textZH?.trim())),
        [sentences],
    );
}
