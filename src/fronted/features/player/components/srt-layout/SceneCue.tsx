import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
    segmentScenes,
    type SceneBoundary,
} from '@/common/learning/sceneSegmentation';
import type { Sentence } from '@/common/types/SentenceC';
import useSetting from '@/fronted/features/settings/settingsStore';

/**
 * 主字幕上方的轻量场景提示。
 *
 * 只在当前句命中本地场景边界时出现，绝对定位、不参与字幕排版，
 * 因此不会改变中英文字幕的居中位置，也不会因提示出现/消失造成抖动。
 */
export default function SceneCue({
    sentences,
    currentSentence,
}: {
    sentences: Sentence[];
    currentSentence: Sentence | null;
}) {
    const { t } = useTranslation('player');
    const enabled = useSetting((state) => state.values.get('player.sceneCues') ?? 'false') === 'true';

    const boundaryByIndex = useMemo(() => {
        if (!enabled || sentences.length < 2) {
            return new Map<number, SceneBoundary>();
        }
        const map = new Map<number, SceneBoundary>();
        for (const boundary of segmentScenes(sentences)) {
            map.set(boundary.sentenceIndex, boundary);
        }
        return map;
    }, [enabled, sentences]);

    const boundary = currentSentence
        ? boundaryByIndex.get(currentSentence.index)
        : undefined;
    if (!boundary) {
        return null;
    }

    const label = boundary.kinds.includes('speaker-shift')
        ? t('sceneCue.speakerShift')
        : boundary.kinds.includes('topic-shift')
            ? t('sceneCue.topicShift')
            : t('sceneCue.newScene');

    return (
        <div
            data-testid="scene-cue"
            className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
        >
            <span className="animate-in fade-in-0 slide-in-from-top-1 duration-300 rounded-full border border-border/40 bg-background/70 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm">
                {label}
            </span>
        </div>
    );
}
