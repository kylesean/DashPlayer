import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';
import type { SentencePracticeResultVO } from '@/common/contracts/sentence-practice';
import { playSentencePassCue } from '../audioFeedback';
import type { PracticeUnit } from '../practiceUnit';
import DictationCompletedView from './DictationCompletedView';

interface BlindDictationProps {
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
 * 整句盲听挑战组件（无词数/字母数量提示）。
 *
 * `Enter` 提交，`Shift+Enter` 换行，`Tab` 原音，`Shift+Tab` 0.75× 慢速，
 * 按住 `\` 临时透视，提交后原地展示带划词词典的红绿差异句。
 */
export default function BlindDictation({
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
}: BlindDictationProps) {
    const { t } = useTranslation('practice');
    const [typed, setTyped] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!result) {
            const textarea = containerRef.current?.querySelector('textarea');
            textarea?.focus();
        }
    }, [result, unit.key]);

    const handleSubmit = async (): Promise<void> => {
        if (submitting || !typed.trim()) return;
        setSubmitting(true);
        try {
            await onSubmitSentence(typed.trim());
            playSentencePassCue();
        } finally {
            setSubmitting(false);
        }
    };

    if (result) {
        return (
            <DictationCompletedView
                unit={unit}
                result={result}
                translationText={translationText}
                onRetry={onRetry}
                onNextSentence={onNextSentence}
            />
        );
    }

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 盲听写作区集中拦截 Tab 重播、\ 偷看与 Enter 提交快捷键
        <div
            ref={containerRef}
            className="flex flex-col gap-2.5"
            onKeyDown={(e) => {
                if (e.key === 'Tab') {
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
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                }
            }}
            onKeyUp={(e) => {
                if (e.key === '\\') {
                    onPeekChange(false);
                }
            }}
            onBlur={() => onPeekChange(false)}
        >
            <TextArea
                label={t('dictation.placeholder')}
                isLabelHidden
                value={typed}
                onChange={(val) => setTyped(val)}
                placeholder={t('dictation.blindPlaceholder', {
                    defaultValue: '盲听挑战：听到整句后直接写出内容（Enter 提交，Tab 重播）…',
                })}
                rows={2}
                width="100%"
            />
            {peekingSpoiler && (
                <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground">
                    <span>{unit.text}</span>
                    {translationText ? <span className="ml-2 text-xs opacity-80">· {translationText}</span> : null}
                </div>
            )}
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                    {t('dictation.blindHint', { defaultValue: '无词数提示 · Shift+Enter 可换行' })}
                </span>
                <Button
                    variant="primary"
                    size="sm"
                    isLoading={submitting}
                    icon={<Keyboard className="h-3.5 w-3.5" />}
                    label={t('dictation.submit')}
                    onClick={() => void handleSubmit()}
                />
            </div>
        </div>
    );
}
