import { cn } from "@/frontend/lib/utils";
import useSetting from "@/frontend/features/settings/settingsStore";
import { FONT_SIZE } from "@/frontend/styles/style";
import SourceBadge, { type SubtitleSource } from "@/frontend/features/player/components/subtitles/SourceBadge";

interface SubtitleLineProps {
    text: string;
    order: 'second' | 'third';
    /** 行来源：AI 机翻 / 原始字幕，与主界面保持一致的可辨识度。 */
    source?: SubtitleSource;
}
const SubtitleLine = ({ text, order, source }: SubtitleLineProps) => {
    const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));

    if (text === undefined) {
        return <div />;
    }
    return (
        <div
            className={cn(
                'my-0 mx-10 py-1.5 px-4 bg-media-bg/60 backdrop-blur-xs text-media-fg rounded-lg shadow-lg text-center text-balance max-w-5xl',
                source && 'flex items-center justify-center gap-2',
                fontSize === 'fontSizeSmall' && (order === 'second' ? FONT_SIZE["ms2-small"] : FONT_SIZE["ms3-small"]),
                fontSize === 'fontSizeMedium' && (order === 'second' ? FONT_SIZE["ms2-medium"] : FONT_SIZE["ms3-medium"]),
                fontSize === 'fontSizeLarge' && (order === 'second' ? FONT_SIZE["ms2-large"] : FONT_SIZE["ms3-large"]),
            )}
        >
            {source && <SourceBadge source={source} />}
            <span>{text}</span>
        </div>
    );
};

export default SubtitleLine;
