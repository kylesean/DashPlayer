import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useSWR from 'swr';

import {
    evaluateLearningMoment,
    pickDueWordForMoment,
    resolveMomentCadence,
    type LearningMomentMemory,
} from '@/common/learning/learningMoment';
import type { ContextPackVO } from '@/common/types/contextPack';
import type { Sentence } from '@/common/types/SentenceC';
import {
    VOCABULARY_GUIDANCE_LEVELS,
    type VocabularyGuidance,
} from '@/common/types/vocabulary';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { useLearningSessionSince } from '@/fronted/features/player/learningSessionStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import useSetting from '@/fronted/features/settings/settingsStore';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { revalidateReviewQueue } from '@/fronted/features/video-learning/reviewQueue';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { togglePlayerView } from '@/fronted/features/player/lib/player-view-controller';
import ContextSuggestionChip from './ContextSuggestionChip';
import LearningMomentChip from './LearningMomentChip';

const LEARNING_MOMENT_MEMORY_KEY = 'dashplayer:learning-moment:v1';

/**
 * 读取持久化的学习时刻限频记忆。
 *
 * 损坏或旧版本数据直接忽略，避免本地存储问题影响播放器。
 */
const readMomentMemory = (): LearningMomentMemory | null => {
    try {
        const raw = window.localStorage.getItem(LEARNING_MOMENT_MEMORY_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as Partial<LearningMomentMemory>;
        if (
            typeof parsed.at !== 'number'
            || !Number.isFinite(parsed.at)
            || typeof parsed.sentenceHash !== 'string'
            || typeof parsed.sessionKey !== 'string'
            || typeof parsed.count !== 'number'
            || !Number.isFinite(parsed.count)
        ) {
            return null;
        }
        return {
            at: parsed.at,
            sentenceHash: parsed.sentenceHash,
            sessionKey: parsed.sessionKey,
            count: Math.max(0, Math.trunc(parsed.count)),
        };
    } catch {
        return null;
    }
};

/**
 * 写入学习时刻限频记忆；写入失败时只影响限频，不影响复习。
 */
const writeMomentMemory = (memory: LearningMomentMemory): void => {
    try {
        window.localStorage.setItem(LEARNING_MOMENT_MEMORY_KEY, JSON.stringify(memory));
    } catch {
        // 本地存储不可用时静默降级。
    }
};

/**
 * 主字幕下方的学习提示位。
 *
 * 播放时保持原有的 ContextPack 建议；用户暂停并停留足够久时，如果当前句
 * 有到期的学习词，则改为一次低干扰到期词微回忆。两者共用同一个位置，
 * 不同时出现，避免在字幕下方堆叠操作。
 */
export default function SubtitleLearningHints({
    sentence,
}: {
    sentence: Sentence;
}) {
    const { t } = useTranslation('moment');
    const guidanceRaw = useSetting((state) => state.values.get('player.vocabularyGuidance'));
    const guidance: VocabularyGuidance = VOCABULARY_GUIDANCE_LEVELS.includes(
        guidanceRaw as VocabularyGuidance,
    )
        ? guidanceRaw as VocabularyGuidance
        : 'calm';
    const videoId = usePlaybackSession((state) => state.videoId);
    const srtHash = usePlaybackSession((state) => state.srtHash);
    const session = useLearningSessionSince(videoId, srtHash ?? sentence.fileHash);
    const playing = usePlayerState((state) => state.playing);
    const playRequestId = usePlayerState((state) => state.playRequestId);
    const paused = !playing;
    // off / calm 不主动提示，节奏为 null，整条链路直接跳过。
    const cadence = resolveMomentCadence(guidance);

    const sentenceHash = `${sentence.fileHash}:${sentence.index}`;
    const pauseKey = `${sentenceHash}:${playRequestId}`;
    const [dwell, setDwell] = useState<{ key: string; at: number } | null>(null);
    const [openForKey, setOpenForKey] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [dismissedKey, setDismissedKey] = useState<string | null>(null);
    const [memory, setMemory] = useState<LearningMomentMemory | null>(() => readMomentMemory());
    const [rememberedForKey, setRememberedForKey] = useState<string | null>(null);

    useEffect(() => {
        if (!paused || !cadence) {
            return;
        }
        const timer = window.setTimeout(() => {
            setDwell({ key: pauseKey, at: Date.now() });
        }, cadence.minDwellMs);
        return () => window.clearTimeout(timer);
    }, [cadence, pauseKey, paused]);

    const dwellAt = dwell?.key === pauseKey ? dwell.at : null;
    const enabled = paused && cadence !== null && dwellAt !== null;
    const isPanelOpen = openForKey === pauseKey;

    // 强度进入请求键：切换档位后候选排序可能变化，不能复用上一档的结果。
    const swrKey = enabled
        ? ['vocabulary/context-pack', sentence.fileHash, sentence.index, sentence.text, guidance] as const
        : null;
    const { data } = useSWR<ContextPackVO>(
        swrKey,
        () => videoLearningApi.contextPack({
            text: sentence.text,
            fileHash: sentence.fileHash,
            sentenceIndex: sentence.index,
            guidance,
        }),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
            dedupingInterval: 0,
        },
    );

    const candidate = useMemo(
        () => (data && dwellAt !== null && cadence
            ? pickDueWordForMoment(data.candidates, dwellAt, cadence.maxMastery)
            : null),
        [cadence, data, dwellAt],
    );
    const decision = useMemo(
        () => evaluateLearningMoment({
            paused: enabled,
            // 停留计时器已按当前节奏触发，这里只需表示「已满足停留」。
            dwellMs: enabled && cadence ? cadence.minDwellMs : 0,
            now: dwellAt ?? 0,
            sentenceHash,
            sessionKey: session.key,
            candidate,
            memory: isPanelOpen ? null : memory,
            ...(cadence ? { cadence } : {}),
        }),
        [cadence, candidate, dwellAt, enabled, isPanelOpen, memory, sentenceHash, session.key],
    );
    const visible = enabled
        && decision.shouldPrompt
        && decision.candidate !== null
        && dismissedKey !== sentenceHash;
    const open = isPanelOpen && visible;

    const rememberMoment = useCallback(() => {
        if (rememberedForKey === pauseKey) {
            return;
        }
        const sessionKey = session.key ?? '';
        const next: LearningMomentMemory = {
            at: Date.now(),
            sentenceHash,
            sessionKey,
            count: memory && memory.sessionKey === sessionKey
                ? memory.count + 1
                : 1,
        };
        setMemory(next);
        setRememberedForKey(pauseKey);
        writeMomentMemory(next);
    }, [memory, pauseKey, rememberedForKey, sentenceHash, session.key]);

    const dismissMoment = useCallback(() => {
        rememberMoment();
        setDismissedKey(sentenceHash);
        setOpenForKey(null);
    }, [rememberMoment, sentenceHash]);

    const handleOpenChange = (next: boolean): void => {
        setOpenForKey(next ? pauseKey : null);
        if (next) {
            rememberMoment();
        } else {
            setDismissedKey(sentenceHash);
        }
    };

    const handleRate = async (rating: 'again' | 'good'): Promise<void> => {
        if (!decision.candidate || pending) {
            return;
        }
        setPending(true);
        try {
            await videoLearningApi.rateReview(decision.candidate.word, rating, {
                videoId: videoId ?? undefined,
                fileHash: sentence.fileHash,
            });
            revalidateReviewQueue();
            setDismissedKey(sentenceHash);
            setOpenForKey(null);
            toast.success(t(rating === 'good' ? 'ratedGood' : 'ratedAgain'));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('rateFailed')}\n${message}`);
        } finally {
            setPending(false);
        }
    };

    /**
     * 从微回忆直接进入这句的跟读。
     *
     * 只有「强化」档才提供：此时用户已经选择专门的学习时段，把一次回忆推进
     * 到口语产出是合理的下一步。练习台会读取当前句，因此这里只需要切换视图，
     * 不再自己传句子。先暂停，避免原句声音混进录音。
     */
    const startShadowing = (): void => {
        rememberMoment();
        setDismissedKey(sentenceHash);
        setOpenForKey(null);
        const next = togglePlayerView('practice');
        if (next === 'practice') {
            playerActions.pause();
        }
    };

    if (!visible || !decision.candidate) {
        return <ContextSuggestionChip sentence={sentence} />;
    }

    return (
        <LearningMomentChip
            key={pauseKey}
            candidate={decision.candidate}
            open={open}
            pending={pending}
            onOpenChange={handleOpenChange}
            onDismiss={dismissMoment}
            onRate={(rating) => { void handleRate(rating); }}
            {...(guidance === 'intensive' ? { onStartShadowing: startShadowing } : {})}
        />
    );
}
