import { cn } from "@/frontend/lib/utils";
import useSetting from '@/frontend/features/settings/settingsStore';
import { FONT_SIZE } from '@/frontend/styles/style';
import SourceBadge, { type SubtitleSource } from '@/frontend/features/player/components/subtitles/SourceBadge';

interface NormalLineParam {
    text: string;
    order: 'second' | 'third';
    source?: SubtitleSource;
}

const NormalLine = ({ text, order, source }: NormalLineParam) => {
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
            {source && <SourceBadge source={source} />}
            <span className="text-balance">{text}</span>
        </div>
    );
};

export default NormalLine;
