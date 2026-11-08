import React from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize, Minimize } from 'lucide-react';
import { Tooltip } from '@astryxdesign/core/Tooltip';

const FullscreenToggleButton = ({ fullScreen, changeFullScreen }: {
    fullScreen: boolean;
    changeFullScreen: (v: boolean) => void;
}) => {
    const { t } = useTranslation('player');
    const content = (
        <div className="max-w-xs text-xs space-y-1">
            <div className="font-semibold text-sm">{t('fullscreenHint.toggle')}</div>
            <div className="text-[11px] leading-relaxed">
                {t('fullscreenHint.title')}<br />
                <span className="font-medium">Windows:</span> {t('fullscreenHint.windows')}<br />
                <span className="font-medium">Mac:</span> {t('fullscreenHint.mac')}
            </div>
        </div>
    );

    return (
        <Tooltip content={content} placement="above">
            <button
                type="button"
                onClick={() => {
                    changeFullScreen(!fullScreen);
                }}
                className="w-8 h-8 rounded-lg text-white/90 hover:text-white hover:bg-white/15 transition-colors flex items-center justify-center cursor-pointer"
                aria-label={t('fullscreenHint.toggle')}
            >
                {fullScreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
        </Tooltip>
    );
};

export default FullscreenToggleButton;
