import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatComposer, ChatMessage, ChatMessageBubble, ChatMessageList } from '@astryxdesign/core/Chat';
import { Text } from '@astryxdesign/core/Text';
import { Loader2, MessageCircle, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import { usePlayer } from '@/fronted/features/player/playerStore';
import {
    normalizeDialogueText,
    resolveNextPartnerLine,
    type RolePlaySubtitleLine,
} from '@/common/learning/rolePlayDialogue';
import type {
    LearningRecapRolePlayVO,
    RetellLevel,
    RolePlayTurnResultVO,
    RolePlayTurnVO,
} from '@/common/types/learningRecap';
import { cn } from '@/fronted/lib/utils';

/** 多轮对话最多保留的轮次；超过后不再继续，避免字幕被无限消耗。 */
const MAX_TURNS = 6;

/**
 * 多轮场景对话。
 *
 * 对方台词只从当前视频的真实字幕里取：开场白用复盘给出的真实字幕句，
 * 后续每一句由 `resolveNextPartnerLine` 沿字幕向后挑选。模型只负责点评，
 * 不参与生成台词，因此对话不会出现字幕里没有的句子。
 */
export default function RolePlayDialogue({
    rolePlay,
    videoId,
    fileHash,
    locale,
}: {
    rolePlay: LearningRecapRolePlayVO;
    videoId?: string;
    fileHash?: string;
    locale: 'zh-CN' | 'en-US';
}) {
    const { t } = useTranslation('recap');
    // 字幕来自播放器当前已解析的结果：不额外请求后端，也不会与播放进度脱节。
    const sentences = usePlayer((state) => state.sentences);
    const [draft, setDraft] = useState('');
    // 轮次、提交态与错误均按会话键作用域化：切到另一个会话时自动归位，不在 effect 里同步 setState。
    const [submittingKey, setSubmittingKey] = useState<string | null>(null);
    const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
    const [sessionState, setSessionState] = useState<{
        key: string;
        turns: RolePlayTurnVO[];
        restored: boolean;
    }>({ key: '', turns: [], restored: false });
    const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
    const submitEpochRef = useRef(0);

    const lines = useMemo<RolePlaySubtitleLine[]>(
        () => sentences.map((sentence) => ({ index: sentence.index, text: sentence.text })),
        [sentences],
    );

    // 会话键按「视频 + 开场白」派生：同一部视频的同一段对话重开弹窗后仍能续聊。
    const sessionKey = useMemo(() => {
        const anchor = normalizeDialogueText(rolePlay.openingLine).slice(0, 80);
        return `roleplay:${videoId ?? fileHash ?? 'unknown'}:${anchor}`;
    }, [rolePlay.openingLine, videoId, fileHash]);

    // 重开弹窗时恢复已发生的轮次；失败只是丢掉历史，不影响继续对话。
    useEffect(() => {
        let cancelled = false;
        submitEpochRef.current += 1;
        void learningDataApi.getRolePlaySession({ sessionKey, videoId, fileHash })
            .then((session) => {
                if (!cancelled) {
                    setSessionState({ key: sessionKey, turns: session.turns, restored: true });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSessionState({ key: sessionKey, turns: [], restored: true });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [sessionKey, videoId, fileHash]);

    const submitting = submittingKey === sessionKey;
    const error = errorState?.key === sessionKey ? errorState.message : null;

    // 会话切换后、恢复完成前一律当作「还没有轮次且仍在恢复」，避免闪现上一个会话的对话。
    const activeSession = sessionState.key === sessionKey
        ? sessionState
        : { key: sessionKey, turns: [], restored: false };
    const turns = activeSession.turns;
    const restored = activeSession.restored;

    const usedPartnerLines = useMemo(
        () => turns.map((turn) => turn.partnerLine),
        [turns],
    );
    const nextLine = useMemo(
        () => resolveNextPartnerLine(lines, rolePlay.openingLine, usedPartnerLines),
        [lines, rolePlay.openingLine, usedPartnerLines],
    );
    const reachedLimit = turns.length >= MAX_TURNS;
    const canReply = restored && !reachedLimit && nextLine.canContinue;

    useEffect(() => {
        scrollAnchorRef.current?.scrollIntoView({ block: 'nearest' });
    }, [turns.length, submitting]);

    /**
     * 提交一轮：点评由后端给出，台词由本地字幕决定。
     */
    const handleSubmit = async (value: string) => {
        const response = value.trim();
        const partnerLine = nextLine.next;
        if (!response || !partnerLine || submitting) {
            return;
        }
        const submitEpoch = ++submitEpochRef.current;
        setSubmittingKey(sessionKey);
        setErrorState(null);
        try {
            const result: RolePlayTurnResultVO = await learningDataApi.evaluateRolePlayTurn({
                sessionKey,
                scenario: rolePlay.scenario,
                partnerLine: partnerLine.text,
                partnerIndex: partnerLine.index,
                response,
                targetExpressions: rolePlay.targetExpressions.map((item) => item.text),
                previousTurns: turns.map((turn) => ({
                    partnerLine: turn.partnerLine,
                    response: turn.response,
                })),
                locale,
                videoId,
                fileHash,
            });
            if (submitEpochRef.current !== submitEpoch) {
                return;
            }
            setSessionState({
                key: sessionKey,
                restored: true,
                turns: [...turns, {
                    turn: result.turn,
                    partnerLine: partnerLine.text,
                    partnerIndex: partnerLine.index,
                    response,
                    level: result.level,
                    feedback: result.feedback,
                    improved: result.improved,
                    usedExpressions: result.usedExpressions,
                    source: result.source,
                }],
            });
            setDraft('');
        } catch {
            if (submitEpochRef.current !== submitEpoch) {
                return;
            }
            setErrorState({ key: sessionKey, message: t('rolePlayFailed') });
        } finally {
            if (submitEpochRef.current === submitEpoch) {
                setSubmittingKey((cur) => (cur === sessionKey ? null : cur));
            }
        }
    };

    return (
        <section
            data-testid="learning-role-play-dialogue"
            className="rounded-xl border border-border/60 bg-card px-3.5 py-3"
        >
            <div className="flex items-center gap-1.5">
                <MessageCircle className="h-3.5 w-3.5 text-accent" />
                <span className="text-metadata font-semibold uppercase tracking-wider text-secondary">
                    {t('rolePlayTitle')}
                </span>
                <span className="ml-auto text-metadata tabular-nums text-secondary/70">
                    {t('rolePlayTurnCount', { count: turns.length, max: MAX_TURNS })}
                </span>
            </div>
            <p className="mt-1.5 text-metadata leading-relaxed text-secondary">
                {rolePlay.scenario || t('rolePlayScenarioFallback')}
            </p>

            <ChatMessageList density="compact" align="top" gap={1.5} className="mt-2">
                <ChatMessage sender="assistant">
                    <ChatMessageBubble>
                        {rolePlay.openingLine}
                    </ChatMessageBubble>
                </ChatMessage>
                {turns.map((turn) => (
                    <RolePlayTurnMessages key={`${turn.turn}-${turn.partnerLine}`} turn={turn} />
                ))}
                {submitting && (
                    <ChatMessage sender="assistant">
                        <ChatMessageBubble variant="ghost">
                            <span className="flex items-center gap-1.5 text-metadata text-secondary">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {t('checkingRolePlay')}
                            </span>
                        </ChatMessageBubble>
                    </ChatMessage>
                )}
            </ChatMessageList>
            <div ref={scrollAnchorRef} />

            {rolePlay.targetExpressions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {rolePlay.targetExpressions.map((item) => (
                        <span
                            key={item.text}
                            title={item.meaning}
                            className="rounded-md bg-accent-muted/40 px-1.5 py-0.5 text-metadata font-medium text-accent"
                        >
                            {item.text}
                        </span>
                    ))}
                </div>
            )}

            {canReply ? (
                <div className="mt-2.5" data-testid="learning-role-play-composer">
                    <ChatComposer
                        value={draft}
                        onChange={setDraft}
                        onSubmit={(value) => { void handleSubmit(value); }}
                        placeholder={t('rolePlayPlaceholder')}
                        density="compact"
                        elevation="none"
                        isDisabled={submitting}
                        status={error ? { type: 'error', message: error } : undefined}
                    />
                </div>
            ) : (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                    <Text type="supporting" color="secondary">
                        {restored
                            ? reachedLimit
                                ? t('rolePlayTurnLimit', { max: MAX_TURNS })
                                : t('rolePlayEnded')
                            : t('rolePlayRestoring')}
                    </Text>
                </div>
            )}

            {turns.length > 0 && (
                <button
                    type="button"
                    data-testid="learning-role-play-restart"
                    disabled={submitting}
                    onClick={() => {
                        if (submitting) return;
                        submitEpochRef.current += 1;
                        setSessionState({ key: sessionKey, turns: [], restored: true });
                        setDraft('');
                        setErrorState(null);
                    }}
                    className="mt-2 flex h-7 items-center gap-1.5 rounded-lg px-2 text-metadata text-secondary transition-colors hover:bg-muted/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RotateCcw className="h-3 w-3" />
                    {t('rolePlayRestart')}
                </button>
            )}
        </section>
    );
}

/**
 * 一轮对话：学习者的回应、对方的下一句、以及这一轮的点评。
 */
function RolePlayTurnMessages({ turn }: { turn: RolePlayTurnVO }) {
    const { t } = useTranslation('recap');
    const levelLabel = turn.level === 'great'
        ? t('rolePlayLevelGreat')
        : turn.level === 'good'
            ? t('rolePlayLevelGood')
            : t('rolePlayLevelRetry');

    return (
        <>
            <ChatMessage sender="user">
                <ChatMessageBubble>{turn.response}</ChatMessageBubble>
            </ChatMessage>
            <ChatMessage sender="assistant">
                <ChatMessageBubble variant="ghost" width="100%">
                    <RolePlayTurnFeedback
                        level={turn.level}
                        levelLabel={levelLabel}
                        feedback={turn.feedback}
                        improved={turn.improved}
                        usedExpressions={turn.usedExpressions}
                        source={turn.source}
                    />
                </ChatMessageBubble>
            </ChatMessage>
        </>
    );
}

/**
 * 单轮点评：等级、点评、用上的表达与更自然的说法。
 */
function RolePlayTurnFeedback({
    level,
    levelLabel,
    feedback,
    improved,
    usedExpressions,
    source,
}: {
    level: RetellLevel;
    levelLabel: string;
    feedback: string;
    improved: string;
    usedExpressions: string[];
    source: 'ai' | 'local';
}) {
    const { t } = useTranslation('recap');
    const localFeedback = level === 'great'
        ? t('rolePlayLocalFeedbackGreat')
        : level === 'good'
            ? t('rolePlayLocalFeedbackGood')
            : t('rolePlayLocalFeedbackRetry');

    return (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <span
                    className={cn(
                        'rounded-md px-1.5 py-0.5 text-metadata font-medium',
                        level === 'great' && 'bg-success/10 text-success-text',
                        level === 'good' && 'bg-warning-muted/60 text-warning-text',
                        level === 'retry' && 'bg-muted text-secondary',
                    )}
                >
                    {levelLabel}
                </span>
                <span className="text-metadata text-secondary">
                    {source === 'ai'
                        ? t('rolePlaySourceAi')
                        : feedback
                            ? t('rolePlaySourceLocalModel')
                            : t('rolePlaySourceLocal')}
                </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-primary select-text">
                {feedback || localFeedback}
            </p>
            {usedExpressions.length > 0 && (
                <p className="mt-1 text-metadata leading-relaxed text-secondary">
                    {t('rolePlayUsedExpressions')}: {usedExpressions.join(' · ')}
                </p>
            )}
            {improved && (
                <p className="mt-1 text-metadata leading-relaxed text-secondary">
                    {t('rolePlayImprovedTitle')}: <span className="text-primary">{improved}</span>
                </p>
            )}
        </div>
    );
}
