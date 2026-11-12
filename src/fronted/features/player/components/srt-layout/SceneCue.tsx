import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    type SceneBoundary,
    type SceneSentence,
} from '@/common/learning/sceneSegmentation';
import type { Sentence } from '@/common/types/SentenceC';
import useSetting from '@/fronted/features/settings/settingsStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';

/**
 * 主字幕上方的轻量场景提示。
 *
 * 只在当前句命中本地场景边界时出现，绝对定位、不参与字幕排版，
 * 因此不会改变中英文字幕的居中位置，也不会因提示出现/消失造成抖动。
 *
 * 边界由后端按「字幕哈希 + 算法版本」持久化：首次进入某部视频时计算一次，
 * 之后直接命中索引，不必每次重新遍历整份字幕。
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
    // 视频路径让后端可以用真实声纹判定换人；没有视频时退回纯文本启发式。
    const videoPath = usePlaybackSession((state) => state.videoPath);

    // 只把影响切分的字段发给后端；译文与翻译分组不参与判定，也不必跨进程传输。
    const sceneSentences = useMemo<SceneSentence[]>(() => sentences.map((sentence) => ({
        fileHash: sentence.fileHash,
        index: sentence.index,
        start: sentence.start,
        end: sentence.end,
        text: sentence.text,
    })), [sentences]);

    const fileHash = sceneSentences[0]?.fileHash ?? null;

    // 请求键与结果绑定：键变化时旧结果自动失效，无需在 effect 里同步清空状态。
    // 视频路径参与键：同一份字幕被不同视频复用（极少见）时也要重新取声纹。
    const requestKey = enabled && sceneSentences.length >= 2 && fileHash
        ? `${fileHash}:${sceneSentences.length}:${videoPath ?? ''}`
        : null;
    const [loaded, setLoaded] = useState<{ key: string; boundaries: SceneBoundary[] } | null>(null);
    const boundaries = useMemo<SceneBoundary[]>(
        () => (requestKey && loaded?.key === requestKey ? loaded.boundaries : []),
        [requestKey, loaded],
    );

    useEffect(() => {
        if (!requestKey) {
            return;
        }
        let cancelled = false;
        playerApi.getSceneBoundaries(sceneSentences, videoPath ?? undefined)
            .then((result) => {
                if (!cancelled) {
                    setLoaded({ key: requestKey, boundaries: result });
                }
            })
            .catch(() => {
                // 场景提示是可选增强，取不到就静默隐藏，不回退到前端重算。
                if (!cancelled) {
                    setLoaded({ key: requestKey, boundaries: [] });
                }
            });
        return () => {
            cancelled = true;
        };
        // 同一字幕内切换当前句不应重新请求；键已覆盖字幕与句数变化。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestKey, videoPath]);

    const boundaryByIndex = useMemo(() => {
        if (!enabled || boundaries.length === 0) {
            return new Map<number, SceneBoundary>();
        }
        const map = new Map<number, SceneBoundary>();
        for (const boundary of boundaries) {
            map.set(boundary.sentenceIndex, boundary);
        }
        return map;
    }, [enabled, boundaries]);

    const boundary = currentSentence
        ? boundaryByIndex.get(currentSentence.index)
        : undefined;
    if (!boundary) {
        return null;
    }

    const label = boundary.kinds.includes('speaker-shift')
        ? t('sceneCue.speakerShift')
        : boundary.kinds.includes('visual-shift')
            ? t('sceneCue.visualShift')
            : boundary.kinds.includes('prosody-shift')
                ? t('sceneCue.prosodyShift')
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
