import { Headphones } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import useLayout from '@/fronted/app/stores/layoutStore';
import { setPodcastModeForCurrentVideo } from '@/fronted/features/player/podcastMode';
import {
    DARK_BAR_BUTTON_HOVER,
    MEDIA_BAR_ACTIVE,
    MEDIA_BAR_TEXT_BUTTON,
} from '@/fronted/features/player/components/PlaybackGlobalControls';

/**
 * 播客模式独立切换按钮（视频控制条一键入口）。
 *
 * 与全屏、硬字幕遮挡按钮并列在视频控制条右侧，供用户快速进入纯音频播客紧凑视图。
 */
export default function PodcastModeButton() {
    const { t } = useI18nTranslation('player');
    const podcastMode = useLayout((s) => s.podcastMode);

    return (
        <Tooltip content={t('controlBox.podcastModeHint')} placement="above">
            <button
                type="button"
                onClick={() => setPodcastModeForCurrentVideo(!podcastMode)}
                aria-pressed={podcastMode}
                aria-label={t('controlBox.podcastMode')}
                data-testid="player-control-podcast-mode-button"
                className={cn(
                    MEDIA_BAR_TEXT_BUTTON,
                    podcastMode
                        ? MEDIA_BAR_ACTIVE
                        : cn('text-media-fg/80', DARK_BAR_BUTTON_HOVER)
                )}
            >
                <Headphones className="w-4 h-4" />
                <span className="font-sans hidden lg:inline">{t('controlBox.podcastMode')}</span>
            </button>
        </Tooltip>
    );
}
