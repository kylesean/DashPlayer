import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SentencePracticeResultVO, SentencePracticeWordResult } from '@/common/contracts/sentence-practice';
import {
    parsePracticePromptTokens,
    type PracticeWordSlot,
} from '@/common/utils/practice/practicePromptTokens';
import { normalizePracticeTokens } from '@/common/utils/practice/pronunciationScoring';
import { cn } from '@/fronted/lib/utils';
import Word from '@/fronted/features/player/components/translatable-line/word';
import type { PracticeUnit } from '../practiceUnit';

interface PracticeDiffSentenceProps {
    unit: PracticeUnit;
    result?: SentencePracticeResultVO | null;
    /** 无评分解读时（如节拍跟读或尚未安装 ASR 的录音展示）呈现带划词查词的干净原句。 */
    className?: string;
}

interface SlotAlignmentSummary {
    status: SentencePracticeWordResult['status'];
    heardText: string | null;
}

function summarizeSlotAlignment(
    slot: PracticeWordSlot,
    expectedEntries: SentencePracticeWordResult[],
    cursor: { value: number },
): SlotAlignmentSummary {
    const subCount = Math.max(1, normalizePracticeTokens(slot.text).length);
    const slice = expectedEntries.slice(cursor.value, cursor.value + subCount);
    cursor.value += slice.length;
    if (slice.length === 0 || slice.every((entry) => entry.status === 'match')) {
        return { status: 'match', heardText: null };
    }
    if (slice.every((entry) => entry.status === 'missing')) {
        return { status: 'missing', heardText: null };
    }
    const heardJoined = slice
        .map((entry) => entry.heard)
        .filter((h): h is string => Boolean(h && h.trim()))
        .join(' ');
    return {
        status: 'sub',
        heardText: heardJoined || null,
    };
}

/**
 * 原句与逐词对齐差异的内联排版组件。
 *
 * 与旧版把每个正确词都包裹成绿色 Badge 的做法不同，正确词保持自然文本流，
 * 仅在错读/错写/漏缺位置轻量标注；所有原词保留划词/点击查词卡能力。
 */
export default function PracticeDiffSentence({ unit, result, className }: PracticeDiffSentenceProps) {
    const { t } = useTranslation('practice');
    const [popKey, setPopKey] = useState<string | null>(null);

    const tokens = useMemo(() => parsePracticePromptTokens(unit.text), [unit.text]);

    const lemmaMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const s of unit.sentences) {
            for (const block of s.struct?.blocks ?? []) {
                for (const part of block.blockParts) {
                    if (part.isWord && part.lemma) {
                        map.set(part.content.toLowerCase(), part.lemma);
                    }
                }
            }
        }
        return map;
    }, [unit.sentences]);

    const { slotAlignments, extraWords } = useMemo(() => {
        if (!result) {
            return { slotAlignments: new Map<number, SlotAlignmentSummary>(), extraWords: [] as SentencePracticeWordResult[] };
        }
        const expectedEntries = result.words.filter((w) => w.status !== 'extra');
        const extras = result.words.filter((w) => w.status === 'extra');
        const map = new Map<number, SlotAlignmentSummary>();
        const cursor = { value: 0 };
        for (const token of tokens) {
            if (token.kind !== 'word') continue;
            map.set(token.slotIndex, summarizeSlotAlignment(token, expectedEntries, cursor));
        }
        return { slotAlignments: map, extraWords: extras };
    }, [result, tokens]);

    const sentenceHash = `${unit.fileHash}:${unit.index}`;

    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <div className="text-lg leading-relaxed font-medium text-foreground select-text">
                {tokens.map((token, idx) => {
                    if (token.kind === 'gap') {
                        return <span key={`gap-${idx}`}>{token.text}</span>;
                    }
                    if (token.kind === 'punctuation') {
                        return (
                            <span key={`punct-${idx}`} className="text-muted-foreground">
                                {token.text}
                            </span>
                        );
                    }

                    const alignment = slotAlignments.get(token.slotIndex);
                    const status = alignment?.status ?? 'match';
                    const tokenKey = `${unit.key}:diff:${token.slotIndex}`;
                    const lemma = lemmaMap.get(token.normalized) ?? lemmaMap.get(token.text.toLowerCase());

                    return (
                        <span key={tokenKey} className="inline-flex items-baseline gap-1">
                            <Word
                                word={token.text}
                                original={token.text}
                                lemma={lemma}
                                sentenceText={unit.text}
                                sentenceIndex={unit.index}
                                sentenceHash={sentenceHash}
                                pop={popKey === tokenKey}
                                requestPop={() => setPopKey((prev) => (prev === tokenKey ? null : tokenKey))}
                                show={true}
                                alwaysDark={true}
                                classNames={{
                                    word: cn(
                                        'px-0.5 rounded transition-colors cursor-pointer',
                                        status === 'match' && 'text-foreground',
                                        status === 'sub' && 'bg-warning-muted/70 text-warning-text underline decoration-warning/60 underline-offset-4',
                                        status === 'missing' && 'bg-error/10 text-error-text underline decoration-dashed decoration-error underline-offset-4',
                                    ),
                                    hover: 'hover:bg-accent/15 hover:text-accent',
                                    vocab: 'underline decoration-accent/70 underline-offset-4 decoration-2',
                                    vocabFamiliar: 'underline decoration-dotted decoration-accent/45 underline-offset-4',
                                }}
                            >
                                {token.text}
                            </Word>
                            {status === 'sub' && alignment?.heardText && (
                                <span className="text-metadata font-normal text-warning-text/80 line-through">
                                    {alignment.heardText}
                                </span>
                            )}
                        </span>
                    );
                })}
                {extraWords.length > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-metadata font-normal text-muted-foreground">
                        {t('result.extraPrefix', { defaultValue: '+ 多出:' })}{' '}
                        {extraWords.map((w) => w.heard).filter(Boolean).join(' ')}
                    </span>
                )}
            </div>
        </div>
    );
}
