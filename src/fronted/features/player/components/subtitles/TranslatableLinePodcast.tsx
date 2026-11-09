import React from 'react';
import { History } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { cn } from '@/fronted/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';
import TranslatableLineWrapper from './TranslatableLineWrapper';
import i18n from '@/fronted/i18n';

interface TranslatableLinePodcastParam {
    sentence: Sentence;
    adjusted: boolean;
    clearAdjust: () => void;
    className?: string;
}

const TranslatableLinePodcast = ({
    sentence,
    adjusted,
    clearAdjust,
    className
}: TranslatableLinePodcastParam) => {
    const text = sentence.text;

    return text === undefined ? (
        <div />
    ) : (
        <div
            className={cn(
                'relative flex justify-between items-start w-full overflow-visible pointer-events-auto',
                className
            )}
        >
            <div className={cn('w-10 h-full translate-x-2.5 flex justify-center items-center')}>
                {adjusted && (
                    <IconButton
                        label={i18n.t('player:subtitle.resetTimingTooltip')}
                        tooltip={i18n.t('player:subtitle.resetTimingTooltip')}
                        variant="ghost"
                        size="sm"
                        icon={<History className="w-5 h-5 stroke-[2.2]" />}
                        onClick={clearAdjust}
                    />
                )}
            </div>
            <TranslatableLineWrapper
                sentence={sentence}
                adjusted={adjusted}
                clearAdjust={clearAdjust}
                variant={'plain'}
            />
            <div className={cn('w-10 h-full')} />
        </div>
    );
};

export default TranslatableLinePodcast;
