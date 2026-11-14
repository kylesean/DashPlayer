import { useTranslation } from 'react-i18next';
import { cn } from '@/frontend/lib/utils';

export type SubtitleSource = 'ai' | 'source';

interface SourceBadgeProps {
    source: SubtitleSource;
}

/**
 * 字幕来源徽章：区分 AI 机翻行与原始字幕行。
 * 主界面与全屏字幕共用，保证"哪一行是机翻"在两处可见。
 */
const SourceBadge = ({ source }: SourceBadgeProps) => {
    const { t } = useTranslation('player');
    return (
        <span
            className={cn(
                'inline-flex items-center justify-center px-1.5 py-0.2 rounded text-xs font-medium tracking-wider uppercase select-none opacity-70 hover:opacity-100 transition-opacity shrink-0',
                source === 'ai'
                    ? 'text-accent bg-accent-muted/20 border border-accent-bg/30'
                    : 'text-secondary bg-muted border border-border',
            )}
            title={source === 'ai' ? t('sourceLine.aiTranslation') : t('sourceLine.originalSubtitle')}
        >
            {source === 'ai' ? 'AI' : 'SRT'}
        </span>
    );
};

export default SourceBadge;
