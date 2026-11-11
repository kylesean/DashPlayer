import React, { useState } from 'react';
import useSetting from '@/fronted/features/settings/settingsStore';
import { cn } from '@/fronted/lib/utils';
import { FONT_SIZE } from '@/fronted/styles/style';
import type { Sentence } from '@/common/types/SentenceC';
import { useTransLineTheme } from './translatable-theme';
import { renderSentenceTokens } from '@/fronted/features/player/components/srt-layout/sentence-token-renderer';

interface TranslatableSubtitleLineCoreParam {
    sentence: Sentence;
    show: boolean;
    hoverDark?: boolean;
    className?: string; // 新增：root class
    wordClassNames?: {
        word?: string;
        hover?: string;
        vocab?: string;
    }; // 新增：Word 的 classNames
}

/**
 * 主/全屏字幕的原文行：只负责容器样式与字号，分词与单词交互统一交给 renderSentenceTokens。
 * @param props 字幕句子和显示交互配置。
 */
const TranslatableLine = ({
    sentence,
    show,
    hoverDark,
    className,
    wordClassNames,
}: TranslatableSubtitleLineCoreParam) => {
    const theme = useTransLineTheme();

    const text = sentence.text;
    const fontSize = useSetting((state) =>
        state.values.get('appearance.fontSize'),
    );
    const [popELe, setPopEle] = useState<string | null>(null);

    /**
     * 记录当前应显示释义弹层的词项。
     */
    const handleRequestPop = (k: string) => {
        if (popELe !== k) {
            setPopEle(k);
        }
    };

    /**
     * 禁止双击默认选词，同时保留单击和拖拽选区。
     */
    const handleLineMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.detail > 1) {
            event.preventDefault();
        }
    };

    return text === undefined ? (
        <div />
    ) : (
        // 该容器只用于文本选择/拖拽，不承担交互语义
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
            className={cn(
                theme.core.root,
                'select-text',
                FONT_SIZE['ms1-large'],
                fontSize === 'fontSizeSmall' && FONT_SIZE['ms1-small'],
                fontSize === 'fontSizeMedium' && FONT_SIZE['ms1-medium'],
                fontSize === 'fontSizeLarge' && FONT_SIZE['ms1-large'],
                className,
            )}
            onMouseDown={handleLineMouseDown}
        >
            {renderSentenceTokens({
                sentence,
                text,
                popEle: popELe,
                onRequestPop: handleRequestPop,
                show,
                alwaysDark: hoverDark,
                // 主字幕使用主题默认词样式
                wordClassNames: wordClassNames ?? {},
                sentenceHash: sentence.key,
            })}
        </div>
    );
};

export default TranslatableLine;

TranslatableLine.defaultProps = {
    hoverDark: false
};
