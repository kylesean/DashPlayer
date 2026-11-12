import { useLayoutEffect, useRef } from 'react';
import { motion, useSpring } from 'framer-motion';
import { cn } from '@/fronted/lib/utils';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import type { Sentence } from '@/common/types/SentenceC';
import TranslatableLinePodcast from './TranslatableLinePodcast';
import PodcastControlBar from './PodcastControlBar';
import PodcastLearningBar from '@/fronted/features/player/components/learning-toolbar/PodcastLearningBar';
import StrUtil from '@/common/utils/str-util';
import FuncUtil from '@/common/utils/func-util';
import useTranslation from '@/fronted/features/player/translationStore';

const PodcastViewer = ({ className }: { className?: string }) => {
    const current: Sentence | null = usePlayer((s) => s.currentSentence);
    const sentences = usePlayer((s) => s.sentences);

    const translationKey = current?.translationKey || '';
    const newTranslation = useTranslation((state) => state.translations.get(translationKey)) || '';

    const showCn = usePlayerUi((s) => s.showCn);
    const showSourceZh = usePlayerUi((s) => s.showSourceZh);
    const srtTender = usePlayer((s) => s.srtTender);
    const clearAdjust = () => { void playerActions.clearAdjust(); };

    const viewerContainerRef = useRef<HTMLDivElement>(null);
    const activeItemRef = useRef<HTMLDivElement>(null);

    // 针对 120Hz / 高刷屏精心调校的工业级物理弹簧（极致跟手、无多余振荡）
    const springY = useSpring(0, {
        stiffness: 340,
        damping: 32,
        mass: 0.6,
        restDelta: 0.2
    });

    const currentIndex = current
        ? sentences.findIndex((x) => x.index === current.index && x.fileHash === current.fileHash)
        : -1;

    // 零延迟测量：将当前焦点句（中英双语完整块）的几何中心精确锁定在有效可用视口的正中心
    useLayoutEffect(() => {
        if (!current || !viewerContainerRef.current || !activeItemRef.current) return;
        const container = viewerContainerRef.current;
        const activeElem = activeItemRef.current;

        // 扣除底部约 70px 控制栏，计算更沉稳舒适的可用视口重心（约 0.53）
        const availableHeight = container.clientHeight - 70;
        const viewportCenter = availableHeight * 0.53;

        const targetY = -(activeElem.offsetTop + activeElem.offsetHeight / 2 - viewportCenter);
        springY.set(targetY);
    // current 用对象身份入依赖（key 变化必然伴随对象变化），同帧重复执行无副作用；springY 为稳定 MotionValue
    }, [current, newTranslation, showCn, showSourceZh, springY]);

    if (!current || !srtTender) {
        return (
            <div
                className={cn(
                    'relative flex h-full w-full items-center justify-center overflow-hidden',
                    'bg-body transition-colors duration-300',
                    className
                )}
            >
                {/* 没有字幕也要保留控制条：否则播客模式变成一块没有任何出口的空白区 */}
                <PodcastLearningBar className="absolute right-6 bottom-28 z-30" />
                <PodcastControlBar className="absolute left-0 bottom-0 z-30" />
            </div>
        );
    }

    return (
        <div
            ref={viewerContainerRef}
            className={cn(
                'relative h-full w-full overflow-hidden select-none',
                'bg-body transition-colors duration-300',
                className
            )}
        >
            {/* 上下方渐变柔化遮罩 */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-background via-background/85 to-transparent z-20" />
            <div className="pointer-events-none absolute inset-x-0 bottom-16 h-36 bg-gradient-to-t from-background via-background/85 to-transparent z-20" />

            {/* 纯净流动的沉浸式字幕流（GPU 硬件合成层 + 0 重排） */}
            <motion.div
                style={{ y: springY }}
                className="absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-6 px-6 md:px-8 pt-[44vh] pb-[60vh] will-change-transform pointer-events-none"
            >
                {sentences.map((sentence, idx) => {
                    const isCurrent = sentence.key === current.key;
                    const dist = Math.abs(idx - currentIndex);

                    // 视口外超远距离的占位优化
                    if (dist > 12) {
                        return <div key={sentence.key} className="w-full h-10" />;
                    }

                    // 电影级景深计算（动态衰减透明度、微量缩放与轻度焦外模糊）
                    const opacity = isCurrent ? 1 : dist === 1 ? 0.55 : dist === 2 ? 0.28 : 0.12;
                    const scale = isCurrent ? 1 : dist === 1 ? 0.88 : dist === 2 ? 0.8 : 0.74;
                    const blur = isCurrent ? 0 : dist === 1 ? 0.4 : dist === 2 ? 1.2 : 2.2;

                    return (
                        <div
                            key={sentence.key}
                            ref={isCurrent ? activeItemRef : undefined}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                                playerActions.gotoSentence(sentence);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    playerActions.gotoSentence(sentence);
                                }
                            }}
                            style={{
                                transform: `scale(${scale})`,
                                opacity,
                                filter: blur > 0 ? `blur(${blur}px)` : 'none'
                            }}
                            className={cn(
                                'w-full max-w-3xl px-6 md:px-8 py-2 text-center pointer-events-auto cursor-pointer rounded-2xl origin-center',
                                'transition-[transform,opacity,filter] duration-300 ease-out will-change-transform will-change-[filter]',
                                isCurrent ? 'cursor-default' : 'hover:opacity-80'
                            )}
                        >
                            {/* 统一使用原生大字号基准，温润护眼的柔白/柔灰配色 */}
                            <TranslatableLinePodcast
                                className={cn(
                                    'text-3xl md:text-podcast leading-relaxed tracking-tight transition-colors duration-300',
                                    isCurrent
                                        ? 'font-bold text-primary'
                                        : 'font-normal text-secondary/70'
                                )}
                                adjusted={isCurrent ? (srtTender.adjusted(current) ?? false) : false}
                                clearAdjust={isCurrent ? clearAdjust : FuncUtil.blank}
                                sentence={sentence}
                            />

                            {/* 仅焦点句展示中文与源译文（柔和灰阶） */}
                            {isCurrent && showCn && !StrUtil.isBlank(newTranslation) && (
                                <div className="mt-4 text-xl md:text-2xl font-normal text-secondary leading-relaxed transition-all">
                                    {newTranslation}
                                </div>
                            )}
                            {isCurrent && showSourceZh && !StrUtil.isBlank(current?.textZH) && (
                                <div className="mt-2 text-lg md:text-xl font-normal text-secondary/80 leading-relaxed transition-all">
                                    {current?.textZH}
                                </div>
                            )}
                        </div>
                    );
                })}
            </motion.div>

            {/* 精简学习条：只留轨道 / 循环 / 句末暂停；退出由底部控制条负责 */}
            <PodcastLearningBar className="absolute right-6 bottom-28 z-30" />
            <PodcastControlBar className="absolute left-0 bottom-0 z-30" />
        </div>
    );
}

export default PodcastViewer;
