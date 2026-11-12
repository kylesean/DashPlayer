import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { BookmarkMinus, ExternalLink, Mic, Save, Volume2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { SavedSentenceTag, SavedSentenceVO } from '@/common/types/contextStudio';
import { SAVED_SENTENCE_TAGS } from '@/common/types/contextStudio';
import TimeUtil from '@/common/utils/TimeUtil';
import { contextStudioApi } from '../contextStudioApi';
import { useSavedSentences } from '../savedSentencesStore';
import { playContextAudio } from '@/fronted/infrastructure/audio/AudioPlayer';
import { cn } from '@/fronted/lib/utils';

export interface SentenceDetailCanvasProps {
    sentence: SavedSentenceVO;
    onUpdated: (updated: SavedSentenceVO) => void;
    onRemoved: (sentenceKey: string) => void;
}

export default function SentenceDetailCanvas({
    sentence,
    onUpdated,
    onRemoved,
}: SentenceDetailCanvasProps) {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const [note, setNote] = useState(sentence.note);
    const [tag, setTag] = useState<SavedSentenceTag>(sentence.tag);
    const [savingNote, setSavingNote] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [removing, setRemoving] = useState(false);

    const hasNativeAudio = Boolean(sentence.videoPath && sentence.endTime > sentence.startTime);
    const speakLabel = hasNativeAudio
        ? t('contextStudio.playNativeAudio', { defaultValue: '播放原声' })
        : t('contextStudio.speakSentence', { defaultValue: '朗读' });

    const handleSpeak = async () => {
        setSpeaking(true);
        try {
            await playContextAudio({
                text: sentence.text,
                videoPath: sentence.videoPath,
                startTime: sentence.startTime,
                endTime: sentence.endTime,
            });
        } finally {
            setSpeaking(false);
        }
    };

    const handleTagChange = async (nextTag: string) => {
        const typed = nextTag as SavedSentenceTag;
        setTag(typed);
        try {
            const updated = await contextStudioApi.updateSavedSentence({
                sentenceKey: sentence.sentenceKey,
                tag: typed,
            });
            if (updated) {
                onUpdated(updated);
            }
        } catch {
            setTag(sentence.tag);
            toast.error(t('contextStudio.updateSentenceFailed', { defaultValue: '更新金句标签失败' }));
        }
    };

    const handleSaveNote = async () => {
        setSavingNote(true);
        try {
            const updated = await contextStudioApi.updateSavedSentence({
                sentenceKey: sentence.sentenceKey,
                note,
            });
            if (updated) {
                onUpdated(updated);
                toast.success(t('contextStudio.noteSaved', { defaultValue: '笔记已保存' }));
            }
        } catch {
            toast.error(t('contextStudio.updateSentenceFailed', { defaultValue: '保存笔记失败' }));
        } finally {
            setSavingNote(false);
        }
    };

    const handleRemove = async () => {
        setRemoving(true);
        try {
            const ok = await contextStudioApi.unsaveSentence(sentence.sentenceKey);
            if (ok) {
                useSavedSentences.getState().markRemoved(sentence.sentenceKey);
                toast.success(t('contextStudio.sentenceRemoved', { defaultValue: '已取消收藏该金句' }));
                onRemoved(sentence.sentenceKey);
            }
        } catch {
            toast.error(t('contextStudio.deleteFailed', { defaultValue: '取消收藏失败' }));
        } finally {
            setRemoving(false);
        }
    };

    const openInPlayer = (withPractice = false) => {
        if (!sentence.videoId) return;
        const query = new URLSearchParams();
        if (sentence.startTime > 0) {
            query.set('t', String(Math.floor(sentence.startTime)));
        }
        if (withPractice) {
            query.set('practice', 'shadowing');
        }
        const qs = query.toString();
        navigate(`/player/${sentence.videoId}${qs ? `?${qs}` : ''}`);
    };

    return (
        <div className="flex flex-col h-full min-h-0 overflow-y-auto p-6 gap-5">
            {/* 头部信息与操作 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-metadata font-medium text-accent truncate">
                        {sentence.videoTitle || t('contextStudio.unknownVideo', { defaultValue: '未知视频' })}
                    </span>
                    <span className="text-metadata text-secondary font-mono shrink-0">
                        {TimeUtil.secondToTimeStrCompact(sentence.startTime)} - {TimeUtil.secondToTimeStrCompact(sentence.endTime)}
                    </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <div className="shrink-0">
                        <SegmentedControl
                            size="sm"
                            value={tag}
                            onChange={(val) => void handleTagChange(val)}
                            label={t('contextStudio.sentenceTagLabel', { defaultValue: '金句标签' })}
                        >
                            {SAVED_SENTENCE_TAGS.map((item) => (
                                <SegmentedControlItem
                                    key={item}
                                    value={item}
                                    label={t(`contextStudio.tag.${item}`, {
                                        defaultValue:
                                            item === 'expression'
                                                ? '表达'
                                                : item === 'pronunciation'
                                                    ? '发音'
                                                    : item === 'grammar'
                                                        ? '句型'
                                                        : '通用',
                                    })}
                                />
                            ))}
                        </SegmentedControl>
                    </div>

                    <Tooltip content={t('contextStudio.removeSentence', { defaultValue: '取消收藏' })} placement="below">
                        <button
                            type="button"
                            disabled={removing}
                            onClick={() => void handleRemove()}
                            className="p-1.5 rounded-lg text-secondary hover:text-error-text hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
                            aria-label={t('contextStudio.removeSentence', { defaultValue: '取消收藏' })}
                        >
                            <BookmarkMinus className="w-4 h-4" />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* 句型原文与译文卡片 */}
            <Card variant="muted" padding={5}>
                <div className="flex flex-col gap-3">
                    <p className="text-lg font-semibold text-primary leading-relaxed select-text">
                        {sentence.text}
                    </p>
                    {sentence.textZh && (
                        <p className="text-base text-secondary leading-relaxed select-text">
                            {sentence.textZh}
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        <Tooltip content={speakLabel} placement="below">
                            <Button
                                size="sm"
                                variant="secondary"
                                icon={<Volume2 className="w-3.5 h-3.5" />}
                                isDisabled={speaking}
                                label={t('contextStudio.speakSentence', { defaultValue: '朗读' })}
                                onClick={() => void handleSpeak()}
                            />
                        </Tooltip>
                        {sentence.videoId && (
                            <>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    icon={<Mic className="w-3.5 h-3.5" />}
                                    label={t('contextStudio.practiceShadowing', { defaultValue: '跟读练习' })}
                                    onClick={() => openInPlayer(true)}
                                />
                                <Button
                                    size="sm"
                                    variant="primary"
                                    icon={<ExternalLink className="w-3.5 h-3.5" />}
                                    label={t('contextStudio.openInPlayer', { defaultValue: '定位播放' })}
                                    onClick={() => openInPlayer(false)}
                                />
                            </>
                        )}
                    </div>
                </div>
            </Card>

            {/* 笔记区 */}
            <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                    <Text type="body" weight="semibold">
                        {t('contextStudio.noteTitle', { defaultValue: '笔记' })}
                    </Text>
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<Save className="w-3.5 h-3.5" />}
                        isDisabled={savingNote || note === sentence.note}
                        label={t('contextStudio.saveNote', { defaultValue: '保存' })}
                        onClick={() => void handleSaveNote()}
                    />
                </div>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('contextStudio.notePlaceholder', {
                        defaultValue: '添加发音、搭配或理解笔记...',
                    })}
                    rows={5}
                    className={cn(
                        'w-full rounded-lg border border-border/60 bg-surface px-3.5 py-2.5 text-sm text-primary',
                        'placeholder:text-secondary/70 focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y',
                    )}
                />
            </div>
        </div>
    );
}
