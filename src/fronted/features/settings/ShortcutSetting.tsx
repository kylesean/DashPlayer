import * as React from 'react';
import useSWR from 'swr';
import { useForm, Controller } from 'react-hook-form';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    Clock,
    Pencil,
    PlayCircle,
    Plus,
    RotateCcw,
    Search,
    Sparkles,
    Subtitles,
} from 'lucide-react';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

import { SettingKeyObj } from '@/common/types/store_schema';
import type { ShortcutSettingDetailVO, ShortcutSettingSaveVO } from '@/common/types/vo/shortcut-setting-vo';
import { SettingCard, SettingRow, SettingsLoadingSkeleton } from '@/fronted/features/settings/components/form';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import { SETTINGS_DETAIL_SWR_OPTIONS, settingsApi } from '@/fronted/features/settings/settingsApi';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';

type ShortcutKey = keyof ShortcutSettingSaveVO;
type ShortcutStoreKey = `shortcut.${ShortcutKey}`;
type ShortcutFormValues = ShortcutSettingSaveVO;

/**
 * 格式化单个按键为标准符号或名称。
 *
 * @param key 按键标识字符串。
 * @returns 格式化后的按键符号。
 */
const formatKeySymbol = (key: string): string => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
    const lower = key.toLowerCase();

    switch (lower) {
        case 'meta':
        case 'cmd':
        case 'command':
            return isMac ? '⌘' : 'Win';
        case 'alt':
        case 'option':
            return isMac ? '⌥' : 'Alt';
        case 'shift':
            return isMac ? '⇧' : 'Shift';
        case 'ctrl':
        case 'control':
            return isMac ? '⌃' : 'Ctrl';
        case 'space':
        case ' ':
            return 'Space';
        case 'enter':
        case 'return':
            return isMac ? '↩' : 'Enter';
        case 'backspace':
            return isMac ? '⌫' : 'Backspace';
        case 'escape':
        case 'esc':
            return 'Esc';
        case 'arrowup':
        case 'up':
            return '↑';
        case 'arrowdown':
        case 'down':
            return '↓';
        case 'arrowleft':
        case 'left':
            return '←';
        case 'arrowright':
        case 'right':
            return '→';
        case 'tab':
            return '⇥';
        default:
            return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
    }
};

/**
 * 快捷键组合展示组件
 *
 * 将逗号分隔的快捷键解析为 Astryx Kbd 徽章组合。
 */
const KeyBadge: React.FC<{ keys: string }> = ({ keys }) => {
    if (!keys || keys.trim() === '') {
        return <Text size="xsm" color="secondary">—</Text>;
    }
    const list = keys.split(',').map((k) => k.trim()).filter(Boolean);
    return (
        <HStack gap={2} vAlign="center" wrap="wrap">
            {list.map((shortcut) => (
                <Kbd key={shortcut} keys={shortcut.toLowerCase()} />
            ))}
        </HStack>
    );
};

/**
 * 解析快捷键字符串，规范化并去重。
 *
 * @param value 逗号分隔的快捷键字符串。
 * @returns 规范化后的按键组合数组。
 */
const parseShortcutList = (value: string): string[] => Array.from(new Set(
    value
        .split(',')
        .map((item) => item.trim().replaceAll(' ', ''))
        .filter((item) => item !== ''),
));

/**
 * 将快捷键数组转为配置存储的逗号分隔字符串。
 *
 * @param shortcuts 快捷键组合列表。
 * @returns 逗号拼接的字符串。
 */
const stringifyShortcutList = (shortcuts: string[]): string => shortcuts.join(',');

/**
 * 将快捷键字段名转换为配置仓库里的 `shortcut.xxx` 键名。
 *
 * @param key 快捷键动作键名。
 * @returns 完整运行时存储键。
 */
const toShortcutStoreKey = (key: ShortcutKey): ShortcutStoreKey => `shortcut.${key}`;

