import { useState } from 'react';
import type { ReactNode } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Loader2, Mic, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { toast } from 'react-hot-toast';

import type {
    LearningRecapVO,
    ProductionPracticeMode,
    ProductionPracticeRecordVO,
    RetellEvaluationVO,
    RetellLevel,
} from '@/common/types/learningRecap';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import { usePracticeRecorder } from '@/fronted/features/practice/usePracticeRecorder';
import type { PracticeRecorderPhase } from '@/fronted/features/practice/lib/recorder-phase';
import { cn } from '@/fronted/lib/utils';
import RolePlayDialogue from './RolePlayDialogue';

/** 学习复盘弹窗入参。 */
export interface LearningRecapDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    videoId?: string;
    fileHash?: string;
    /** 会话开始时间（ISO 8601）。 */
    since: string;
    locale: 'zh-CN' | 'en-US';
}

/**
 * 学习复盘弹窗。
 *
 * 打开时才请求复盘，避免每次播放结束或悬浮都触发推理。
 */
export default function LearningRecapDialog({
    open,
    onOpenChange,
    videoId,
    fileHash,
    since,
    locale,
}: LearningRecapDialogProps) {
    const { t } = useTranslation('recap');
    return (
        <Dialog
            isOpen={open}
            onOpenChange={onOpenChange}
            purpose="form"
            width={560}
            padding={4}
        >
            {open ? (
                <div className="flex w-full flex-col gap-3">
                    <DialogHeader
                        title={t('title')}
                        subtitle={t('subtitle')}
                        startContent={<Sparkles className="h-4 w-4 text-accent" />}
                        onOpenChange={() => onOpenChange(false)}
                    />
                    <LearningRecapContent
                        videoId={videoId}
                        fileHash={fileHash}
                        since={since}
                        locale={locale}
                        onClose={() => onOpenChange(false)}
                    />
                </div>
            ) : null}
        </Dialog>
    );
}

/**
 * 复盘内容区，独立导出以便组件测试绕过弹窗 Portal。
 */
