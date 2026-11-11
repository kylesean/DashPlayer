import { Button } from '@astryxdesign/core/Button';
import { useTranslation } from 'react-i18next';

interface ModeSwitchToastProps {
    mode: 'podcast' | 'video';
    onCancel: () => void;
}

const icons = {
    podcast: '🎙️',
    video: '📺'
} as const;

export function ModeSwitchToast({ mode, onCancel }: ModeSwitchToastProps) {
    const { t } = useTranslation('toast');
    return (
        <div className="flex items-center gap-3 text-sm font-medium">
            <span className="flex items-center gap-1.5 text-foreground">
                <span>{icons[mode]}</span>
                <span>{mode === 'podcast' ? t('modeSwitchedPodcast') : t('modeSwitchedVideo')}</span>
            </span>
            <Button
                variant="ghost"
                size="sm"
                label={t('restore')}
                onClick={onCancel}
            />
        </div>
    );
}