/** 录制弹窗内部正文属性。 */
interface RecordDialogBodyProps {
    title: string;
    initialShortcuts: string[];
    defaultValue: string;
    dialogTitle: string;
    dialogDescription: string;
    saveChangesLabel: string;
    currentShortcutsLabel: string;
    emptyShortcutsLabel: string;
    addRecordedLabel: string;
    removeShortcutLabel: string;
    resetDefaultLabel: string;
    listeningPrompt: string;
    clearAllLabel: string;
    onSubmit: (nextValue: string) => void;
    onClose: () => void;
}

/**
 * 录制弹窗正文：管理按键捕获状态与临时草稿。
 */
const RecordDialogBody: React.FC<RecordDialogBodyProps> = ({
    title,
    initialShortcuts,
    defaultValue,
    dialogTitle,
    dialogDescription,
    saveChangesLabel,
    currentShortcutsLabel,
    emptyShortcutsLabel,
    addRecordedLabel,
    removeShortcutLabel,
    resetDefaultLabel,
    listeningPrompt,
    clearAllLabel,
    onSubmit,
    onClose,
}) => {
    const { t } = useI18nTranslation('settings');
    const [keys, { start, stop }] = useRecordHotkeys();
    const [shortcuts, setShortcuts] = React.useState<string[]>(initialShortcuts);
    const [isListening, setIsListening] = React.useState(true);
    const recordContainerRef = React.useRef<HTMLButtonElement>(null);

    const recordedShortcut = React.useMemo(() => {
        return Array.from(keys).join('+').trim().replaceAll(' ', '');
    }, [keys]);

    /**
     * 将录制到的快捷键追加到草稿列表，自动去重，并重置当前录制状态以准备下一次录制。
     */
    const appendRecordedShortcut = React.useCallback(() => {
        if (!recordedShortcut) {
            return;
        }
        setShortcuts((previous) => Array.from(new Set([...previous, recordedShortcut])));
        stop();
        setTimeout(() => {
            start();
            recordContainerRef.current?.focus();
        }, 30);
    }, [recordedShortcut, start, stop]);

    /**
     * 清除当前录制状态，重新开始录制。
     */
    const handleRerecord = React.useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        stop();
        setTimeout(() => {
            start();
            recordContainerRef.current?.focus();
        }, 30);
    }, [start, stop]);

    /**
     * 从草稿列表移除指定快捷键。
     */
    const removeShortcut = React.useCallback((shortcut: string) => {
        setShortcuts((previous) => previous.filter((item) => item !== shortcut));
    }, []);

    /**
     * 保存弹窗内草稿并回写到表单字段。
     */
    const submitChanges = React.useCallback(() => {
        onSubmit(stringifyShortcutList(shortcuts));
        onClose();
    }, [onClose, onSubmit, shortcuts]);

    /**
     * 重置为默认值。
     */
    const resetToDefault = React.useCallback(() => {
        setShortcuts(parseShortcutList(defaultValue));
    }, [defaultValue]);

    /**
     * 清空全部按键。
     */
    const clearAll = React.useCallback(() => {
        setShortcuts([]);
    }, []);

    // 挂载即开启录制并聚焦录制面板，卸载时自动停止监听
    React.useEffect(() => {
        start();
        const focusTimer = window.setTimeout(() => {
            recordContainerRef.current?.focus();
        }, 50);
        return () => {
            window.clearTimeout(focusTimer);
            stop();
        };
    }, [start, stop]);

    return (
        <VStack gap={4} padding={4}>
            <DialogHeader
                title={dialogTitle}
                subtitle={`${title} · ${dialogDescription}`}
                onOpenChange={(open) => {
                    if (!open) onClose();
                }}
            />

            {/* 录制捕获面板 */}
            <Card variant={isListening ? 'muted' : 'default'} padding={4}>
                <VStack gap={3} hAlign="center" vAlign="center">
                    <button
                        ref={recordContainerRef}
                        type="button"
                        onFocus={() => {
                            setIsListening(true);
                            start();
                        }}
                        onBlur={() => {
                            setIsListening(false);
                            stop();
                        }}
                        onClick={() => recordContainerRef.current?.focus()}
                        className="w-full bg-transparent border-0 p-0 cursor-pointer outline-none"
                    >
                        <VStack gap={2} hAlign="center" vAlign="center">
                            <HStack gap={2} vAlign="center">
                                <StatusDot
                                    variant={isListening ? 'accent' : 'neutral'}
                                    label={isListening ? listeningPrompt : t('shortcut.clickToListen')}
                                    isPulsing={isListening}
                                />
                                <Text size="sm" weight="medium" color={isListening ? 'accent' : 'secondary'}>
                                    {isListening ? listeningPrompt : t('shortcut.clickToListen')}
                                </Text>
                            </HStack>

                            <HStack vAlign="center" justify="center" minHeight={40}>
                                {recordedShortcut ? (
                                    <Kbd keys={recordedShortcut.toLowerCase()} />
                                ) : (
                                    <Text size="xsm" color="secondary">
                                        {t('shortcut.listeningPromptHint')}
                                    </Text>
                                )}
                            </HStack>
                        </VStack>
                    </button>

                    {recordedShortcut && (
                        <HStack gap={2} vAlign="center">
                            <Button
                                label={t('shortcut.rerecord')}
                                size="sm"
                                variant="secondary"
                                icon={<Icon icon={RotateCcw as unknown as IconType} size="sm" />}
                                onClick={handleRerecord}
                            />
                            <Button
                                label={addRecordedLabel}
                                size="sm"
                                variant="primary"
                                icon={<Icon icon={Plus as unknown as IconType} size="sm" />}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    appendRecordedShortcut();
                                }}
                            />
                        </HStack>
                    )}
                </VStack>
            </Card>

            {/* 当前绑定的快捷键列表 */}
            <VStack gap={2}>
                <HStack justify="between" vAlign="center">
                    <Text size="sm" weight="semibold">{currentShortcutsLabel}</Text>
                    <HStack gap={1} vAlign="center">
                        <Button
                            label={clearAllLabel}
                            size="sm"
                            variant="ghost"
                            onClick={clearAll}
                        />
                        <Button
                            label={resetDefaultLabel}
                            size="sm"
                            variant="ghost"
                            icon={<Icon icon={RotateCcw as unknown as IconType} size="sm" />}
                            onClick={resetToDefault}
                        />
                    </HStack>
                </HStack>

                <Card variant="default" padding={3}>
                    <HStack gap={2} wrap="wrap" vAlign="center">
                        {shortcuts.length === 0 ? (
                            <Text size="xsm" color="secondary">
                                {emptyShortcutsLabel}
                            </Text>
                        ) : (
                            shortcuts.map((shortcut) => (
                                <Token
                                    key={shortcut}
                                    label={shortcut.split('+').map(formatKeySymbol).join('+')}
                                    description={`${removeShortcutLabel}: ${shortcut}`}
                                    size="md"
                                    color="default"
                                    onRemove={() => removeShortcut(shortcut)}
                                />
                            ))
                        )}
                    </HStack>
                </Card>
            </VStack>

            {/* 弹窗底部操作 */}
            <HStack justify="end" gap={2} paddingBlockStart={2}>
                <Button
                    label={t('shortcut.cancel')}
                    variant="secondary"
                    onClick={onClose}
                />
                <Button
                    label={saveChangesLabel}
                    variant="primary"
                    onClick={submitChanges}
                />
            </HStack>
        </VStack>
    );
};

