import { useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@astryxdesign/core/Button';
import type { SentencePracticeResultVO } from '@/common/contracts/sentence-practice';
import {
    buildSentenceFromSlotAnswers,
    evaluateSlotTypingChars,
    extractPracticeWordSlots,
    isSlotWordMatch,
    parsePracticePromptTokens,
} from '@/common/utils/practice/practicePromptTokens';
import { cn } from '@/fronted/lib/utils';
import { playSentencePassCue, playWordMatchCue, playWordMissCue } from '../audioFeedback';
import type { PracticeUnit } from '../practiceUnit';
import DictationCompletedView from './DictationCompletedView';

interface WordSlotDictationProps {
    unit: PracticeUnit;
    result: SentencePracticeResultVO | null;
    peekingSpoiler: boolean;
    translationText: string;
    onPeekChange: (peeking: boolean) => void;
    onReplay: () => void;
    onSlowReplay: () => void;
    onSubmitSentence: (typedSentence: string) => Promise<void>;
    onRetry: () => void;
    onNextSentence: () => void;
}

/**
 * 词槽即时听写组件（心流默认流派）。
 *
 * 将真实受控输入框直接内嵌叠加在当前激活词槽之上，兼顾实时逐字着色与系统输入法光标跟随：
 * - 按词展示下划线槽位 + 保留只读标点骨架；
 * - 敲完一词按空格：拼对则变绿锁定并跳向下一空槽；有误则保留橙色草稿并顺滑跳向下一空槽（不卡死听写流）；
 * - 空槽按空格可跳过当前未听清的词；`Backspace` 可退回修改上一词；
 * - `/` 提示当前词下一字母；按住 `\` 临时透视参考；`Alt+R` / `Alt+Shift+R` 重播原音与 0.75× 慢听。
 */
export default function WordSlotDictation({
    unit,
    result,
    peekingSpoiler,
    translationText,
    onPeekChange,
    onReplay,
    onSlowReplay,
    onSubmitSentence,
    onRetry,
    onNextSentence,
}: WordSlotDictationProps) {
    const { t } = useTranslation('practice');
    const tokens = useMemo(() => parsePracticePromptTokens(unit.text), [unit.text]);
    const slots = useMemo(() => extractPracticeWordSlots(unit.text), [unit.text]);

    const [activeIdx, setActiveIdx] = useState(0);
    const [drafts, setDrafts] = useState<string[]>(() => slots.map(() => ''));
    const [locked, setLocked] = useState<boolean[]>(() => slots.map(() => false));
    const [hintedCount, setHintedCount] = useState(0);
    const [shakeIdx, setShakeIdx] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const composingRef = useRef(false);

    const focusInput = (): void => {
        if (!result) {
            inputRef.current?.focus();
        }
    };

    useEffect(() => {
        if (!result) {
            inputRef.current?.focus();
        }
    }, [activeIdx, result, unit.key]);

    const findNextUnlocked = (fromIdx: number, nextLocked: boolean[]): number => {
        for (let i = fromIdx + 1; i < nextLocked.length; i += 1) {
            if (!nextLocked[i]) return i;
        }
        return nextLocked.findIndex((done) => !done);
    };

    const submitSlots = async (nextDrafts: string[], nextLocked: boolean[]): Promise<void> => {
        if (submitting || slots.length === 0) return;
        const assembled = buildSentenceFromSlotAnswers(slots, nextDrafts, nextLocked);
        if (!assembled.trim()) {
            onReplay();
            return;
        }
        setSubmitting(true);
        try {
            await onSubmitSentence(assembled);
            playSentencePassCue();
        } finally {
            setSubmitting(false);
        }
    };

    /**
     * 处理当前激活词槽的空格确认或跳过：
     * - 拼对：绿锁当前槽并跳下一未锁槽（全部锁定时自动交卷）；
     * - 拼错：保留橙色草稿与误字高亮，轻微提示后仍顺畅推进到下一未完成槽（避免单字卡死）；
     * - 空槽：跳向下一未锁槽以便继续听写后续词。
     */
    const verifyOrAdvanceSlot = (candidate: string): void => {
        const slot = slots[activeIdx];
        if (!slot) return;
        const clean = candidate.trim();

        if (!clean) {
            const nextEmptyIdx = findNextUnlocked(activeIdx, locked);
            if (nextEmptyIdx !== -1 && nextEmptyIdx !== activeIdx) {
                setShakeIdx(null);
                setActiveIdx(nextEmptyIdx);
            }
            return;
        }

        if (isSlotWordMatch(clean, slot)) {
            const nextLocked = [...locked];
            nextLocked[activeIdx] = true;
            const nextDrafts = [...drafts];
            nextDrafts[activeIdx] = slot.text;
            setLocked(nextLocked);
            setDrafts(nextDrafts);
            setShakeIdx(null);

            const nextIdx = findNextUnlocked(activeIdx, nextLocked);
            if (nextIdx === -1) {
                void submitSlots(nextDrafts, nextLocked);
            } else {
                playWordMatchCue();
                setActiveIdx(nextIdx);
            }
            return;
        }

        // 有出入时不阻塞听写流：写回误拼草稿，轻微提示后滑向下一个空槽（末槽则留原地待改或 Enter 提交）
        const nextDrafts = [...drafts];
        nextDrafts[activeIdx] = clean;
        setDrafts(nextDrafts);
        playWordMissCue();
        setShakeIdx(activeIdx);

        for (let i = activeIdx + 1; i < slots.length; i += 1) {
            if (!locked[i]) {
                setActiveIdx(i);
                return;
            }
        }
    };

    const revealLetterHint = (): void => {
        const slot = slots[activeIdx];
        if (!slot) return;
        const expected = slot.text;
        const current = drafts[activeIdx] ?? '';
        let prefixLen = 0;
        while (
            prefixLen < current.length
            && prefixLen < expected.length
            && current[prefixLen].toLowerCase() === expected[prefixLen].toLowerCase()
        ) {
            prefixLen += 1;
        }
        const revealTo = Math.min(expected.length, prefixLen + 1);
        const nextDrafts = [...drafts];
        nextDrafts[activeIdx] = expected.slice(0, revealTo);
        setDrafts(nextDrafts);
        setHintedCount((n) => n + 1);
        focusInput();
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
        const pasted = e.clipboardData.getData('text').trim();
        if (!pasted || !/\s/.test(pasted)) return;
        e.preventDefault();
        const words = pasted.split(/\s+/);
        const nextDrafts = [...drafts];
        const nextLocked = [...locked];
        let cursor = activeIdx;
        for (const piece of words) {
            while (cursor < slots.length && nextLocked[cursor]) {
                cursor += 1;
            }
            if (cursor >= slots.length) break;
            if (isSlotWordMatch(piece, slots[cursor])) {
                nextLocked[cursor] = true;
                nextDrafts[cursor] = slots[cursor].text;
            } else {
                nextDrafts[cursor] = piece;
            }
            cursor += 1;
        }
        setDrafts(nextDrafts);
        setLocked(nextLocked);
        const nextIdx = findNextUnlocked(activeIdx - 1, nextLocked);
        if (nextIdx === -1) {
            void submitSlots(nextDrafts, nextLocked);
        } else {
            setActiveIdx(nextIdx);
        }
    };

    if (result) {
        return (
            <DictationCompletedView
                unit={unit}
                result={result}
                translationText={translationText}
                hintedCount={hintedCount}
                onRetry={onRetry}
                onNextSentence={onNextSentence}
            />
        );
    }

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        if ((e.key === 'r' || e.key === 'R') && e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) onSlowReplay();
            else onReplay();
            return;
        }
        if (e.key === '\\') {
            e.preventDefault();
            if (!e.repeat) onPeekChange(true);
            return;
        }
        if (e.key === '/') {
            e.preventDefault();
            revealLetterHint();
            return;
        }
        if (e.key === 'ArrowRight' && (drafts[activeIdx] ?? '') === '') {
            const nextIdx = findNextUnlocked(activeIdx, locked);
            if (nextIdx !== -1 && nextIdx !== activeIdx) {
                e.preventDefault();
                setActiveIdx(nextIdx);
            }
            return;
        }
        if (e.key === 'ArrowLeft' && (drafts[activeIdx] ?? '') === '' && activeIdx > 0) {
            e.preventDefault();
            const prevIdx = activeIdx - 1;
            if (locked[prevIdx]) {
                const nextLocked = [...locked];
                nextLocked[prevIdx] = false;
                setLocked(nextLocked);
            }
            setActiveIdx(prevIdx);
            return;
        }
        const curVal = drafts[activeIdx] ?? '';
        const isSpaceKey = e.key === ' ' || e.code === 'Space';
        const isCjkComposing = composingRef.current && /[^\u0020-\u007E]/.test(curVal);
        if (isSpaceKey && !isCjkComposing) {
            e.preventDefault();
            if (!e.repeat || curVal.trim().length > 0) {
                verifyOrAdvanceSlot(curVal);
            }
            return;
        }
        if (e.key === 'Backspace' && curVal === '' && activeIdx > 0) {
            e.preventDefault();
            const prevIdx = activeIdx - 1;
            if (locked[prevIdx]) {
                const nextLocked = [...locked];
                nextLocked[prevIdx] = false;
                setLocked(nextLocked);
            }
            setActiveIdx(prevIdx);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                void submitSlots(drafts, locked);
                return;
            }
            const slot = slots[activeIdx];
            const clean = curVal.trim();
            if (slot && clean.length > 0 && isSlotWordMatch(clean, slot)) {
                verifyOrAdvanceSlot(clean);
            } else {
                void submitSlots(drafts, locked);
            }
        }
    };

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- 点击词槽容器聚焦内嵌输入框
        <div
            className="relative flex flex-col gap-3 cursor-text"
            onClick={focusInput}
        >
            {/* 词槽矩阵 + 静态标点骨架；当前词槽内直接内嵌透明输入框对齐原生光标与 IME */}
            <div className="flex flex-wrap items-baseline text-lg leading-[2.2] font-medium text-foreground select-none">
                {tokens.map((token, idx) => {
                    if (token.kind === 'gap') {
                        return <span key={`slot-gap-${idx}`} className="whitespace-pre">{token.text}</span>;
                    }
                    if (token.kind === 'punctuation') {
                        return (
                            <span key={`slot-punct-${idx}`} className="text-muted-foreground whitespace-pre">
                                {token.text}
                            </span>
                        );
                    }

                    const i = token.slotIndex;
                    const isLocked = locked[i];
                    const isActive = i === activeIdx;
                    const draft = drafts[i] ?? '';
                    const minCh = Math.max(2.5, Math.min(token.text.length + 0.5, 14));
                    const charFeedback = evaluateSlotTypingChars(draft, token.text);
                    const hasDraftMismatch = draft.length > 0 && !isLocked && !isSlotWordMatch(draft, token);

                    if (isActive) {
                        return (
                            <span
                                key={`slot-active-${unit.key}-${i}`}
                                style={{ minWidth: `${Math.max(minCh, draft.length + 1)}ch` }}
                                className={cn(
                                    'relative inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-center border-b-2 border-accent bg-accent/10 text-foreground',
                                    shakeIdx === i && 'practice-shake',
                                )}
                            >
                                {/* 与透明输入框同字号同字距的镜像层，承担逐字正误着色 */}
                                <span aria-hidden className="pointer-events-none tracking-wide whitespace-pre">
                                    {draft.length > 0 ? (
                                        charFeedback.map((cf, cIdx) => (
                                            <span
                                                key={cIdx}
                                                className={cf.correct ? 'text-foreground' : 'text-error-text underline decoration-error'}
                                            >
                                                {cf.char}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-transparent">{token.text.replace(/./g, '_')}</span>
                                    )}
                                </span>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    aria-label={t('dictation.placeholder')}
                                    value={draft}
                                    onClick={(ev) => ev.stopPropagation()}
                                    onCompositionStart={() => { composingRef.current = true; }}
                                    onCompositionEnd={(e) => {
                                        composingRef.current = false;
                                        const committed = e.currentTarget.value;
                                        if (/[\s\u3000]$/.test(committed)) {
                                            verifyOrAdvanceSlot(committed);
                                            return;
                                        }
                                        const nextDrafts = [...drafts];
                                        nextDrafts[activeIdx] = committed;
                                        setDrafts(nextDrafts);
                                    }}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        // 兼容各类系统键盘/IME直接随字母带入尾随空格
                                        if (/[\s\u3000]$/.test(val)) {
                                            composingRef.current = false;
                                            verifyOrAdvanceSlot(val);
                                            return;
                                        }
                                        const nextDrafts = [...drafts];
                                        nextDrafts[activeIdx] = val;
                                        setDrafts(nextDrafts);
                                    }}
                                    onKeyDown={handleInputKeyDown}
                                    onKeyUp={(e) => {
                                        if (e.key === '\\') {
                                            onPeekChange(false);
                                        }
                                    }}
                                    onBlur={() => onPeekChange(false)}
                                    onPaste={handlePaste}
                                    className="absolute inset-0 h-full w-full border-0 bg-transparent px-1.5 text-center font-medium tracking-wide text-transparent caret-accent outline-none selection:bg-accent/25"
                                />
                            </span>
                        );
                    }

                    return (
                        <button
                            key={`slot-${unit.key}-${i}`}
                            type="button"
                            tabIndex={-1}
                            onClick={(ev) => {
                                ev.stopPropagation();
                                if (isLocked) {
                                    const nextLocked = [...locked];
                                    nextLocked[i] = false;
                                    setLocked(nextLocked);
                                }
                                setActiveIdx(i);
                            }}
                            style={{ minWidth: `${minCh}ch` }}
                            className={cn(
                                'inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-center transition-colors cursor-text',
                                shakeIdx === i && 'practice-shake',
                                isLocked
                                    ? 'border-b-2 border-success/60 text-success-text bg-success/8'
                                    : hasDraftMismatch
                                        ? 'border-b-2 border-warning/75 text-warning-text bg-warning-muted/50'
                                        : draft.length > 0
                                            ? 'border-b-2 border-input text-foreground bg-muted/40'
                                            : 'border-b-2 border-border/80 text-muted-foreground/60 hover:border-input',
                            )}
                        >
                            {isLocked ? (
                                <span>{token.text}</span>
                            ) : draft.length > 0 ? (
                                <span className="tracking-wide">
                                    {charFeedback.map((cf, cIdx) => (
                                        <span
                                            key={cIdx}
                                            className={cf.correct ? undefined : 'text-error-text underline decoration-error'}
                                        >
                                            {cf.char}
                                        </span>
                                    ))}
                                </span>
                            ) : (
                                <span aria-hidden className="text-transparent">{token.text.replace(/./g, '_')}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {peekingSpoiler && (
                <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground">
                    <span>{unit.text}</span>
                    {translationText ? <span className="ml-2 text-metadata opacity-80">· {translationText}</span> : null}
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Lightbulb className="h-3.5 w-3.5" />}
                        label={t('dictation.hintLetter', { defaultValue: '提示一字母 (/)' })}
                        onClick={(e) => {
                            e.stopPropagation();
                            revealLetterHint();
                        }}
                    />
                </div>
                <Button
                    variant="primary"
                    size="sm"
                    isLoading={submitting}
                    icon={<Send className="h-3.5 w-3.5" />}
                    label={t('dictation.submit')}
                    onClick={(e) => {
                        e.stopPropagation();
                        void submitSlots(drafts, locked);
                    }}
                />
            </div>
        </div>
    );
}
