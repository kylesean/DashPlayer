import { useTranslation } from 'react-i18next';
import { cn } from "@/fronted/lib/utils";
import useSetting from '@/fronted/features/settings/settingsStore';
import { FONT_SIZE } from '@/fronted/styles/style';

interface NormalLineParam {
    text: string;
    order: 'second' | 'third';
    source?: 'ai' | 'source';
}

const NormalLine = ({ text, order, source }: NormalLineParam) => {
    const { t } = useTranslation('player');
    const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));

    if (text === undefined) {
        return <div />;
    }
    return (
        <div
            className={cn(
                'my-0 mx-6 py-1 px-1 font-normal tracking-wide text-secondary flex items-center justify-center gap-2 leading-relaxed transition-colors',
                fontSize === 'fontSizeSmall' && (order === 'second' ? FONT_SIZE["ms2-small"] : FONT_SIZE["ms3-small"]),
                fontSize === 'fontSizeMedium' && (order === 'second' ? FONT_SIZE["ms2-medium"] : FONT_SIZE["ms3-medium"]),
                fontSize === 'fontSizeLarge' && (order === 'second' ? FONT_SIZE["ms2-large"] : FONT_SIZE["ms3-large"]),
            )}
        >
            {source && (
                <span
                    className={cn(
                        "inline-flex items-center justify-center px-1.5 py-0.2 rounded text-[10px] font-medium tracking-wider uppercase select-none opacity-70 hover:opacity-100 transition-opacity shrink-0",
                        source === 'ai'
                            ? "text-accent bg-accent-muted/20 border border-accent/30"
                            : "text-secondary bg-muted border border-border"
                    )}
                    title={source === 'ai' ? t('sourceLine.aiTranslation') : t('sourceLine.originalSubtitle')}
                >
                    {source === 'ai' ? 'AI' : 'SRT'}
                </span>
            )}
            <span className="text-balance">{text}</span>
        </div>
    );
};

export default NormalLine;
