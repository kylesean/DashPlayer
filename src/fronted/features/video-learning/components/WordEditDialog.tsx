import { useState } from 'react';
import { Sparkles, BookMarked } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';

/** 编辑弹窗可接收的最小单词信息。 */
export interface EditableWordItem {
  /** 编辑前的单词，作为后端定位记录的业务键。 */
  word: string;
  /** 当前释义。 */
  translate: string;
}

interface WordEditDialogProps {
  open: boolean;
  /** 待编辑的单词；open 为 true 时必须提供。 */
  wordItem: EditableWordItem | null;
  onOpenChange: (open: boolean) => void;
  /**
   * 保存成功后的回调。
   *
   * @param newWord 保存后的单词（已按后端规则小写化）。
   */
  onSaved: (newWord: string) => void;
}

interface WordEditFormProps {
  /** 待编辑的单词。 */
  wordItem: EditableWordItem;
  onOpenChange: (open: boolean) => void;
  onSaved: (newWord: string) => void;
}

/**
 * 单词编辑表单：支持修改单词与释义，并可调用 AI 生成释义。
 *
 * 行为说明：
 * - 单词是业务键，保存时把编辑前的单词一并传给后端用于定位记录；
 * - AI 生成结果写入释义输入框，用户可继续编辑后再保存；
 * - 表单初始值来自 props，切换单词时由外层通过 key 重置。
 */
function WordEditForm({ wordItem, onOpenChange, onSaved }: WordEditFormProps) {
  const { t } = useTranslation('common');
  const [word, setWord] = useState(wordItem.word);
  const [translate, setTranslate] = useState(wordItem.translate || '');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  /** 调用 AI 为当前输入的单词生成释义并填入释义框。 */
  const handleGenerate = async () => {
    const targetWord = word.trim();
    if (!targetWord) {
      toast.error(t('wordCannotBeEmpty'));
      return;
    }

    setGenerating(true);
    try {
      const result = await videoLearningApi.generateDefinition(targetWord);
      if (result.success && result.data) {
        setTranslate(result.data);
      } else {
        toast.error(result.error || t('generateDefinitionFailed'));
      }
    } catch {
      toast.error(t('generateDefinitionFailed'));
    } finally {
      setGenerating(false);
    }
  };

  /** 提交保存；单词变化时后端会同步迁移片段关联。 */
  const handleSave = async () => {
    const nextWord = word.trim();
    if (!nextWord) {
      toast.error(t('wordCannotBeEmpty'));
      return;
    }

    setSaving(true);
    try {
      const result = await videoLearningApi.updateWord(wordItem.word, nextWord, translate.trim());
      if (result.success) {
        toast.success(t('wordSaved'));
        onOpenChange(false);
        onSaved(nextWord.toLowerCase());
      } else {
        toast.error(result.error || t('wordSaveFailed'));
      }
    } catch {
      toast.error(t('wordSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <VStack gap={4} width="100%">
      <DialogHeader
        title={t('editWord')}
        startContent={<BookMarked className="w-4 h-4 text-accent" />}
        onOpenChange={onOpenChange}
      />

      <TextInput
        label={t('wordField')}
        value={word}
        onChange={(val) => setWord(val)}
        placeholder={t('wordField')}
        isRequired
        width="100%"
      />

      <VStack gap={1.5} width="100%">
        <HStack vAlign="center" hAlign="between" width="100%">
          <Text type="label" weight="medium">
            {t('definitionField')}
          </Text>
          <Button
            label={generating ? t('generating') : t('aiGenerateDefinition')}
            variant="ghost"
            size="sm"
            icon={<Sparkles className="w-3.5 h-3.5" />}
            isLoading={generating}
            isDisabled={saving}
            onClick={handleGenerate}
          />
        </HStack>
        <TextArea
          label={t('definitionField')}
          isLabelHidden
          value={translate}
          onChange={(val) => setTranslate(val)}
          placeholder={t('noDefinition')}
          rows={4}
          width="100%"
        />
      </VStack>

      <HStack vAlign="center" hAlign="end" gap={2} width="100%">
        <Button
          label={t('cancel')}
          variant="secondary"
          size="sm"
          onClick={() => onOpenChange(false)}
          isDisabled={saving}
        />
        <Button
          label={t('save')}
          variant="primary"
          size="sm"
          onClick={handleSave}
          isLoading={saving}
          isDisabled={generating}
        />
      </HStack>
    </VStack>
  );
}

/**
 * 单词编辑弹窗；按单词名重置内部表单状态。
 */
export default function WordEditDialog({ open, wordItem, onOpenChange, onSaved }: WordEditDialogProps) {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      purpose="form"
      width={440}
      padding={4}
    >
      {wordItem && (
        <WordEditForm
          key={wordItem.word}
          wordItem={wordItem}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}
