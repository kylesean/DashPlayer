import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@astryxdesign/core/Button';
import type { SentencePracticeResultVO } from '@/common/contracts/sentence-practice';
import { cn } from '@/frontend/lib/utils';
import type { PracticeUnit } from '../practiceUnit';
import PracticeDiffSentence from './PracticeDiffSentence';

interface DictationCompletedViewProps {
    unit: PracticeUnit;
    result: SentencePracticeResultVO;
    translationText: string;
    hintedCount?: number;
    onRetry: () => void;
    onNextSentence: () => void;
}

/**
 * 听写交卷后的统一结果展示：原文内联差异高亮 + 译文 + 分数胶囊 + 重练/下一句动作。
 * 供词槽即时与整句盲听共同复用。
 */
export default function DictationCompletedView({
    unit,
    result,
    translationText,
    hintedCount = 0,
    onRetry,
    onNextSentence,
}: DictationCompletedViewProps) {
    const { t } = useTranslation('practice');

    return (
        <div className="flex flex-col gap-3">
            <PracticeDiffSentence unit={unit} result={result} />
            {translationText ? (
                <p className="text-sm text-secondary leading-relaxed">{translationText}</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex items-center gap-2 text-sm text-secondary">
                    <span
                        className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums',
                            result.score >= 80
                                ? 'bg-success/15 text-success-text'
                                : result.score >= 50
                                    ? 'bg-warning-muted text-warning-text'
                                    : 'bg-error/15 text-error-text',
                        )}
                    >
                        {t('result.scoreBadge', { defaultValue: '得分 {{score}}', score: Math.round(result.score) })}
                    </span>
                    {hintedCount > 0 && (
                        <span className="text-sm text-secondary">
                            {t('dictation.hintUsedCount', { defaultValue: '字母提示 {{count}} 次', count: hintedCount })}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        label={t('result.retry')}
                        onClick={onRetry}
                    />
                    <Button
                        variant="primary"
                        size="sm"
                        label={t('panel.nextSentenceEnter', { defaultValue: '下一句 ↵' })}
                        onClick={onNextSentence}
                    />
                </div>
            </div>
        </div>
    );
}