interface ShortcutItemConfig {
    key: ShortcutKey;
    title: string;
    description: string;
}

interface ShortcutGroupConfig {
    id: string;
    title: string;
    description: string;
    icon: IconType;
    items: ShortcutItemConfig[];
}

/**
 * 快捷键设置页面：展示全部动作并支持自动保存。
 */
const ShortcutSetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');
    const [searchQuery, setSearchQuery] = React.useState('');

    const { data: shortcutValues } = useSWR<ShortcutSettingDetailVO>(
        'settings/shortcuts/detail',
        settingsApi.getShortcuts,
        SETTINGS_DETAIL_SWR_OPTIONS,
    );

    const form = useForm<ShortcutFormValues>();
    const { control } = form;
    const { ready, status: autoSaveStatus, error: autoSaveError, initialize, flush } = useAutoSaveSettingsForm<ShortcutFormValues>({
        form,
        detailKey: 'settings/shortcuts/detail',
        onSave: async (values) => {
            await settingsApi.saveShortcuts(values);
        },
    });

    React.useEffect(() => {
        if (!shortcutValues) {
            return;
        }
        initialize(shortcutValues);
    }, [initialize, shortcutValues]);

    // 快捷键 4 大模块分组定义
    const groups: ShortcutGroupConfig[] = React.useMemo(() => [
        {
            id: 'playback',
            title: t('shortcut.groups.playback'),
            description: t('shortcut.groups.playbackDesc'),
            icon: PlayCircle as unknown as IconType,
            items: [
                { key: 'playPause', title: t('shortcut.items.playPause.title'), description: t('shortcut.items.playPause.description') },
                { key: 'previousSentence', title: t('shortcut.items.previousSentence.title'), description: t('shortcut.items.previousSentence.description') },
                { key: 'nextSentence', title: t('shortcut.items.nextSentence.title'), description: t('shortcut.items.nextSentence.description') },
                { key: 'seekBackward', title: t('shortcut.items.seekBackward.title'), description: t('shortcut.items.seekBackward.description') },
                { key: 'seekForward', title: t('shortcut.items.seekForward.title'), description: t('shortcut.items.seekForward.description') },
                { key: 'volumeUp', title: t('shortcut.items.volumeUp.title'), description: t('shortcut.items.volumeUp.description') },
                { key: 'volumeDown', title: t('shortcut.items.volumeDown.title'), description: t('shortcut.items.volumeDown.description') },
                { key: 'repeatSentence', title: t('shortcut.items.repeatSentence.title'), description: t('shortcut.items.repeatSentence.description') },
                { key: 'repeatSingleSentence', title: t('shortcut.items.repeatSingleSentence.title'), description: t('shortcut.items.repeatSingleSentence.description') },
                { key: 'autoPause', title: t('shortcut.items.autoPause.title'), description: t('shortcut.items.autoPause.description') },
                { key: 'nextPlaybackRate', title: t('shortcut.items.nextPlaybackRate.title'), description: t('shortcut.items.nextPlaybackRate.description') },
            ],
        },
        {
            id: 'subtitles',
            title: t('shortcut.groups.subtitles'),
            description: t('shortcut.groups.subtitlesDesc'),
            icon: Subtitles as unknown as IconType,
            items: [
                { key: 'toggleEnglishDisplay', title: t('shortcut.items.toggleEnglishDisplay.title'), description: t('shortcut.items.toggleEnglishDisplay.description') },
                { key: 'toggleChineseDisplay', title: t('shortcut.items.toggleChineseDisplay.title'), description: t('shortcut.items.toggleChineseDisplay.description') },
                { key: 'toggleBilingualDisplay', title: t('shortcut.items.toggleBilingualDisplay.title'), description: t('shortcut.items.toggleBilingualDisplay.description') },
                { key: 'toggleWordLevelDisplay', title: t('shortcut.items.toggleWordLevelDisplay.title'), description: t('shortcut.items.toggleWordLevelDisplay.description') },
            ],
        },
        {
            id: 'timing',
            title: t('shortcut.groups.timing'),
            description: t('shortcut.groups.timingDesc'),
            icon: Clock as unknown as IconType,
            items: [
                { key: 'adjustBeginMinus', title: t('shortcut.items.adjustBeginMinus.title'), description: t('shortcut.items.adjustBeginMinus.description') },
                { key: 'adjustBeginPlus', title: t('shortcut.items.adjustBeginPlus.title'), description: t('shortcut.items.adjustBeginPlus.description') },
                { key: 'adjustEndMinus', title: t('shortcut.items.adjustEndMinus.title'), description: t('shortcut.items.adjustEndMinus.description') },
                { key: 'adjustEndPlus', title: t('shortcut.items.adjustEndPlus.title'), description: t('shortcut.items.adjustEndPlus.description') },
                { key: 'clearAdjust', title: t('shortcut.items.clearAdjust.title'), description: t('shortcut.items.clearAdjust.description') },
            ],
        },
        {
            id: 'tools',
            title: t('shortcut.groups.tools'),
            description: t('shortcut.groups.toolsDesc'),
            icon: Sparkles as unknown as IconType,
            items: [
                { key: 'aiChat', title: t('shortcut.items.aiChat.title'), description: t('shortcut.items.aiChat.description') },
                { key: 'openControlPanel', title: t('shortcut.items.openControlPanel.title'), description: t('shortcut.items.openControlPanel.description') },
                { key: 'nextTheme', title: t('shortcut.items.nextTheme.title'), description: t('shortcut.items.nextTheme.description') },
            ],
        },
    ], [t]);

    // 过滤逻辑（支持按名称、描述或当前按键过滤）
    const filteredGroups = React.useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) {
            return groups;
        }

        return groups
            .map((group) => ({
                ...group,
                items: group.items.filter((item) => {
                    const titleMatch = item.title.toLowerCase().includes(query);
                    const descMatch = item.description.toLowerCase().includes(query);
                    const keyValue = form.getValues(item.key) ?? '';
                    const keyMatch = keyValue.toLowerCase().includes(query);
                    return titleMatch || descMatch || keyMatch;
                }),
            }))
            .filter((group) => group.items.length > 0);
    }, [groups, searchQuery, form]);

    if (!ready) {
        return (
            <SettingsLoadingSkeleton
                title={t('shortcut.title')}
                description={t('shortcut.description')}
            />
        );
    }

    return (
        <SettingsPageShell
            title={t('shortcut.title')}
            description={t('shortcut.description')}
        >
            <VStack gap={6} width="100%">
                {autoSaveStatus === 'error' && autoSaveError && (
                    <Banner
                        status="error"
                        title={autoSaveError}
                    />
                )}

                {/* 搜索过滤条 */}
                <TextInput
                    label={t('shortcut.searchPlaceholder')}
                    isLabelHidden
                    type="search"
                    value={searchQuery}
                    onChange={(val) => setSearchQuery(val)}
                    hasClear
                    size="sm"
                    width={360}
                    placeholder={t('shortcut.searchPlaceholder')}
                    startIcon={Search as unknown as IconType}
                />

                {filteredGroups.length === 0 ? (
                    <HStack justify="center" paddingBlock={8}>
                        <Text size="sm" color="secondary">
                            {t('shortcut.noMatches')}
                        </Text>
                    </HStack>
                ) : (
                    filteredGroups.map((group) => (
                        <SettingCard
                            key={group.id}
                            title={group.title}
                            description={group.description}
                            icon={group.icon as unknown as IconType}
                        >
                            {group.items.map((item) => (
                                <Controller
                                    key={item.key}
                                    name={item.key}
                                    control={control}
                                    render={({ field }) => (
                                        <ShortcutRow
                                            title={item.title}
                                            description={item.description}
                                            value={field.value ?? ''}
                                            defaultValue={SettingKeyObj[toShortcutStoreKey(item.key)]}
                                            onChange={(val) => {
                                                field.onChange(val);
                                                flush().catch(() => null);
                                            }}
                                            editLabel={t('shortcut.edit')}
                                            resetDefaultLabel={t('shortcut.resetDefault')}
                                            dialogTitle={t('shortcut.dialogTitle')}
                                            dialogDescription={t('shortcut.dialogDescription')}
                                            saveChangesLabel={t('shortcut.saveChanges')}
                                            currentShortcutsLabel={t('shortcut.dialogCurrentShortcuts')}
                                            emptyShortcutsLabel={t('shortcut.dialogNoShortcuts')}
                                            addRecordedLabel={t('shortcut.dialogAddRecorded')}
                                            removeShortcutLabel={t('shortcut.dialogRemoveShortcut')}
                                            dialogResetDefaultLabel={t('shortcut.dialogResetDefault')}
                                            listeningPrompt={t('shortcut.listeningPrompt')}
                                            clearAllLabel={t('shortcut.clearAll')}
                                        />
                                    )}
                                />
                            ))}
                        </SettingCard>
                    ))
                )}
            </VStack>
        </SettingsPageShell>
    );
};

