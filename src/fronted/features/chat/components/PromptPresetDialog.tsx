import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Info, Plus, RotateCcw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { chatApi } from '@/fronted/features/chat/chatApi';
import type { LearningPromptPresetVO } from '@/common/types/chat';
import { cn } from '@/fronted/lib/utils';

export interface PromptPresetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    presets: LearningPromptPresetVO[];
    activePresetId: string;
    onPresetsUpdated: (presets: LearningPromptPresetVO[]) => void;
    onSelectPreset: (presetId: string) => void;
}

/**
 * 教学人设与自定义 System Prompt 管理弹窗。
 */
export default function PromptPresetDialog(props: PromptPresetDialogProps) {
    const { isOpen, onOpenChange, activePresetId } = props;
    const { t } = useTranslation('common');

    return (
        <Dialog
            isOpen={isOpen}
            onOpenChange={onOpenChange}
            width={760}
            maxHeight="82dvh"
            purpose="form"
        >
            {isOpen ? (
                <PromptPresetDialogBody key={activePresetId} {...props} />
            ) : (
                <Layout
                    header={<DialogHeader title={t('learning.presetDialogTitle', { defaultValue: '自定义 AI 教学提示词与人设' })} onOpenChange={onOpenChange} />}
                    content={<LayoutContent><div /></LayoutContent>}
                />
            )}
        </Dialog>
    );
}

