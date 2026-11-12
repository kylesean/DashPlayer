import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { ImportedDictionaryVO } from '@/common/contracts/imported-dictionary';
import type { BuiltinDictionaryMetaVO } from '@/common/contracts/builtin-dictionary';
import { dictionaryImportApi } from '@/fronted/features/settings/dictionaryImportApi';

/** SWR 缓存键。 */
const IMPORTED_DICTIONARIES_KEY = 'dictionary/imported-list';
/** 内置词典元信息的 SWR 缓存键。 */
const BUILTIN_DICTIONARY_META_KEY = 'dictionary/builtin-meta';

/**
 * 用户自备词典的导入、启停与删除卡片。
 *
 * 应用不内置、不下载任何版权词典；这里只是把用户自己的合法词典文件
 * 转换为应用内统一格式并参与查词。
 */
export default function ImportedDictionaryCard() {
    const { t } = useI18nTranslation('settings');
    const { data: dictionaries = [], mutate, isLoading } = useSWR<ImportedDictionaryVO[]>(
        IMPORTED_DICTIONARIES_KEY,
        dictionaryImportApi.list,
    );
    /**
     * 内置词典元信息。
     *
     * 失败时静默不展示这一行：内置词典缺失是打包问题，不该在设置页
     * 弹一个红色错误把「导入词典」这块也一起打断。
     */
    const { data: builtinMeta } = useSWR<BuiltinDictionaryMetaVO>(
        BUILTIN_DICTIONARY_META_KEY,
        dictionaryImportApi.builtinMeta,
        { shouldRetryOnError: false },
    );
    const [busy, setBusy] = useState(false);
    /** 待确认删除的词典；null 表示没有打开确认弹窗。 */
    const [pendingDelete, setPendingDelete] = useState<ImportedDictionaryVO | null>(null);
    const [removing, setRemoving] = useState(false);

    /** 选择文件并导入。 */
    const importDictionary = async (): Promise<void> => {
        setBusy(true);
        try {
            const [filePath] = await dictionaryImportApi.selectFile();
            if (!filePath) {
                return;
            }
            await dictionaryImportApi.import(filePath);
            await mutate();
            toast.success(t('resources.dictionaryPack.imported'));
        } catch (error) {
            toast.error(t('resources.dictionaryPack.importFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        } finally {
            setBusy(false);
        }
    };

    /** 删除词典；确认由 AlertDialog 统一承担。 */
    const removeDictionary = async (dictionary: ImportedDictionaryVO): Promise<boolean> => {
        try {
            await dictionaryImportApi.remove(dictionary.id);
            await mutate();
            return true;
        } catch (error) {
            toast.error(t('resources.dictionaryPack.removeFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
            return false;
        }
    };

    /** 切换词典启停。 */
    const toggleDictionary = async (dictionary: ImportedDictionaryVO, enabled: boolean): Promise<void> => {
        try {
            await dictionaryImportApi.setEnabled(dictionary.id, enabled);
            await mutate();
        } catch (error) {
            toast.error(t('resources.dictionaryPack.saveFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        }
    };

    return (
        <VStack gap={3} width="100%">
            <HStack justify="between" vAlign="center" gap={4} width="100%">
                <VStack gap={0.5}>
                    <Text type="body" weight="medium">{t('resources.dictionaryPack.title')}</Text>
                    <Text type="supporting" color="secondary">
                        {t('resources.dictionaryPack.description')}
                    </Text>
                </VStack>
                <Button
                    variant="secondary"
                    size="sm"
                    label={t('resources.dictionaryPack.import')}
                    isLoading={busy}
                    onClick={() => void importDictionary()}
                />
            </HStack>

            {isLoading && (
                <Text type="supporting" color="secondary">{t('resources.dictionaryPack.loading')}</Text>
            )}
            {/*
              内置词典也占一行：用户问「我装了几本词典」时，内置那本必须算进来，
              否则会得到「一本都没有」的错误印象。
            */}
            {builtinMeta && (
                <HStack gap={3} align="center" width="100%">
                    <VStack gap={0.5} width="100%">
                        <Text weight="semibold">{t('resources.dictionaryPack.builtinName')}</Text>
                        <Text type="supporting" color="secondary">
                            {t('resources.dictionaryPack.builtinMeta', {
                                count: builtinMeta.wordCount,
                                source: builtinMeta.source.toUpperCase(),
                                version: builtinMeta.sourceVersion,
                            })}
                        </Text>
                    </VStack>
                </HStack>
            )}
            {!isLoading && dictionaries.length === 0 && (
                <Text type="supporting" color="secondary">{t('resources.dictionaryPack.empty')}</Text>
            )}
            {dictionaries.map((dictionary) => (
                <HStack key={dictionary.id} gap={3} align="center" width="100%">
                    <VStack gap={0.5} width="100%">
                        <Text weight="semibold">{dictionary.name}</Text>
                        <Text type="supporting" color="secondary">
                            {t('resources.dictionaryPack.meta', {
                                count: dictionary.entryCount,
                                format: dictionary.format,
                            })}
                        </Text>
                    </VStack>
                    <Switch
                        label={dictionary.name}
                        isLabelHidden
                        value={dictionary.enabled}
                        onChange={(checked) => void toggleDictionary(dictionary, checked)}
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        label={t('resources.dictionaryPack.remove')}
                        onClick={() => setPendingDelete(dictionary)}
                    />
                </HStack>
            ))}
            <Text size="2xs" color="secondary">{t('resources.dictionaryPack.formats')}</Text>
            <AlertDialog
                isOpen={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDelete(null);
                }}
                title={t('resources.dictionaryPack.remove')}
                description={t('resources.dictionaryPack.removeConfirm', { name: pendingDelete?.name ?? '' })}
                actionLabel={t('resources.dictionaryPack.remove')}
                cancelLabel={t('common.cancel')}
                actionVariant="destructive"
                isActionLoading={removing}
                onAction={async () => {
                    const target = pendingDelete;
                    if (!target || removing) return;
                    setRemoving(true);
                    try {
                        if (await removeDictionary(target)) {
                            setPendingDelete(null);
                        }
                    } finally {
                        setRemoving(false);
                    }
                }}
            />
        </VStack>
    );
}
