import React, { type ReactElement, useEffect, useLayoutEffect } from 'react';
import TranslatableLine from '@/fronted/features/player/components/subtitles/TranslatableLineWrapper';
import NormalLine from './NormalLine';
import useTranslation from '@/fronted/features/player/translationStore';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import StrUtil from '@/common/utils/str-util';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import { cn } from '@/fronted/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';
import LearningCapsule from '@/fronted/features/player/components/control-box/LearningCapsule';
import { CAPTION_CARD_ANCHOR_CLASS } from '@/fronted/features/player/components/captionCardShell';

export default function MainSubtitle() {
    const { t } = useI18nTranslation('player');
    const logger = getRendererLogger('MainSubtitle');
    const sentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjusted = Boolean(sentence && srtTender && srtTender.adjusted(sentence));
    const srtHash = usePlaybackSession((s) => s.srtHash);

    const requestTranslation = useTranslation(state => state.requestTranslation);
    const engine = useTranslation(state => state.engine);
    const openAiMode = useTranslation(state => state.openAiMode);
    const activeFileHash = useTranslation(state => state.activeFileHash);

    // 长意群溢出适配:通过 CSS 变量 --sub-scale 进行自适应字号缩放，保证原文+译文永远完整可见，
    // 杜绝非标准 CSS zoom 造成的文本模糊、布局变形及 Floating UI 浮层坐标偏移。
    // 正常长度时 scale 为 1，用户设置的固定字号不受影响；超出容器时动态缩小（下限 0.75，防止字体过小不可读）。
    const subtitleContainerRef = React.useRef<HTMLDivElement>(null);
    const subtitleContentRef = React.useRef<HTMLDivElement>(null);
    const [, bumpSubtitleFitTick] = React.useReducer((tick: number) => tick + 1, 0);

    // 绘制前测量:先复位 --sub-scale 量自然高度,超出容器则按比例调整字号缩放(上限 1,不放大)。
    // 全部用布局口径(offsetHeight / clientHeight):播放器浮动层带 transform: scale(),
    // getBoundingClientRect 会把测量值乘上缩放系数,而 overflow-hidden 按布局盒裁切,
    // 两种口径混用会算错缩放比。可用高度要扣除容器上下内边距(pt-3/pb-2)。
    // 无依赖数组——每次渲染都重测:译文到达、意群切换、字号设置变更都会改变内容高度。
    useLayoutEffect(() => {
        const container = subtitleContainerRef.current;
        const content = subtitleContentRef.current;
        if (!container || !content) return;
        content.style.removeProperty('--sub-scale');
        const natural = content.offsetHeight;
        const style = getComputedStyle(container);
        const available = container.clientHeight
            - (parseFloat(style.paddingTop) || 0)
            - (parseFloat(style.paddingBottom) || 0);
        if (natural > available && available > 0) {
            const scale = Math.max(0.75, available / natural);
            content.style.setProperty('--sub-scale', scale.toFixed(3));
        }
    });

    // 容器尺寸变化(拖窗口/切换窗口模式)不经过 React 渲染,监听后触发一次重渲染走上面的测量
    useEffect(() => {
        const container = subtitleContainerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => bumpSubtitleFitTick());
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // 在组件顶层获取当前句子的翻译
    const translationKey = sentence?.translationKey || '';
    const newTranslation = useTranslation(state => state.translations.get(translationKey)) || '';
    /** 整句模式需要渲染块内其他行的译文：订阅整个译文表，任一译文到达都触发重渲染。 */
    const translations = useTranslation(state => state.translations);
    /** 当前句所在的意群块；整句模式关闭时为 null，回退单行渲染。 */
    const block = usePlayer(state => state.getCurrentBlock());
    // getCurrentBlock 依赖的 sentenceBlockMode 在 playerStore 内经 getState 非响应式读取，
    // 这里必须订阅开关本身：否则暂停态下（无 timeupdate）切换整句模式不会重算，主字幕区永久陈旧
    usePlayerUi(state => state.sentenceBlockMode);

    useEffect(() => {
        if (sentence && engine !== 'none' && activeFileHash === sentence.fileHash) {
            requestTranslation(sentence.fileHash, sentence.index);
        }
    }, [logger, sentence, engine, openAiMode, activeFileHash, requestTranslation]);

    // 两种不会触发胶囊区 mouseleave 的情况兜底关闭悬停临时循环：当前句清空（切视频，胶囊区随早退分支卸载）、组件卸载（离开播放页）
    useEffect(() => {
        if (!sentence) {
            playerActions.setHoverRepeat(false);
        }
    }, [sentence]);
    useEffect(() => () => { playerActions.setHoverRepeat(false); }, []);

    // 字幕轨道显隐：只在这里订阅展示值，切换入口在视频底部控制条
    const showCn = usePlayerUi((state) => state.showCn);
    const showSourceZh = usePlayerUi((state) => state.showSourceZh);

    /** 渲染一行字幕的译文与源自带中文（整句模式用），按开关与有无依次输出。 */
    const renderZhLinesForBlock = (item: Sentence): ReactElement[] => {
        const lines: ReactElement[] = [];
        const translation = translations.get(item.translationKey) || '';
        if (showCn && StrUtil.isNotBlank(translation)) {
            lines.push(
                <div key={`block-translation-${item.key}`} className="w-full min-h-0">
                    <NormalLine
                        text={translation}
                        order="second"
                        source={showSourceZh && StrUtil.isNotBlank(item.textZH) ? 'ai' : undefined}
                    />
                </div>
            );
        }
        if (showSourceZh && StrUtil.isNotBlank(item.textZH)) {
            lines.push(
                <div key={`block-sourceZh-${item.key}`} className="w-full min-h-0">
                    <NormalLine
                        text={item.textZH!}
                        order={lines.length === 0 ? 'second' : 'third'}
                        source={showCn && StrUtil.isNotBlank(translation) ? 'source' : undefined}
                    />
                </div>
            );
        }
        return lines;
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
                        key={`block-first-${item.key}`}
                        className={cn('w-full shrink-0 transition-opacity', !active && 'opacity-50')}
                    >
                        <TranslatableLine
                            variant="plain"
                            adjusted={active ? adjusted : false}
                            clearAdjust={active
                                ? () => { void playerActions.clearAdjust(); }
                                : () => {}}
                            sentence={item}
                        />
                    </div>
                );
            }
            lines.push(...renderZhLinesForBlock(item));
        }
        return lines;
    };

    const ele = (): ReactElement[] => {
        if (!sentence) {
            return [];
        }

        // 整句模式：按意群块渲染（块内全部行 + 逐行译文）
        if (block) {
            return renderBlockLines();
        }

        const lines: ReactElement[] = [];

        // 1. 原文字幕 (最高优先级，不被压缩，保持顶部与呼吸空间)
        if (StrUtil.isNotBlank(sentence.text)) {
            lines.push(
                <div
                    key={`first-${sentence.key}`}
                    className="w-full shrink-0"
                >
                    <TranslatableLine
                        variant="plain"
                        adjusted={adjusted}
                        clearAdjust={() => { void playerActions.clearAdjust(); }}
                        sentence={sentence}
                    />
                </div>
            );
        }

        const hasMultipleZh = (showCn && StrUtil.isNotBlank(newTranslation)) && (showSourceZh && StrUtil.isNotBlank(sentence.textZH));

        // 2. 机器翻译 (次级，空间不足时优先被挤出/裁切)
        if (showCn && StrUtil.isNotBlank(newTranslation)) {
            lines.push(
                <div
                    key={`translation-${sentence.key}`}
                    className="w-full min-h-0"
                >
                    <NormalLine
                        text={newTranslation}
                        order="second"
                        source={hasMultipleZh ? 'ai' : undefined}
                    />
                </div>
            );
        }

        // 3. 字幕自带中文 (次级)
        if (showSourceZh && StrUtil.isNotBlank(sentence.textZH)) {
            lines.push(
                <div
                    key={`sourceZh-${sentence.key}`}
                    className="w-full min-h-0"
                >
                    <NormalLine
                        text={sentence.textZH!}
                        order={lines.length === 1 ? 'second' : 'third'}
                        source={hasMultipleZh ? 'source' : undefined}
                    />
                </div>
            );
        }

        return lines;
    };

    const render = () => {
        if (!sentence) {
            return <div className="w-full h-full" />;
        }
        return (
            <div
                ref={subtitleContainerRef}
                className="relative flex flex-col w-full h-full items-center px-12 pt-3 pb-2 text-center text-textColor select-none overflow-hidden"
            >
                {/* 顶部弹性占位：比底部占位少，让文字动态停留在“中上”黄金位置（约 40% 高度） */}
                <div className="w-full flex-[2] min-h-0 pointer-events-none" />

                {/* 字幕内容区：永远受到外层 pt-3 顶距保护，绝不削顶 */}
                <div
                    ref={subtitleContentRef}
                    className="flex flex-col justify-start items-center gap-1.5 w-full min-w-0 shrink-0"
                >
                    {ele()}
                </div>

                {/* 底部弹性占位：比顶部占位更多 */}
                <div className="w-full flex-[3] min-h-0 pointer-events-none" />

                {/* 右下角自适应学习胶囊：聚合轨道切换、单句循环、自动暂停、跟读与AI学习、更多偏好设置 */}
                <LearningCapsule className={CAPTION_CARD_ANCHOR_CLASS} />
            </div>
        );
    };

    return render();
}
