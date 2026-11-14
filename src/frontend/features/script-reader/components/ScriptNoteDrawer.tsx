import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { ExternalLink, Mic, Save, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    SAVED_SENTENCE_TAGS,
    type SavedSentenceTag,
    type SavedSentenceVO,
} from '@/common/types/contextStudio';
import type { SubtitleComprehensionVO } from '@/common/types/subtitleComprehension';
import type { Sentence } from '@/common/types/SentenceC';
import { playerApi } from '@/frontend/features/player/playerApi';
import { cn } from '@/frontend/lib/utils';

interface ScriptNoteDrawerProps {
    sentence: Sentence;
    savedRecord?: SavedSentenceVO;
    onSaveNote: (sentence: Sentence, tag: SavedSentenceTag, note: string) => Promise<void>;
    onJumpToPlayer: (sentence: Sentence, withPractice: boolean) => void;
}

/**
 * 句子内联精读抽屉：展示本地句法/生词难度诊断、标签归类、笔记保存以及一键跳回视频跟读。
 */
export function ScriptNoteDrawer({
    sentence,
    savedRecord,
    onSaveNote,
    onJumpToPlayer,
}: ScriptNoteDrawerProps) {
    const { t } = useTranslation('pages');
    const [tag, setTag] = useState<SavedSentenceTag>(savedRecord?.tag ?? 'general');
    const [note, setNote] = useState<string>(savedRecord?.note ?? '');
    const [saving, setSaving] = useState(false);
    const [comprehension, setComprehension] = useState<SubtitleComprehensionVO | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (typeof playerApi.subtitleComprehension !== 'function') {
            return;
        }
        void playerApi
            .subtitleComprehension({
                text: sentence.text,
                fileHash: sentence.fileHash,
                sentenceIndex: sentence.index,
            })
            .then((res) => {
                if (!cancelled && res) {
                    setComprehension(res);
                }
            })
            .catch(() => {
                // 理解度分析属于增强信息，失败时静默降级
            });
        return () => {
            cancelled = true;
        };
    }, [sentence.text, sentence.fileHash, sentence.index]);

    const dirty = note !== (savedRecord?.note ?? '') || tag !== (savedRecord?.tag ?? 'general');

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSaveNote(sentence, tag, note);
        } finally {
            setSaving(false);
        }
    };

    const difficultyLabel = comprehension
        ? comprehension.band === 'high'
            ? t('scriptReader.bandEasy', { defaultValue: '表达较直接' })
            : comprehension.band === 'medium'
                ? t('scriptReader.bandMedium', { defaultValue: '中等理解难度' })
                : t('scriptReader.bandHard', { defaultValue: '难点长句/生词较多' })
        : null;

    return (
        <div
            data-testid="script-note-drawer"
            className="mt-3 pt-3 border-t border-border/40 flex flex-col gap-3"
        >
            {/* 本地理解度诊断与跨页联动 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {comprehension && difficultyLabel && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 text-metadata text-secondary">
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
                            <span>{difficultyLabel}</span>
                            {comprehension.unknownWords.length > 0 && (
                                <span className="text-primary font-medium">
                                    · {t('scriptReader.unknownWordsInline', {
                                        defaultValue: '待掌握: {{words}}',
                                        words: comprehension.unknownWords.slice(0, 4).join(', '),
                                    })}
                                </span>
                            )}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<Mic className="h-3.5 w-3.5" />}
                        label={t('scriptReader.shadowThisSentenceShort', { defaultValue: '视频跟读' })}
                        onClick={() => onJumpToPlayer(sentence, true)}
                    />
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<ExternalLink className="h-3.5 w-3.5" />}
                        label={t('scriptReader.locateInVideoShort', { defaultValue: '定位画面' })}
                        onClick={() => onJumpToPlayer(sentence, false)}
                    />
                </div>
            </div>

            {/* 分类标签 + 笔记编辑 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="shrink-0">
                    <SegmentedControl
                        size="sm"
                        value={tag}
                        onChange={(val) => setTag(val as SavedSentenceTag)}
                        label={t('scriptReader.noteTagLabel', { defaultValue: '金句标签' })}
                    >
                        {SAVED_SENTENCE_TAGS.map((item) => (
                            <SegmentedControlItem
                                key={item}
                                value={item}
                                label={
                                    item === 'expression'
                                        ? t('scriptReader.tagExpression', { defaultValue: '表达' })
                                        : item === 'pronunciation'
                                            ? t('scriptReader.tagPronunciation', { defaultValue: '发音' })
                                            : item === 'grammar'
                                                ? t('scriptReader.tagGrammar', { defaultValue: '句型' })
                                                : t('scriptReader.tagGeneral', { defaultValue: '通用' })
                                }
                            />
                        ))}
                    </SegmentedControl>
                </div>

                <Button
                    size="sm"
                    variant="primary"
                    icon={<Save className="h-3.5 w-3.5" />}
                    isDisabled={saving || (!dirty && Boolean(savedRecord))}
                    label={t('scriptReader.saveNote', { defaultValue: '保存笔记' })}
                    onClick={() => void handleSave()}
                />
            </div>

            <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={t('scriptReader.notePlaceholder', {
                    defaultValue: '记录连读吞音、句法结构或地道搭配笔记（保存后自动同步到语境工坊）...',
                })}
                className={cn(
                    'w-full rounded-lg border border-border/50 bg-body px-3 py-2 text-sm text-primary',
                    'placeholder:text-secondary/70 focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y',
                )}
            />
        </div>
    );
}
