import React, { type ReactElement, useEffect, useLayoutEffect } from 'react';
import TranslatableLine from '@/fronted/features/player/components/subtitles/TranslatableLineWrapper';
import NormalLine from './NormalLine';
import useTranslation from '@/fronted/features/player/translationStore';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import StrUtil from '@/common/utils/str-util';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { cn } from '@/fronted/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';

export default function MainSubtitle() {
    const logger = getRendererLogger('MainSubtitle');
    const sentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjusted = Boolean(sentence && srtTender && srtTender.adjusted(sentence));

    const requestTranslation = useTranslation(state => state.requestTranslation);
    const engine = useTranslation(state => state.engine);
    const openAiMode = useTranslation(state => state.openAiMode);
    const activeFileHash = useTranslation(state => state.activeFileHash);

    // 顶层订阅组件所需状态
    const translationKey = sentence?.translationKey || '';
    const newTranslation = useTranslation(state => state.translations.get(translationKey)) || '';
    /** 整句模式需要渲染块内其他行的译文：订阅整个译文表，任一译文到达都触发重渲染。 */
    const translations = useTranslation(state => state.translations);
    /** 当前句所在的意群块；整句模式关闭时为 null，回退单行渲染。 */
    const block = usePlayer(state => state.getCurrentBlock());
    // getCurrentBlock 依赖的 sentenceBlockMode 在 playerStore 内经 getState 非响应式读取，
    // 这里必须订阅开关本身：否则暂停态下（无 timeupdate）切换整句模式不会重算，主字幕区永久陈旧
    usePlayerUi(state => state.sentenceBlockMode);
    const showCn = usePlayerUi((state) => state.showCn);
    const showSourceZh = usePlayerUi((state) => state.showSourceZh);
    const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));

    // 长意群溢出适配:通过 CSS 变量 --sub-scale 进行自适应字号缩放，保证原文+译文永远完整可见，
    // 杜绝非标准 CSS zoom 造成的文本模糊、布局变形及 Floating UI 浮层坐标偏移。
    // 正常长度时 scale 为 1，用户设置的固定字号不受影响；超出容器时动态缩小（下限 0.75，防止字体过小不可读）。
    const subtitleContainerRef = React.useRef<HTMLDivElement>(null);
    const subtitleContentRef = React.useRef<HTMLDivElement>(null);
    const [fitTick, bumpSubtitleFitTick] = React.useReducer((tick: number) => tick + 1, 0);

    // 绘制前测量:先复位 --sub-scale 量自然高度,超出容器则按比例调整字号缩放(上限 1,不放大)。
    // 全部用布局口径(offsetHeight / clientHeight):播放器浮动层带 transform: scale(),
    // getBoundingClientRect 会把测量值乘上缩放系数,而滚动/裁切按布局盒计算,
    // 两种口径混用会算错缩放比。可用高度要扣除内层容器的上下内边距(pt-3 / pb-3)。
    // 传入精确依赖项，杜绝每帧时间推进无谓触发强制同步重排（layout thrashing）。
    useLayoutEffect(() => {
        const scroller = subtitleContainerRef.current;
        const content = subtitleContentRef.current;
        if (!scroller || !content) return;
        content.style.removeProperty('--sub-scale');
        const natural = content.offsetHeight;
        const padHost = content.parentElement;
        const padStyle = padHost ? getComputedStyle(padHost) : null;
        const available = scroller.clientHeight
            - (padStyle ? parseFloat(padStyle.paddingTop) || 0 : 0)
            - (padStyle ? parseFloat(padStyle.paddingBottom) || 0 : 0);
        if (natural > available && available > 0) {
            const scale = Math.max(0.75, available / natural);
            content.style.setProperty('--sub-scale', scale.toFixed(3));
        }
    }, [sentence?.key, sentence?.text, newTranslation, showCn, showSourceZh, block?.repr?.key, fontSize, fitTick]);

    // 字号缩到下限仍放不下时（超长意群 + 多行译文），面板改为滚动而不是把最后一行裁掉；
    // 内容超出可视区时再把当前句滚回视野中央，保证正在读的那一句永远看得见。
    // 只在当前句超出视野时才动 scrollTop，用户手动滚动不会被每帧抢回来。
    useLayoutEffect(() => {
        const scroller = subtitleContainerRef.current;
        if (!scroller) return;
        const active = scroller.querySelector<HTMLElement>('[data-subtitle-active="true"]');
        if (!active) return;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        if (maxScroll <= 0) {
            if (scroller.scrollTop !== 0) scroller.scrollTop = 0;
            return;
        }
        const viewTop = scroller.scrollTop;
        const viewBottom = viewTop + scroller.clientHeight;
        const elementTop = active.offsetTop;
        const elementBottom = elementTop + active.offsetHeight;
        if (elementTop >= viewTop && elementBottom <= viewBottom) return;
        const target = elementTop - (scroller.clientHeight - active.offsetHeight) / 2;
        scroller.scrollTop = Math.min(Math.max(target, 0), maxScroll);
    }, [sentence?.key, sentence?.text, newTranslation, showCn, showSourceZh, block?.repr?.key, fontSize, fitTick]);

    // 容器尺寸变化(拖窗口/切换窗口模式)不经过 React 渲染,监听后触发一次重渲染走上面的测量
    useEffect(() => {
        const container = subtitleContainerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => bumpSubtitleFitTick());
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

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
            const itemLines: ReactElement[] = [];
            if (StrUtil.isNotBlank(item.text)) {
                itemLines.push(
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
            itemLines.push(...renderZhLinesForBlock(item));
            // 每句（原文 + 它的译文）包成一组：块超出面板时，滚动定位只需要认当前句这一组
            lines.push(
                <div
                    key={`block-group-${item.key}`}
                    data-subtitle-active={active ? 'true' : 'false'}
                    className="flex w-full flex-col items-center gap-1.5"
                >
                    {itemLines}
                </div>
            );
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
            /* 面板高度不够时改为滚动，绝不把最后一行裁掉；滚动条隐去，避免字幕区出现一条常驻灰条。
               内层 min-h-full 保证内容不满一屏时仍沿用原来的「中上黄金位置」留白。 */
            <div
                ref={subtitleContainerRef}
                className="relative h-full w-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <div className="flex min-h-full w-full flex-col items-center justify-center px-8 py-3 text-center text-textColor select-none">
                    {/* 字幕内容区：受 py-3 保护，自然居中 */}
                    <div
                        ref={subtitleContentRef}
                        data-subtitle-active={block ? undefined : 'true'}
                        className="flex flex-col justify-center items-center gap-2 w-full min-w-0 shrink-0 my-auto"
                    >
                        {ele()}
                    </div>
                </div>
            </div>
        );
    };

    return render();
}
