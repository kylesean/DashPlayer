import { useState } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Slider } from '@astryxdesign/core/Slider';
import { cn } from '@/frontend/lib/utils';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { MEDIA_SLIDER_STYLE } from '@/frontend/features/player/components/mediaSurface';

export interface VolumeSliderProps {
    volume: number;
    onVolumeChange: (volume: number) => void;
    muted: boolean;
    onMutedChange: (muted: boolean) => void;
    /** 整条控件（图标按钮 + 滑杆）的外层样式 */
    className?: string;
    /**
     * 静音按钮在宿主控制条上的外观，语义同 SpeedSliderProps.triggerClassName：
     * 默认跟随应用主题（亮色宿主），恒为深色的视频控制条要传 DARK_BAR_BUTTON_HOVER。
     */
    triggerClassName?: string;
    /**
     * 窄窗（xl 以下）把滑条收起，只留静音图标与百分比。
     * 视频控制条在窄窗里摆不下整排控件，滑条是最容易让位的一个（静音/恢复仍可点图标）；
     * 默认关闭，因为播客控制条这类宽松宿主需要完整滑条。
     */
    collapseSliderBelowXl?: boolean;
    /** 滑杆配色：媒体层保持中性白，主题宿主跟随应用主题。 */
    tone?: 'media' | 'theme';
}

const VolumeSlider = ({
    volume,
    onVolumeChange,
    muted,
    onMutedChange,
    className,
    triggerClassName,
    collapseSliderBelowXl = false,
    tone = 'theme',
}: VolumeSliderProps) => {
    const { t } = useI18nTranslation('player');
    const [localVolume, setLocalVolume] = useState<number>(volume);

    const getVolumeIcon = () => {
        if (muted || localVolume === 0) {
            return <VolumeX className="h-4 w-4" />;
        }
        if (localVolume <= 0.5) {
            return <Volume1 className="h-4 w-4" />;
        }
        return <Volume2 className="h-4 w-4" />;
    };

    const volumePercent = muted ? 0 : Math.round(localVolume * 100);

    return (
        <div className={cn("flex items-center gap-1.5 font-mono text-inherit", className)}>
            <button
                type="button"
                onClick={() => onMutedChange(!muted)}
                className={cn(
                    'h-8 px-2 rounded-lg text-inherit hover:bg-primary/10 transition-colors gap-1.5 flex items-center cursor-pointer',
                    triggerClassName
                )}
                title={muted ? t('volumeSlider.unmute') : t('volumeSlider.mute')}
                aria-label={muted ? t('volumeSlider.unmute') : t('volumeSlider.mute')}
            >
                {getVolumeIcon()}
                <span className="text-sm font-mono w-7 text-left tabular-nums">
                    {volumePercent}
                </span>
            </button>
            <div
                className={cn('w-20 items-center', collapseSliderBelowXl ? 'hidden xl:flex' : 'flex')}
                style={tone === 'media' ? MEDIA_SLIDER_STYLE : undefined}
            >
                <Slider
                    label={t('volumeSlider.title', '音量')}
                    isLabelHidden
                    valueDisplay="none"
                    max={100}
                    min={0}
                    step={1}
                    value={volumePercent}
                    onChange={(val: number | [number, number]) => {
                        const raw = typeof val === 'number' ? val : val[0];
                        const next = raw / 100;
                        if (muted && next > 0) {
                            onMutedChange(false);
                        }
                        onVolumeChange(next);
                        setLocalVolume(next);
                    }}
                    width={80}
                />
            </div>
        </div>
    );
};

export default VolumeSlider;