/**
 * 单行快捷键配置项：提供编辑弹窗入口与恢复默认值操作。
 */
const ShortcutRow: React.FC<{
    title: string;
    description: string;
    value: string;
    defaultValue: string;
    onChange: (value: string) => void;
    editLabel: string;
    resetDefaultLabel: string;
    dialogTitle: string;
    dialogDescription: string;
    saveChangesLabel: string;
    currentShortcutsLabel: string;
    emptyShortcutsLabel: string;
    addRecordedLabel: string;
    removeShortcutLabel: string;
    dialogResetDefaultLabel: string;
    listeningPrompt: string;
    clearAllLabel: string;
}> = ({
    title,
    description,
    value,
    defaultValue,
    onChange,
    editLabel,
    resetDefaultLabel,
    dialogTitle,
    dialogDescription,
    saveChangesLabel,
    currentShortcutsLabel,
    emptyShortcutsLabel,
    addRecordedLabel,
    removeShortcutLabel,
    dialogResetDefaultLabel,
    listeningPrompt,
    clearAllLabel,
}) => {
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);
    const isDefault = value === defaultValue;

    return (
        <SettingRow
            title={title}
            description={description}
        >
            <HStack gap={3} align="center" justify="end">
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setIsDialogOpen(true)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsDialogOpen(true);
                        }
                    }}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    title={editLabel}
                >
                    <KeyBadge keys={value} />
                </div>

                <HStack gap={1} align="center">
                    <IconButton
                        label={editLabel}
                        tooltip={editLabel}
                        size="sm"
                        variant="ghost"
                        icon={<Icon icon={Pencil as unknown as IconType} size="sm" />}
                        onClick={() => setIsDialogOpen(true)}
                    />

                    <IconButton
                        label={resetDefaultLabel}
                        tooltip={resetDefaultLabel}
                        size="sm"
                        variant="ghost"
                        isDisabled={isDefault}
                        icon={<Icon icon={RotateCcw as unknown as IconType} size="sm" />}
                        onClick={() => onChange(defaultValue)}
                    />
                </HStack>
            </HStack>

            <Dialog isOpen={isDialogOpen} onOpenChange={setIsDialogOpen} width={500}>
                {isDialogOpen && (
                    <RecordDialogBody
                        title={title}
                        initialShortcuts={parseShortcutList(value)}
                        defaultValue={defaultValue}
                        dialogTitle={dialogTitle}
                        dialogDescription={dialogDescription}
                        saveChangesLabel={saveChangesLabel}
                        currentShortcutsLabel={currentShortcutsLabel}
                        emptyShortcutsLabel={emptyShortcutsLabel}
                        addRecordedLabel={addRecordedLabel}
                        removeShortcutLabel={removeShortcutLabel}
                        resetDefaultLabel={dialogResetDefaultLabel}
                        listeningPrompt={listeningPrompt}
                        clearAllLabel={clearAllLabel}
                        onSubmit={onChange}
                        onClose={() => setIsDialogOpen(false)}
                    />
                )}
            </Dialog>
        </SettingRow>
    );
};

export default ShortcutSetting;