function PromptPresetDialogBody({
    onOpenChange,
    presets,
    activePresetId,
    onPresetsUpdated,
    onSelectPreset,
}: PromptPresetDialogProps) {
    const { t } = useTranslation('common');
    const initialPreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

    const [selectedId, setSelectedId] = useState(initialPreset?.id ?? activePresetId);
    const [draftName, setDraftName] = useState(initialPreset?.name ?? '');
    const [draftDesc, setDraftDesc] = useState(initialPreset?.description ?? '');
    const [draftPrompt, setDraftPrompt] = useState(initialPreset?.systemPrompt ?? '');
    const [creatingNew, setCreatingNew] = useState(false);
    const [saving, setSaving] = useState(false);

    const handlePickItem = (preset: LearningPromptPresetVO) => {
        setCreatingNew(false);
        setSelectedId(preset.id);
        setDraftName(preset.name);
        setDraftDesc(preset.description);
        setDraftPrompt(preset.systemPrompt);
    };

    const handleStartNew = () => {
        const newId = `custom-${Date.now()}`;
        setCreatingNew(true);
        setSelectedId(newId);
        setDraftName(t('learning.presetNewDefaultName', { defaultValue: '我的专属导师' }));
        setDraftDesc(t('learning.presetNewDefaultDesc', { defaultValue: '自定义整句精读与认知拆解指令' }));
        setDraftPrompt(presets[0]?.systemPrompt ?? '');
    };

    const handleSave = async (setAsActive: boolean) => {
        if (!draftName.trim() || !draftPrompt.trim()) {
            toast.error(t('learning.presetRequiredFields', { defaultValue: '请填写预设名称与提示词内容' }));
            return;
        }
        setSaving(true);
        try {
            const current = presets.find((p) => p.id === selectedId);
            await chatApi.savePromptPreset({
                id: selectedId,
                name: draftName.trim(),
                description: draftDesc.trim(),
                roleMode: current?.roleMode ?? 'custom',
                systemPrompt: draftPrompt.trim(),
                setAsActive,
            });
            const refreshed = await chatApi.listPromptPresets();
            onPresetsUpdated(refreshed);
            if (setAsActive) {
                onSelectPreset(selectedId);
            }
            setCreatingNew(false);
            toast.success(t('learning.presetSaved', { defaultValue: '教学提示词已保存' }));
            if (setAsActive) {
                onOpenChange(false);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    };

    const handleResetBuiltin = async () => {
        const current = presets.find((p) => p.id === selectedId);
        if (!current?.isBuiltin) return;
        setSaving(true);
        try {
            const restored = await chatApi.resetPromptPreset({ id: current.id });
            const refreshed = await chatApi.listPromptPresets();
            onPresetsUpdated(refreshed);
            setDraftName(restored.name);
            setDraftDesc(restored.description);
            setDraftPrompt(restored.systemPrompt);
            toast.success(t('learning.presetRestored', { defaultValue: '已恢复内置默认提示词' }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    };

    const activeEditing = presets.find((p) => p.id === selectedId);

    return (
        <Layout
            header={(
                <DialogHeader
                    title={t('learning.presetDialogTitle', { defaultValue: '自定义 AI 教学提示词与人设' })}
                    onOpenChange={onOpenChange}
                />
            )}
            content={(
                <LayoutContent>
                    <div className="grid grid-cols-[210px_1fr] gap-4 min-h-[360px]">
                        <div className="flex flex-col gap-1.5 border-r border-border/50 pr-3">
                            <button
                                type="button"
                                onClick={handleStartNew}
                                className="mb-1 flex items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2.5 py-2 text-sm font-medium text-accent hover:bg-accent/5 cursor-pointer"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                <span>{t('learning.presetCreate', { defaultValue: '新建私人预设' })}</span>
                            </button>
                            {presets.map((preset) => {
                                const selected = !creatingNew && preset.id === selectedId;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => handlePickItem(preset)}
                                        className={cn(
                                            'flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer',
                                            selected
                                                ? 'bg-accent/12 text-foreground border border-accent/35'
                                                : 'hover:bg-muted/60 text-foreground/85 border border-transparent',
                                        )}
                                    >
                                        <div className="flex w-full items-center justify-between gap-1">
                                            <span className="truncate text-sm font-medium">{preset.name}</span>
                                            {preset.id === activePresetId && (
                                                <span className="shrink-0 rounded px-1 py-0.5 text-metadata font-medium bg-accent/15 text-accent">
                                                    {t('learning.presetCurrent', { defaultValue: '当前' })}
                                                </span>
                                            )}
                                        </div>
                                        <span className="line-clamp-2 text-metadata text-muted-foreground leading-snug">
                                            {preset.description}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex flex-col gap-3">
                            <div className="grid grid-cols-2 gap-2.5">
                                <label className="flex flex-col gap-1">
                                    <span className="text-sm font-medium text-muted-foreground">
                                        {t('learning.presetNameLabel', { defaultValue: '预设名称' })}
                                    </span>
                                    <input
                                        type="text"
                                        value={draftName}
                                        onChange={(e) => setDraftName(e.target.value)}
                                        className="rounded-lg border border-border/70 bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-sm font-medium text-muted-foreground">
                                        {t('learning.presetDescLabel', { defaultValue: '一句话简介' })}
                                    </span>
                                    <input
                                        type="text"
                                        value={draftDesc}
                                        onChange={(e) => setDraftDesc(e.target.value)}
                                        className="rounded-lg border border-border/70 bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
                                    />
                                </label>
                            </div>

                            <label className="flex flex-1 flex-col gap-1">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-muted-foreground">
                                        {t('learning.presetPromptLabel', { defaultValue: '教学指令正文（System Persona Layer）' })}
                                    </span>
                                    {activeEditing?.isBuiltin && (
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={() => void handleResetBuiltin()}
                                            className="inline-flex items-center gap-1 text-metadata text-muted-foreground hover:text-foreground cursor-pointer"
                                        >
                                            <RotateCcw className="h-3 w-3" />
                                            <span>{t('learning.presetReset', { defaultValue: '恢复内置默认' })}</span>
                                        </button>
                                    )}
                                </div>
                                <textarea
                                    value={draftPrompt}
                                    onChange={(e) => setDraftPrompt(e.target.value)}
                                    rows={10}
                                    className="w-full flex-1 resize-none rounded-xl border border-border/70 bg-surface/80 p-3 text-sm leading-relaxed text-foreground outline-none focus:border-accent"
                                />
                            </label>

                            <p className="flex items-start gap-1.5 rounded-lg bg-muted/40 px-2.5 py-2 text-metadata text-muted-foreground leading-relaxed">
                                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                                <span>
                                    {t('learning.presetProtocolHint', {
                                        defaultValue: '系统会自动保留「点击英文发音 [[tts:...]]」和「跨字幕剧集线索检索」底层协议，你只需专注描述期望的认知讲解风格与教学角色。',
                                    })}
                                </span>
                            </p>
                        </div>
                    </div>
                </LayoutContent>
            )}
            footer={(
                <LayoutFooter hasDivider>
                    <div className="flex w-full items-center justify-end gap-2">
                        <Button
                            label={t('learning.presetSaveOnly', { defaultValue: '仅保存预设' })}
                            variant="secondary"
                            size="sm"
                            isDisabled={saving}
                            onClick={() => void handleSave(false)}
                        />
                        <Button
                            label={t('learning.presetSaveAndUse', { defaultValue: '保存并设当前使用' })}
                            variant="primary"
                            size="sm"
                            isDisabled={saving}
                            onClick={() => void handleSave(true)}
                        />
                    </div>
                </LayoutFooter>
            )}
        />
    );
}
