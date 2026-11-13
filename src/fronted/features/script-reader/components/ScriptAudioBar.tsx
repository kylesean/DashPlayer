import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import {
    ExternalLink,
    ListEnd,
    Mic,
    Pause,
    Play,
    Repeat1,
    SkipBack,
    SkipForward,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Sentence } from '@/common/types/SentenceC';
import TimeUtil from '@/common/utils/TimeUtil';
import { cn } from '@/fronted/lib/utils';
import type { ScriptPlaybackRate } from '../hooks/useScriptAudioReader';

interface ScriptAudioBarProps {
    totalSentences: number;
    activeSentence: Sentence | null;
    isPlaying: boolean;
    autoAdvance: boolean;
    singleLoop: boolean;
    playbackRate: ScriptPlaybackRate;
    onTogglePlayPause: () => void;
    onStepSentence: (delta: -1 | 1) => void;
    onToggleAutoAdvance: () => void;
    onToggleSingleLoop: () => void;
    onChangePlaybackRate: (rate: ScriptPlaybackRate) => void;
    onJumpToPlayer: (withPractice: boolean) => void;
}

const SPEED_OPTIONS: readonly ScriptPlaybackRate[] = [0.75, 1, 1.25];

/**
 * 精读文稿底部连续伴读控制条：支持起播/暂停、上下句切换、连续伴读、单句循环、倍速及跳回播放器。
 */
