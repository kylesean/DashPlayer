/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useEffect, useRef } from 'react';
import { cn } from "@/fronted/lib/utils";
import { usePopover } from '@astryxdesign/core/Popover';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import useSetting from '@/fronted/features/settings/settingsStore';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    CONTROL_POPOVER_PANEL,
    CONTROL_POPOVER_SEPARATOR,
    ControlPopoverRow,
} from '@/fronted/features/player/components/ControlPopover';

export interface SpeedSliderProps {
    speed: number;
    onSpeedChange: (speed: number) => void;
    onSelectFinish?: () => void;
    /**
     * 触发按钮在宿主控制条上的外观。
     * 默认跟随应用主题的 hover 是给亮色宿主（播客控制条）用的；恒为深色的视频控制条要传
     * DARK_BAR_BUTTON_HOVER，否则浅色主题下 hover 会退化成「背景加暗 + 文字转黑」，
     * 且会漏掉 shadcn ghost 变体自带的 hover:text-accent-foreground。
     */
    triggerClassName?: string;
    /** 弹窗底边到按钮顶边的间距，按宿主控制条形状取
     *  CONTROL_POPOVER_OFFSET_STACKED_BAR / _SINGLE_ROW_BAR，避免弹窗压住本条进度条 */
    popoverOffset: number;
}

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

const SpeedSlider = ({ speed, onSpeedChange, onSelectFinish, triggerClassName, popoverOffset }: SpeedSliderProps) => {
    const { t } = useI18nTranslation('player');
    const logger = getRendererLogger('SpeedSlider');
    const inputRef = useRef<HTMLInputElement>(null);
    const popover = usePopover({
        className: cn('w-52', CONTROL_POPOVER_PANEL),
        hasSurface: false,
        isModal: false,
        dialogLabel: t('speedSlider.title', { defaultValue: '播放速度' }),
    });

    useEffect(() => {
        if (popover.isOpen) {
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 50);
        }
    }, [popover.isOpen]);

    // 订阅 settingMap 变化，确保勾选状态即时响应
    const rawStack = useSetting((s) => s.setting('userSelect.playbackRateStack'));
    const setSetting = useSetting((s) => s.setSetting);

    const favoriteList = rawStack
        .split(',')
        .map((v) => parseFloat(v))
        .filter((v) => !isNaN(v));

    const toggleFavorite = (num: number, checked: boolean) => {
        let arr = [...favoriteList];
        if (checked) {
            if (!arr.includes(num)) arr.push(num);
        } else {
            arr = arr.filter((v) => v !== num);
        }
        setSetting('userSelect.playbackRateStack', arr.join(','));
    };

    const handleCustomSpeedSubmit = (val: string) => {
        let s = parseFloat(parseFloat(val).toFixed(2));
        if (isNaN(s)) return;
        if (s > 20) s = 20;
        if (s < 0.25) s = 0.25;
        onSpeedChange(s);
        popover.hide();
        onSelectFinish?.();
    };

    return (
        <>
            <Button
                ref={popover.triggerRef}
                onClick={popover.toggle}
                {...popover.triggerProps}
                size="sm"
                variant="ghost"
                label={`${speed.toFixed(2)}x`}
                className={cn(
                    // 默认 hover 跟随应用主题（亮色宿主）；深色控制条由 triggerClassName 覆盖
                    'h-8 px-2.5 rounded-lg text-sm font-mono text-inherit hover:bg-foreground/10 transition-colors',
                    triggerClassName
                )}
            />
            {popover.render(
                <>
                <div className="flex flex-col max-h-72 overflow-y-auto pr-0.5 media-scrollbar [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-media-fg/20">
                    {SPEED_PRESETS.map((num) => {
                        const isSelected = Math.abs(speed - num) < 0.001;
                        const isFavorite = favoriteList.includes(num);
                        return (
                            <ControlPopoverRow
                                key={num}
                                checked={isSelected}
                                emphasize={isSelected}
                                className="font-mono"
                                label={`${num.toFixed(2)}x`}
                                onActivate={() => {
                                    popover.hide();
                                    onSpeedChange(num);
                                    onSelectFinish?.();
                                }}
                                right={
                                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- 仅阻止冒泡以免误触发整行的 onActivate，本身不是可交互控件
                                    <div className="flex items-center pl-2" onClick={(e) => e.stopPropagation()}>
                                        <Tooltip
                                            content={t('speedSlider.favoriteHint', {
                                                shortcut: useSetting.getState().setting('shortcut.nextPlaybackRate'),
                                            })}
                                            placement="end"
                                        >
                                            <div className="flex items-center">
                                                <CheckboxInput
                                                    value={isFavorite}
                                                    onChange={(checked) => {
                                                        toggleFavorite(num, checked);
                                                    }}
                                                    label={`${num}x favorite`}
                                                    isLabelHidden
                                                    size="sm"
                                                    id={`speed-check-${num}`}
                                                />
                                            </div>
                                        </Tooltip>
                                    </div>
                                }
                            />
                        );
                    })}
                </div>

                <div className={CONTROL_POPOVER_SEPARATOR} />
                <div className="px-0.5 pt-2">
                    <div className="flex items-center gap-1.5 bg-media-fg/5 hover:bg-media-fg/10 focus-within:bg-media-fg/10 border border-media-fg/10 focus-within:border-primary/60 rounded-lg px-2 py-1 transition-colors">
                        <span className="text-sm text-secondary font-sans shrink-0">{t('speedSlider.custom')}</span>
                        <input
                            ref={inputRef}
                            defaultValue={speed}
                            type="number"
                            min={0.25}
                            max={16}
                            step={0.25}
                            className="w-full h-5 p-0 bg-transparent border-0 text-right text-sm font-mono text-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleCustomSpeedSubmit(e.currentTarget.value);
                                }
                            }}
                            onChange={(e) => {
                                const val = e.currentTarget.value;
                                logger.debug('Speed input change', { val });
                                const s = parseFloat(parseFloat(val).toFixed(2));
                                if (!isNaN(s) && s >= 0.25 && s <= 20) {
                                    onSpeedChange(s);
                                }
                            }}
                        />
                        <span className="text-sm text-secondary font-mono">x</span>
                    </div>
                </div>
                </>,
                { placement: 'above', alignment: 'center', offset: popoverOffset },
            )}
        </>
    );
};

export default SpeedSlider;
