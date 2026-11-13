import { useMemo } from 'react';
import { UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    isHighConfidenceSpeakerShift,
    type SceneBoundary,
} from '@/common/learning/sceneSegmentation';
import type { Sentence } from '@/common/types/SentenceC';
import { useSceneBoundaries } from '@/fronted/features/player/hooks/useSceneBoundaries';

/**
 * 主字幕上方的轻量「换人说话」提示。
 *
 * 只在高置信度说话人切换时出现（如真实声纹分离，或文本推测叠加了其它信号）；
 * 场景/话题切换改由右侧字幕栏的分割线承担，避免主字幕上方被语速、切镜等噪点打扰。
 */
export default function SceneCue({
    sentences,
    currentSentence,
}: {
    sentences: Sentence[];
    currentSentence: Sentence | null;
}) {
    const { t } = useTranslation('player');
    const boundaries = useSceneBoundaries(sentences);

    const speakerShiftByIndex = useMemo(() => {
        const map = new Map<number, SceneBoundary>();
        for (const boundary of boundaries) {
            if (isHighConfidenceSpeakerShift(boundary)) {
                map.set(boundary.sentenceIndex, boundary);
            }
        }
        return map;
    }, [boundaries]);

    const boundary = currentSentence
        ? speakerShiftByIndex.get(currentSentence.index)
        : undefined;
    if (!boundary) {
        return null;
    }

    return (
        <div
            data-testid="scene-cue"
            className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
        >
            <span className="animate-in fade-in-0 slide-in-from-top-1 duration-300 inline-flex items-center gap-1 rounded-full border border-border/50 bg-surface/85 px-2.5 py-0.5 text-metadata font-medium tracking-wide text-secondary shadow-sm backdrop-blur-sm">
                <UserRound className="h-3.5 w-3.5 shrink-0" />
                {t('sceneCue.speakerShift')}
            </span>
        </div>
    );
}