export function ScriptAudioBar({
    totalSentences,
    activeSentence,
    isPlaying,
    autoAdvance,
    singleLoop,
    playbackRate,
    onTogglePlayPause,
    onStepSentence,
    onToggleAutoAdvance,
    onToggleSingleLoop,
    onChangePlaybackRate,
    onJumpToPlayer,
}: ScriptAudioBarProps) {
    const { t } = useTranslation('pages');
    const activeTime = activeSentence
        ? TimeUtil.secondToTimeStrCompact(activeSentence.adjustedStart ?? activeSentence.start)
        : null;

    return (
        <div
            data-testid="script-audio-bar"
            className="shrink-0 border-t border-border/50 bg-surface/85 backdrop-blur-sm px-5 py-2 flex flex-wrap items-center justify-between gap-3"
        >
            {/* 左侧：播控按钮与当前进度 */}
            <div className="flex items-center gap-2 min-w-0">
                <Tooltip content={t('scriptReader.prevSentence', { defaultValue: '上一句' })} placement="above">
                    <button
                        type="button"
                        disabled={totalSentences === 0}
                        onClick={() => onStepSentence(-1)}
                        className="p-1.5 rounded-md text-secondary hover:text-primary hover:bg-muted/70 transition-colors cursor-pointer disabled:opacity-40"
                        aria-label={t('scriptReader.prevSentence', { defaultValue: '上一句' })}
                    >
                        <SkipBack className="h-4 w-4" />
                    </button>
                </Tooltip>

                <button
                    type="button"
                    disabled={totalSentences === 0}
                    onClick={onTogglePlayPause}
                    data-testid="script-audio-toggle"
                    className={cn(
                        'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 gap-1.5',
                        isPlaying
                            ? 'bg-accent text-white hover:opacity-90'
                            : 'bg-accent-bg/20 text-accent hover:bg-accent-bg/30',
                    )}
                    aria-label={
                        isPlaying
                            ? t('scriptReader.pauseAudio', { defaultValue: '暂停伴读' })
                            : t('scriptReader.playAudio', { defaultValue: '继续伴读' })
                    }
                >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    <span>
                        {isPlaying
                            ? t('scriptReader.pauseAudioShort', { defaultValue: '暂停' })
                            : t('scriptReader.playAudioShort', { defaultValue: '伴读' })}
                    </span>
                </button>

                <Tooltip content={t('scriptReader.nextSentence', { defaultValue: '下一句' })} placement="above">
                    <button
                        type="button"
                        disabled={totalSentences === 0}
                        onClick={() => onStepSentence(1)}
                        className="p-1.5 rounded-md text-secondary hover:text-primary hover:bg-muted/70 transition-colors cursor-pointer disabled:opacity-40"
                        aria-label={t('scriptReader.nextSentence', { defaultValue: '下一句' })}
                    >
                        <SkipForward className="h-4 w-4" />
                    </button>
                </Tooltip>

                <span className="text-metadata font-mono text-secondary truncate ml-1">
                    {activeSentence
                        ? t('scriptReader.activePosition', {
                            defaultValue: '第 {{current}} / {{total}} 句 · {{time}}',
                            current: activeSentence.index + 1,
                            total: totalSentences,
                            time: activeTime,
                        })
                        : t('scriptReader.idlePosition', {
                            defaultValue: '点击任意句子开始连续伴读（空格键暂停/继续）',
                        })}
                </span>
            </div>

            {/* 右侧：伴读模式、倍速、与播放器衔接 */}
            <div className="flex items-center gap-2 shrink-0">
                <Tooltip content={t('scriptReader.autoAdvanceHint', { defaultValue: '播完一句自动连播下一句' })} placement="above">
                    <button
                        type="button"
                        aria-pressed={autoAdvance}
                        onClick={onToggleAutoAdvance}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-metadata font-medium transition-colors cursor-pointer',
                            autoAdvance
                                ? 'bg-accent-bg/15 text-accent'
                                : 'text-secondary hover:text-primary hover:bg-muted/70',
                        )}
                    >
                        <ListEnd className="h-3.5 w-3.5" />
                        <span>{t('scriptReader.autoAdvance', { defaultValue: '连播' })}</span>
                    </button>
                </Tooltip>

                <Tooltip content={t('scriptReader.singleLoopHint', { defaultValue: '单句循环精听' })} placement="above">
                    <button
                        type="button"
                        aria-pressed={singleLoop}
                        onClick={onToggleSingleLoop}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-metadata font-medium transition-colors cursor-pointer',
                            singleLoop
                                ? 'bg-accent-bg/15 text-accent'
                                : 'text-secondary hover:text-primary hover:bg-muted/70',
                        )}
                    >
                        <Repeat1 className="h-3.5 w-3.5" />
                        <span>{t('scriptReader.singleLoop', { defaultValue: '循环' })}</span>
                    </button>
                </Tooltip>

                <div className="shrink-0">
                    <SegmentedControl
                        size="sm"
                        value={String(playbackRate)}
                        onChange={(val) => onChangePlaybackRate(Number(val) as ScriptPlaybackRate)}
                        label={t('scriptReader.playbackRate', { defaultValue: '伴读倍速' })}
                    >
                        {SPEED_OPTIONS.map((rate) => (
                            <SegmentedControlItem
                                key={rate}
                                value={String(rate)}
                                label={`${rate}x`}
                            />
                        ))}
                    </SegmentedControl>
                </div>

                {activeSentence && (
                    <div className="flex items-center gap-1 border-l border-border/50 pl-2">
                        <Tooltip content={t('scriptReader.shadowThisSentence', { defaultValue: '跳转到视频并跟读当前句' })} placement="above">
                            <button
                                type="button"
                                onClick={() => onJumpToPlayer(true)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-metadata font-medium text-secondary hover:text-primary hover:bg-muted/70 transition-colors cursor-pointer"
                            >
                                <Mic className="h-3.5 w-3.5" />
                                <span>{t('scriptReader.shadowSentenceShort', { defaultValue: '跟读' })}</span>
                            </button>
                        </Tooltip>
                        <Tooltip content={t('scriptReader.locateInVideo', { defaultValue: '带着当前进度回到视频播放' })} placement="above">
                            <button
                                type="button"
                                onClick={() => onJumpToPlayer(false)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-metadata font-medium text-secondary hover:text-primary hover:bg-muted/70 transition-colors cursor-pointer"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                                <span>{t('scriptReader.locateShort', { defaultValue: '看画面' })}</span>
                            </button>
                        </Tooltip>
                    </div>
                )}
            </div>
        </div>
    );
}
