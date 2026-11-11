import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { Sentence } from '@/common/types/SentenceC';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { useSourceChineseAvailability } from '../useSourceChineseAvailability';

/** 只关心 textZH 的句子桩；其余字段与本次判定无关。 */
const sentenceWithZh = (textZH?: string): Sentence => ({ textZH } as Sentence);

describe('useSourceChineseAvailability', () => {
    beforeEach(() => {
        act(() => {
            usePlayer.setState({ sentences: [] });
        });
    });

    it('英文字幕没有中文行时返回 false', () => {
        act(() => {
            usePlayer.setState({
                sentences: [sentenceWithZh(), sentenceWithZh('   ')],
            });
        });

        const { result } = renderHook(() => useSourceChineseAvailability());

        expect(result.current).toBe(false);
    });

    it('字幕文件带中文行时返回 true', () => {
        act(() => {
            usePlayer.setState({
                sentences: [sentenceWithZh(), sentenceWithZh('这是译文')],
            });
        });

        const { result } = renderHook(() => useSourceChineseAvailability());

        expect(result.current).toBe(true);
    });

    it('字幕加载完成后随句子列表更新', () => {
        const { result } = renderHook(() => useSourceChineseAvailability());
        expect(result.current).toBe(false);

        act(() => {
            usePlayer.setState({ sentences: [sentenceWithZh('这是译文')] });
        });

        expect(result.current).toBe(true);
    });
});