export function LearningRecapContent({
    videoId,
    fileHash,
    since,
    locale,
    onClose,
}: {
    videoId?: string;
    fileHash?: string;
    since: string;
    locale: 'zh-CN' | 'en-US';
    onClose: () => void;
}) {
    const { t } = useTranslation('recap');
    const [refreshing, setRefreshing] = useState(false);
    const [draft, setDraft] = useState('');
    const [retellResult, setRetellResult] = useState<RetellEvaluationVO | null>(null);
    const [retellLoading, setRetellLoading] = useState(false);
    const [retellError, setRetellError] = useState<string | null>(null);
    const [spokenTranscript, setSpokenTranscript] = useState<string | null>(null);

    const enabled = Boolean(videoId || fileHash);
    const summaryKey = enabled
        ? ['learning-data/recap', videoId, fileHash, since, locale] as const
        : null;
    const { data, error, isLoading, mutate } = useSWR<LearningRecapVO>(
        summaryKey,
        () => learningDataApi.getRecap({
            videoId,
            fileHash,
            since,
            locale,
        }),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    );
    // 上次练习结果：让落库的复述 / 角色扮演在下次打开时可见。
    const { data: practiceHistory, mutate: mutateHistory } = useSWR<ProductionPracticeRecordVO[]>(
        enabled ? ['learning-data/production-practice', videoId, fileHash] as const : null,
        () => learningDataApi.listProductionPractice({ videoId, fileHash, limit: 10 }),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    );
    const lastRetell = practiceHistory?.find((record) => record.mode === 'retell') ?? null;
    const lastRolePlay = practiceHistory?.find((record) => record.mode === 'roleplay') ?? null;

    /**
     * 绕过缓存重新生成，并用新结果替换 SWR 缓存。
     */
    const handleRefresh = async () => {
        if (refreshing || !enabled) return;
        setRefreshing(true);
        try {
            const next = await learningDataApi.getRecap({
                videoId,
                fileHash,
                since,
                locale,
                forceRefresh: true,
            });
            await mutate(next, { revalidate: false });
            setDraft('');
            setRetellResult(null);
            setRetellError(null);
            setSpokenTranscript(null);
        } catch {
            toast.error(t('loadFailed'));
        } finally {
            setRefreshing(false);
        }
    };

    /**
     * 提交复述；答案或原句变化后旧反馈立即失效。
     */
    const handleCheckRetell = async () => {
        const original = data?.sentence?.text;
        if (!original || !draft.trim() || retellLoading) {
            return;
        }
        setRetellLoading(true);
        setRetellError(null);
        try {
            const result = await learningDataApi.evaluateRetell({
                original,
                response: draft.trim(),
                locale,
                videoId,
                fileHash,
            });
            setRetellResult(result);
            void mutateHistory();
        } catch {
            setRetellError(t('retellFailed'));
        } finally {
            setRetellLoading(false);
        }
    };

    const handleDraftChange = (value: string) => {
        setDraft(value);
        if (retellResult) setRetellResult(null);
        if (retellError) setRetellError(null);
        if (spokenTranscript) setSpokenTranscript(null);
    };

    /**
     * 口头复述：录音交给本地 ASR 转写，再复用书面复述的评分与掌握度链路。
     *
     * 转写文本会回填到输入框：用户可以看清系统到底听到了什么，也方便直接改。
     */
    const handleSpokenRecording = async (audio: Uint8Array) => {
        const original = data?.sentence?.text;
        if (!original || retellLoading) {
            return;
        }
        setRetellLoading(true);
        setRetellError(null);
        try {
            const result = await learningDataApi.evaluateSpokenRetell({
                original,
                audio,
                locale,
                videoId,
                fileHash,
            });
            setRetellResult(result);
            setSpokenTranscript(result.transcript);
            setDraft(result.transcript);
            void mutateHistory();
        } catch {
            setRetellError(t('spokenRetellFailed'));
        } finally {
            setRetellLoading(false);
        }
    };

    const { phase: recorderPhase, start: startRecording, stop: stopRecording } = usePracticeRecorder({
        onRecordingComplete: handleSpokenRecording,
        active: Boolean(data?.sentence?.text),
        vadAutoStop: true,
    });

    return (
        <div className="flex w-full flex-col gap-3">
            <div className="-mr-1 max-h-[68vh] overflow-y-auto pr-1">
                {isLoading && !data ? (
                    <RecapSkeleton />
                ) : error ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-error/30 bg-error/5 px-4 py-8 text-center">
                        <p className="text-sm text-error-text">{t('loadFailed')}</p>
                        <button
                            type="button"
                            onClick={() => { void mutate(); }}
                            className="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-2 text-sm text-foreground transition-colors hover:bg-muted/60"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('retry')}
                        </button>
                    </div>
                ) : data ? (
                    <RecapBody
                        recap={data}
                        draft={draft}
                        retellResult={retellResult}
                        retellLoading={retellLoading}
                        retellError={retellError}
                        onDraftChange={handleDraftChange}
                        onCheckRetell={() => { void handleCheckRetell(); }}
                        spokenTranscript={spokenTranscript}
                        recorderPhase={recorderPhase}
                        onStartRecording={() => { void startRecording(); }}
                        onStopRecording={stopRecording}
                        lastRetell={lastRetell}
                        lastRolePlay={lastRolePlay}
                        videoId={videoId}
                        fileHash={fileHash}
                        locale={locale}
                        refreshing={refreshing}
                        onRefresh={() => { void handleRefresh(); }}
                    />
                ) : null}
            </div>

            <div className="flex justify-end pt-0.5">
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-7 items-center rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                    {t('close')}
                </button>
            </div>
        </div>
    );
}

/**
 * 复盘正文：总览、词、句、表达与复述区。
 */
