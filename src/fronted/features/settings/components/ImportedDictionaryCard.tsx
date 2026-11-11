import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { ImportedDictionaryVO } from '@/common/contracts/imported-dictionary';
import { dictionaryImportApi } from '@/fronted/features/settings/dictionaryImportApi';

/** SWR 缓存键。 */
const IMPORTED_DICTIONARIES_KEY = 'dictionary/imported-list';

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
    const [busy, setBusy] = useState(false);

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

    /** 删除词典；先确认避免误删。 */
    const removeDictionary = async (dictionary: ImportedDictionaryVO): Promise<void> => {
        if (!window.confirm(t('resources.dictionaryPack.removeConfirm', { name: dictionary.name }))) {
            return;
        }
        try {
            await dictionaryImportApi.remove(dictionary.id);
            await mutate();
        } catch (error) {
            toast.error(t('resources.dictionaryPack.removeFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
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
                        onClick={() => void removeDictionary(dictionary)}
                    />
                </HStack>
            ))}
            <Text size="2xs" color="secondary">{t('resources.dictionaryPack.formats')}</Text>
        </VStack>
    );
}
