import { type ReactElement, useMemo } from 'react';

import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayerState } from '@/fronted/features/player/playerState';
import FullscreenTranslatableLine from './FullscreenTranslatableLine';
import SubtitleLine from './SubtitleLine';
import StrUtil from '@/common/utils/str-util';
import useTranslation from '@/fronted/features/player/translationStore';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { cn } from '@/fronted/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';

const SubtitleStack = () => {
    const sentence = usePlayerState((state) => state.currentSentence);
    const srtTender = usePlayerState((state) => state.srtTender);
    const adjusted = useMemo(() => (sentence && srtTender ? (srtTender.adjusted(sentence) ?? false) : false), [sentence, srtTender]);

    const translationKey = sentence?.translationKey || '';
    const newTranslation = useTranslation((state) => state.translations.get(translationKey)) || '';
    /** 整句模式需要渲染块内其他行的译文：订阅整个译文表，任一译文到达都触发重渲染。 */
    const translations = useTranslation((state) => state.translations);

    const showCn = usePlayerUi((state) => state.showCn);
    const showSourceZh = usePlayerUi((state) => state.showSourceZh);

    /** 当前句所在的意群块；整句模式关闭时为 null，回退单行渲染。 */
    const block = usePlayerState((state) => state.getCurrentBlock());
    // getCurrentBlock 依赖的 sentenceBlockMode 在 playerStore 内经 getState 非响应式读取，
    // 这里必须订阅开关本身：否则暂停态下（无 timeupdate）切换整句模式不会重算，主字幕区永久陈旧
    usePlayerUi((state) => state.sentenceBlockMode);

    /** 单行渲染（整句模式关闭时的原始行为）：当前句的原文/机翻/自带中文三行。 */
    const renderSingleLine = (): ReactElement[] => {
        if (!sentence) {
            return [];
        }

        const lines: ReactElement[] = [];

        // 1. 原文字幕 (英文，支持隐藏占位)
        if (StrUtil.isNotBlank(sentence.text)) {
            lines.push(
                <FullscreenTranslatableLine
                    adjusted={adjusted}
                    clearAdjust={() => {
                        void playerActions.clearAdjust();
                    }}
                    key={`first-${sentence.key}`}
                    sentence={sentence}
                />
            );
        }

        // 2. 机翻字幕
        if (showCn && StrUtil.isNotBlank(newTranslation)) {
            lines.push(
                <SubtitleLine
                    key={`translation-${sentence.key}`}
                    text={newTranslation}
                    order="second"
                />
            );
        }

        // 3. 字幕源自带中文
        if (showSourceZh && StrUtil.isNotBlank(sentence.textZH)) {
            lines.push(
                <SubtitleLine
                    key={`sourceZh-${sentence.key}`}
                    text={sentence.textZH!}
                    order={lines.length === 1 ? 'second' : 'third'}
                />
            );
        }

        return lines;
    };

    /**
     * 渲染当前行附带的译文与源自带中文（整句模式用）。
     * 译文尚未流式返回时不占位，返回后自动补上。
     */
    const renderZhForSentence = (item: Sentence): ReactElement[] => {
        const zhLines: ReactElement[] = [];
        if (showCn) {
            const translation = translations.get(item.translationKey) || '';
            if (StrUtil.isNotBlank(translation)) {
                zhLines.push(
                    <SubtitleLine
                        key={`translation-${item.key}`}
                        text={translation}
                        order="second"
                    />
                );
            }
        }
        if (showSourceZh && StrUtil.isNotBlank(item.textZH)) {
            zhLines.push(
                <SubtitleLine
                    key={`sourceZh-${item.key}`}
                    text={item.textZH!}
                    order={zhLines.length === 0 ? 'second' : 'third'}
                />
            );
        }
        return zhLines;
    };

    /** 整句模式：渲染当前句所在意群块的全部行，块内当前行高亮、其余降透明度。 */
    const renderBlockLines = (): ReactElement[] => {
        if (!block) {
            return [];
        }
        const lines: ReactElement[] = [];
        for (const item of block.sentences) {
            const active = item.key === sentence?.key;
            if (StrUtil.isNotBlank(item.text)) {
                lines.push(
                    <div
                        key={`block-en-${item.key}`}
                        className={cn('w-full transition-opacity', !active && 'opacity-50')}
                    >
                        <FullscreenTranslatableLine
                            adjusted={active ? adjusted : false}
                            clearAdjust={active
                                ? () => {
                                    void playerActions.clearAdjust();
                                }
                                : () => {}}
                            sentence={item}
                        />
                    </div>
                );
            }
            lines.push(...renderZhForSentence(item));
        }
        return lines;
    };

    if (!sentence) {
        return <div className="w-full h-full" />;
    }

    return (
        <div
            key={`trans-sub:${sentence.key}`}
            className="flex flex-col w-full text-center text-textColor justify-center items-center gap-2 pointer-events-auto"
        >
            {block ? renderBlockLines() : renderSingleLine()}
        </div>
    );
};

export default SubtitleStack;
