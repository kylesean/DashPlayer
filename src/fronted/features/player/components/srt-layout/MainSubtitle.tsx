import React, { type ReactElement, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import { Bookmark, History, RotateCcw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/fronted/components/ui/tooltip';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/fronted/components/ui/popover';
import { Input } from '@/fronted/components/ui/input';
import { cn } from '@/fronted/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';
import LearningModeButton from './LearningModeButton';
import PracticeModeButton from './PracticeModeButton';
import {
    CAPTION_CARD_ANCHOR_CLASS,
    CAPTION_CARD_BUTTON_CLASS,
    CAPTION_CARD_CLASS,
    CAPTION_CARD_IDLE_CLASS,
    captionCardActiveClass,
} from '@/fronted/features/player/components/captionCardShell';

export default function MainSubtitle() {
    const { t } = useI18nTranslation('player');
    const logger = getRendererLogger('MainSubtitle');
    const sentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjusted = useMemo(() => (sentence && srtTender ? (srtTender.adjusted(sentence) ?? false) : false), [sentence, srtTender]);

    // 当前句时间戳偏移（秒）：仅在存在调整时计算，用于胶囊控制栏的常显偏移 Badge
    const adjustDiff = useMemo(() => {
        if (!sentence || !srtTender || !adjusted) return null;
        return srtTender.timeDiff(sentence);
    }, [sentence, srtTender, adjusted]);

    // 时间戳调整配置弹层：打开时以当前偏移初始化草稿输入
    const [adjustPopoverOpen, setAdjustPopoverOpen] = useState(false);
    const [adjustDraft, setAdjustDraft] = useState<{ start: string; end: string }>({ start: '0', end: '0' });

    /**
     * Popover 打开状态变化：打开瞬间把当前句的起/终偏移写入草稿。
     */
    const handleAdjustPopoverChange = (open: boolean) => {
        if (open) {
            const diff = srtTender && sentence && adjusted ? srtTender.timeDiff(sentence) : { start: 0, end: 0 };
            setAdjustDraft({ start: diff.start.toFixed(2), end: diff.end.toFixed(2) });
        }
        setAdjustPopoverOpen(open);
    };

    /**
     * 应用草稿中的绝对偏移：与当前偏移求差后走增量调整动作（保留虚拟组归属与重播语义）。
     * 当前偏移从 store 实时读取，避免连续应用起点/终点时用到过期闭包值。
     *
     * @param field 要应用的偏移字段
     * @param raw 输入框原始文本
     */
    const applyAdjustDraft = (field: 'start' | 'end', raw: string) => {
        const next = Number(raw);
        if (!Number.isFinite(next)) return;
        const { srtTender: tender, currentSentence } = usePlayer.getState();
        const current = tender && currentSentence && tender.adjusted(currentSentence)
            ? tender.timeDiff(currentSentence)[field]
            : 0;
        const delta = next - current;
        if (Math.abs(delta) < 0.005) return;
        if (field === 'start') {
            playerActions.adjustCurrentBegin(delta);
        } else {
            playerActions.adjustCurrentEnd(delta);
        }
    };

    const srtHash = usePlaybackSession((s) => s.srtHash);

    const adjustBeginMinusShortcut = useSetting((s) => s.setting('shortcut.adjustBeginMinus'));
    const adjustBeginPlusShortcut = useSetting((s) => s.setting('shortcut.adjustBeginPlus'));
    const adjustEndMinusShortcut = useSetting((s) => s.setting('shortcut.adjustEndMinus'));
    const adjustEndPlusShortcut = useSetting((s) => s.setting('shortcut.adjustEndPlus'));
    const clearAdjustShortcut = useSetting((s) => s.setting('shortcut.clearAdjust'));

    const formatShortcut = (k?: string) => (k ? ` (${k})` : '');

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

                {/* 右下角悬浮控制栏：绝对定位、完全不占排版空间。
                    只承载绑定当前句的操作（收藏/微调/跟读听写/整句学习）；
                    整条悬停期间临时切换为当前句循环，离开即还原。
                    全局控制（上一句/下一句/播放/训练模式/字幕轨道）在视频底部控制条里，不在这里 */}
                <div
                    className={cn(CAPTION_CARD_ANCHOR_CLASS, 'z-20 pointer-events-auto flex items-center gap-1.5')}
                    onMouseEnter={() => playerActions.setHoverRepeat(true)}
                    onMouseLeave={() => playerActions.setHoverRepeat(false)}
                >
                    {/* 当前句操作胶囊：收藏/微调/跟读听写/整句学习 */}
                    <div className={CAPTION_CARD_CLASS}>
                        <TooltipProvider delayDuration={300}>
                            {/* 时间戳调整与重置（合并为一个触发器）：图标常驻，调整后整颗按钮高亮；
                                具体偏移量只在 tooltip 与弹窗里给出，不挤进胶囊、不改变按钮宽度 */}
                            <Popover open={adjustPopoverOpen} onOpenChange={handleAdjustPopoverChange}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <PopoverTrigger asChild>
                                            <button
                                                className={cn(
                                                    CAPTION_CARD_BUTTON_CLASS,
                                                    adjusted ? captionCardActiveClass('amber') : CAPTION_CARD_IDLE_CLASS
                                                )}
                                            >
                                                <History className="w-3.5 h-3.5 stroke-[2]" />
                                            </button>
                                        </PopoverTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        {adjusted
                                            ? t('subtitle.adjustApplied', {
                                                  start: `${(adjustDiff?.start ?? 0) >= 0 ? '+' : ''}${(adjustDiff?.start ?? 0).toFixed(2)}s`,
                                                  end: `${(adjustDiff?.end ?? 0) >= 0 ? '+' : ''}${(adjustDiff?.end ?? 0).toFixed(2)}s`,
                                              })
                                            : t('subtitle.adjustTooltip')}
                                    </TooltipContent>
                                </Tooltip>
                                <PopoverContent side="top" align="end" className="w-72 p-3.5 gap-3 shadow-xl border-border/80 bg-popover/95 backdrop-blur-md">
                                    <div className="flex items-center justify-between border-b border-border/50 pb-2">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <History className="w-3.5 h-3.5 text-amber-500" />
                                            <span>{t('subtitle.adjustTitle')}</span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                if (adjusted) {
                                                    void playerActions.clearAdjust();
                                                    setAdjustDraft({ start: '0.00', end: '0.00' });
                                                }
                                            }}
                                            disabled={!adjusted}
                                            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                                                adjusted
                                                    ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60 font-medium cursor-pointer'
                                                    : 'text-muted-foreground/40 cursor-default'
                                            }`}
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            <span>{t('subtitle.reset')}</span>
                                        </button>
                                    </div>

                                    {/* 句首时间调整 */}
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground font-medium">{t('subtitle.beginLabel')}</span>
                                            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                                                {`${(adjustDiff?.start ?? 0) >= 0 ? '+' : ''}${(adjustDiff?.start ?? 0).toFixed(2)}s`}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => playerActions.adjustCurrentBegin(-0.2)}
                                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                                            >
                                                -0.2s
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => playerActions.adjustCurrentBegin(0.2)}
                                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                                            >
                                                +0.2s
                                            </button>
                                            <div className="flex items-center gap-1 w-20 shrink-0">
                                                <Input
                                                    type="number"
                                                    step={0.05}
                                                    className="h-7 text-[11px] font-mono px-1.5 text-center"
                                                    value={adjustDraft.start}
                                                    onChange={(e) => setAdjustDraft((d) => ({ ...d, start: e.target.value }))}
                                                    onBlur={() => applyAdjustDraft('start', adjustDraft.start)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') applyAdjustDraft('start', adjustDraft.start); }}
                                                />
                                                <span className="text-[10px] text-muted-foreground">s</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 句尾时间调整 */}
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground font-medium">{t('subtitle.endLabel')}</span>
                                            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                                                {`${(adjustDiff?.end ?? 0) >= 0 ? '+' : ''}${(adjustDiff?.end ?? 0).toFixed(2)}s`}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => playerActions.adjustCurrentEnd(-0.2)}
                                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                                            >
                                                -0.2s
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => playerActions.adjustCurrentEnd(0.2)}
                                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                                            >
                                                +0.2s
                                            </button>
                                            <div className="flex items-center gap-1 w-20 shrink-0">
                                                <Input
                                                    type="number"
                                                    step={0.05}
                                                    className="h-7 text-[11px] font-mono px-1.5 text-center"
                                                    value={adjustDraft.end}
                                                    onChange={(e) => setAdjustDraft((d) => ({ ...d, end: e.target.value }))}
                                                    onBlur={() => applyAdjustDraft('end', adjustDraft.end)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') applyAdjustDraft('end', adjustDraft.end); }}
                                                />
                                                <span className="text-[10px] text-muted-foreground">s</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 快捷键指引 */}
                                    <div className="border-t border-border/50 pt-2 text-[10px] text-muted-foreground/80 flex flex-col gap-1 leading-normal">
                                        <div className="flex items-center justify-between">
                                            <span>{t('subtitle.beginShortcutHint')}</span>
                                            <span className="font-mono text-[10px] text-foreground/80">
                                                {adjustBeginMinusShortcut || '['} / {adjustBeginPlusShortcut || ']'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>{t('subtitle.endShortcutHint')}</span>
                                            <span className="font-mono text-[10px] text-foreground/80">
                                                {adjustEndMinusShortcut || '{'} / {adjustEndPlusShortcut || '}'}
                                            </span>
                                        </div>
                                        {clearAdjustShortcut && (
                                            <div className="flex items-center justify-between">
                                                <span>{t('subtitle.resetShortcutHint')}</span>
                                                <span className="font-mono text-[10px] text-foreground/80">{clearAdjustShortcut}</span>
                                            </div>
                                        )}
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {/* 跟读/听写练习开关：与整句学习页互斥打开 */}
                            <PracticeModeButton />

                            {/* 整句学习开关：挂在胶囊最右侧，与学习界面右下角那颗是同一颗，位置不随视图变化 */}
                            <LearningModeButton />
                        </TooltipProvider>
                    </div>
                </div>
            </div>
        );
    };

    return render();
}