function RecapBody({
    recap,
    draft,
    retellResult,
    retellLoading,
    retellError,
    onDraftChange,
    onCheckRetell,
    spokenTranscript,
    recorderPhase,
    onStartRecording,
    onStopRecording,
    lastRetell,
    lastRolePlay,
    videoId,
    fileHash,
    locale,
    refreshing,
    onRefresh,
}: {
    recap: LearningRecapVO;
    draft: string;
    retellResult: RetellEvaluationVO | null;
    retellLoading: boolean;
    retellError: string | null;
    onDraftChange: (value: string) => void;
    onCheckRetell: () => void;
    spokenTranscript: string | null;
    recorderPhase: PracticeRecorderPhase;
    onStartRecording: () => void;
    onStopRecording: () => void;
    lastRetell: ProductionPracticeRecordVO | null;
    lastRolePlay: ProductionPracticeRecordVO | null;
    videoId?: string;
    fileHash?: string;
    locale: 'zh-CN' | 'en-US';
    refreshing: boolean;
    onRefresh: () => void;
}) {
    const { t, i18n } = useTranslation('recap');

    if (recap.words.length === 0) {
        return (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-4 py-8 text-center">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
                <p className="text-metadata leading-relaxed text-muted-foreground">{t('emptyHint')}</p>
            </div>
        );
    }

    const headline = recap.headline || t('localHeadline', { count: recap.counts.encountered });

    return (
        <div className="space-y-3">
            <div className="flex items-start gap-2.5">
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">{headline}</p>
                <span
                    className={cn(
                        'shrink-0 rounded-md px-1.5 py-0.5 text-metadata font-medium',
                        recap.source === 'ai'
                            ? 'bg-accent-muted/50 text-accent'
                            : 'bg-muted text-muted-foreground',
                    )}
                >
                    {recap.source === 'ai' ? t('aiBadge') : t('localBadge')}
                </span>
                <button
                    type="button"
                    data-testid="learning-recap-refresh"
                    title={t('refresh')}
                    aria-label={t('refresh')}
                    disabled={refreshing}
                    onClick={onRefresh}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
                </button>
            </div>

            <section className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5">
                <SectionTitle>{t('wordsTitle')}</SectionTitle>
                <ul className="mt-1 divide-y divide-border/40">
                    {recap.words.map((word) => (
                        <li key={word.word} className="py-2 first:pt-0 last:pb-0">
                            <div className="flex items-baseline gap-2">
                                <span className="text-sm font-semibold text-foreground">{word.word}</span>
                                {word.translate && (
                                    <span className="text-metadata text-muted-foreground">{word.translate}</span>
                                )}
                            </div>
                            {word.note && (
                                <p className="mt-0.5 text-metadata leading-relaxed text-muted-foreground">
                                    {word.note}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            </section>

            {recap.sentence && (
                <section className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2.5">
                    <SectionTitle>{t('sentenceTitle')}</SectionTitle>
                    <p className="mt-1.5 text-sm leading-relaxed text-foreground select-text">
                        {recap.sentence.text}
                    </p>
                    {recap.sentence.note && (
                        <p className="mt-1 text-metadata leading-relaxed text-muted-foreground">
                            {recap.sentence.note}
                        </p>
                    )}
                </section>
            )}

            {recap.expression && (
                <section className="flex items-baseline gap-2 rounded-xl border border-border/60 bg-card px-3.5 py-2.5">
                    <span className="text-metadata font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('expressionTitle')}
                    </span>
                    <span className="text-sm font-medium text-foreground">{recap.expression.text}</span>
                    <span className="min-w-0 flex-1 text-metadata text-muted-foreground">
                        {recap.expression.meaning}
                    </span>
                </section>
            )}

            {recap.sentence && (
                <section className="rounded-xl border border-border/60 bg-card px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                        <Mic className="h-3.5 w-3.5 text-accent" />
                        <SectionTitle>{t('speakingTitle')}</SectionTitle>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                        {recap.speakingTask || t('localSpeakingTask')}
                    </p>
                    <p className="mt-1 text-metadata leading-relaxed text-muted-foreground">
                        {t('speakingHint')}
                    </p>
                    {lastRetell && (
                        <p
                            data-testid="learning-last-retell"
                            className="mt-1 text-metadata text-muted-foreground/80"
                        >
                            {t('lastRetell', {
                                level: t(levelKey('retell', lastRetell.level)),
                                date: formatPracticeDate(lastRetell.createdAt, i18n?.language),
                            })}
                        </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            data-testid="learning-retell-record"
                            disabled={retellLoading || recorderPhase === 'processing'}
                            onClick={recorderPhase === 'recording' ? onStopRecording : onStartRecording}
                            className={cn(
                                'flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors',
                                recorderPhase === 'recording'
                                    ? 'border-error/40 bg-error/10 text-error-text'
                                    : 'border-border/70 text-foreground hover:bg-muted/60',
                                (retellLoading || recorderPhase === 'processing') && 'cursor-not-allowed opacity-60',
                            )}
                        >
                            {recorderPhase === 'processing' || retellLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Mic className="h-3.5 w-3.5" />
                            )}
                            {recorderPhase === 'recording'
                                ? t('stopSpokenRetell')
                                : retellLoading
                                    ? t('transcribing')
                                    : t('startSpokenRetell')}
                        </button>
                        <span className="text-metadata text-muted-foreground/70">
                            {t('spokenRetellHint')}
                        </span>
                    </div>
                    {spokenTranscript && (
                        <p
                            data-testid="learning-spoken-transcript"
                            className="mt-1.5 rounded-lg bg-muted/40 px-2.5 py-1.5 text-metadata leading-relaxed text-muted-foreground"
                        >
                            {t('spokenTranscript', { text: spokenTranscript })}
                        </p>
                    )}
                    <textarea
                        value={draft}
                        rows={3}
                        data-testid="learning-retell-input"
                        aria-label={t('speakingPlaceholder')}
                        aria-describedby={retellError ? 'learning-retell-error' : undefined}
                        placeholder={t('speakingPlaceholder')}
                        onChange={(event) => onDraftChange(event.currentTarget.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                onCheckRetell();
                            }
                        }}
                        className="mt-2 min-h-20 w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-accent-bg/50 focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <span
                            id="learning-retell-error"
                            role={retellError ? 'alert' : undefined}
                            className="text-metadata text-muted-foreground/70"
                        >
                            {retellError ?? ''}
                        </span>
                        <button
                            type="button"
                            data-testid="learning-retell-submit"
                            disabled={retellLoading || draft.trim().length === 0}
                            onClick={onCheckRetell}
                            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-accent-bg px-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-bg/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                        >
                            {retellLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Sparkles className="h-3.5 w-3.5" />
                            )}
                            {retellLoading ? t('checking') : t('checkRetell')}
                        </button>
                    </div>
                    {retellResult && (
                        <RetellFeedback result={retellResult} />
                    )}
                </section>
            )}

            {recap.rolePlay && (
                <>
                    {lastRolePlay && (
                        <p
                            data-testid="learning-last-role-play"
                            className="-mb-1 px-1 text-metadata text-muted-foreground/80"
                        >
                            {t('lastRolePlay', {
                                level: t(levelKey('roleplay', lastRolePlay.level)),
                                date: formatPracticeDate(lastRolePlay.createdAt, i18n?.language),
                            })}
                        </p>
                    )}
                    <RolePlayDialogue
                        rolePlay={recap.rolePlay}
                        videoId={videoId}
                        fileHash={fileHash}
                        locale={locale}
                    />
                </>
            )}
        </div>
    );
}

/**
 * 复述与角色扮演的等级共用同一批等级值，但文案分开。
 */
function levelKey(mode: ProductionPracticeMode, level: RetellLevel): string {
    const suffix = level === 'great' ? 'Great' : level === 'good' ? 'Good' : 'Retry';
    return mode === 'roleplay' ? `rolePlayLevel${suffix}` : `level${suffix}`;
}

/**
 * 兼容 SQLite 默认的 `YYYY-MM-DD HH:MM:SS`（UTC）与 ISO 字符串。
 */
function formatPracticeDate(value: string, locale?: string): string {
    const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale || undefined);
}

/**
 * 复述反馈：等级、点评、缺失关键词与更自然的说法。
 */
function RetellFeedback({ result }: { result: RetellEvaluationVO }) {
    const { t } = useTranslation('recap');
    const levelLabel = result.level === 'great'
        ? t('levelGreat')
        : result.level === 'good'
            ? t('levelGood')
            : t('levelRetry');
    const localFeedback = result.level === 'great'
        ? t('localFeedbackGreat')
        : result.level === 'good'
            ? t('localFeedbackGood')
            : t('localFeedbackRetry');

    return (
        <div
            data-testid="learning-retell-feedback"
            className="mt-3 rounded-xl border border-border/60 bg-muted/25 px-3 py-2.5"
        >
            <div className="flex flex-wrap items-center gap-1.5">
                <RetellLevelBadge level={result.level} label={levelLabel} />
                <span className="text-metadata text-muted-foreground">
                    {result.source === 'ai'
                        ? t('retellSourceAi')
                        : result.feedback
                            ? t('retellSourceLocalModel')
                            : t('retellSourceLocal')}
                </span>
                {result.totalKeywords > 0 && (
                    <span className="ml-auto text-metadata tabular-nums text-muted-foreground">
                        {t('coverage', {
                            matched: result.matchedKeywords,
                            total: result.totalKeywords,
                        })}
                    </span>
                )}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground select-text">
                {result.feedback || localFeedback}
            </p>
            {result.missingWords.length > 0 && (
                <p className="mt-1 text-metadata leading-relaxed text-muted-foreground">
                    {t('missingWords')}: {result.missingWords.join(' · ')}
                </p>
            )}
            {result.improved && (
                <div className="mt-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-2">
                    <div className="text-metadata font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('improvedTitle')}
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-foreground select-text">
                        {result.improved}
                    </p>
                </div>
            )}
        </div>
    );
}

/**
 * 复述等级徽标。
 */
function RetellLevelBadge({ level, label }: { level: RetellLevel; label: string }) {
    return (
        <span
            className={cn(
                'rounded-md px-1.5 py-0.5 text-metadata font-medium',
                level === 'great' && 'bg-success/10 text-success-text',
                level === 'good' && 'bg-warning-muted/60 text-warning-text',
                level === 'retry' && 'bg-muted text-muted-foreground',
            )}
        >
            {label}
        </span>
    );
}

/** 复盘加载骨架。 */
function RecapSkeleton() {
    return (
        <div className="space-y-3 py-1">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="rounded-xl border border-border/60 px-3.5 py-3">
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="mt-3 space-y-2">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-muted/70" />
                    <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
                </div>
            </div>
            <div className="h-24 animate-pulse rounded-xl border border-border/60 bg-muted/20" />
        </div>
    );
}

/** 小节标题。 */
function SectionTitle({ children }: { children: ReactNode }) {
    return (
        <span className="text-metadata font-semibold uppercase tracking-wider text-muted-foreground">
            {children}
        </span>
    );
}
