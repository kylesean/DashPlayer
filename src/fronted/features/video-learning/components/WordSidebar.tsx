import { useMemo, useRef, useState } from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Selector } from '@astryxdesign/core/Selector';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { Upload, Download, List, LocateFixed, Pencil } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '@/fronted/lib/utils';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import ConfirmDeleteButton from '@/fronted/components/shared/common/ConfirmDeleteButton';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import TimeUtil from '@/common/utils/TimeUtil';
import { useTranslation } from 'react-i18next';

export interface WordItem {
  id: number;
  word: string;
  translate: string;
  created_at: string;
  updated_at: string;
  videoCount?: number;
  /** 最近一次被添加视频（生成关联片段）的时间；没有关联片段时为 null。 */
  lastClipAddedAt?: string | null;
}

/** 单词列表排序方式。 */
type SortMode = 'usage' | 'alphabetical' | 'recentVideo';

type Props = {
  words: WordItem[];
  loading: boolean;
  selectedWord: WordItem | null;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onWordClick: (word: WordItem) => void;
  onClearSelection: () => void;
  onExportTemplate: () => void;
  onImportWords: (filePath: string) => void;
  /** 请求编辑某个单词，由页面负责打开编辑弹窗。 */
  onEditWord: (word: WordItem) => void;
  /** 某个单词删除成功后的回调。 */
  onWordDeleted: (word: WordItem) => void;
};

/**
 * 单词列表侧栏：支持搜索、排序模式切换、Excel导入导出及虚拟滚动。
 */
export default function WordSidebar({
  words,
  loading,
  selectedWord,
  searchTerm,
  onSearchChange,
  onWordClick,
  onClearSelection,
  onExportTemplate,
  onImportWords,
  onEditWord,
  onWordDeleted,
}: Props) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { t } = useTranslation('common');
  const [sortMode, setSortMode] = useState<SortMode>('usage');
  // 正在执行删除请求的单词 id，用于按钮转圈与防重复提交
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const displayedWords = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = term
      ? words.filter((word) =>
        word.word.toLowerCase().includes(term) ||
        word.translate?.toLowerCase().includes(term)
      )
      : words;

    const sorted = [...filtered];
    if (sortMode === 'alphabetical') {
      sorted.sort((a, b) => a.word.localeCompare(b.word));
    } else if (sortMode === 'recentVideo') {
      sorted.sort((a, b) => {
        const aAt = a.lastClipAddedAt ?? '';
        const bAt = b.lastClipAddedAt ?? '';
        // 没有关联片段的单词沉底
        if (!aAt && !bAt) return a.word.localeCompare(b.word);
        if (!aAt) return 1;
        if (!bAt) return -1;
        const diff = bAt.localeCompare(aAt);
        return diff !== 0 ? diff : a.word.localeCompare(b.word);
      });
    } else {
      sorted.sort((a, b) => {
        const diff = (b.videoCount || 0) - (a.videoCount || 0);
        return diff !== 0 ? diff : a.word.localeCompare(b.word);
      });
    }
    return sorted;
  }, [words, searchTerm, sortMode]);

  /** 导入单词文件。 */
  const handleImportClick = async () => {
    try {
      const selectedFiles = await videoLearningApi.selectVocabularyFile();
      const filePath = selectedFiles?.[0];
      if (!filePath) {
        return;
      }
      onImportWords(filePath);
    } catch {
      toast.error(t('selectFileFailed'));
    }
  };

  /** 定位当前选中的单词。 */
  const handleLocateCurrent = () => {
    if (!selectedWord) return;
    const index = displayedWords.findIndex(w => w.id === selectedWord.id);
    if (index >= 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index,
        align: 'center',
        behavior: 'smooth'
      });
    }
  };

  /** 显示全部视频（清除单词选择与搜索词）。 */
  const handleShowAll = () => {
    onClearSelection();
    if (searchTerm) {
      onSearchChange('');
    }
  };

  /** 用户确认删除某个单词。 */
  const handleDeleteConfirmed = async (word: WordItem) => {
    setDeletingId(word.id);
    try {
      const result = await videoLearningApi.deleteWord(word.word);
      if (result.success) {
        toast.success(t('wordDeleted'));
        onWordDeleted(word);
      } else {
        toast.error(result.error || t('wordDeleteFailed'));
      }
    } catch {
      toast.error(t('wordDeleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 顶部操作区 */}
      <VStack gap={2} className="p-3 border-b border-border/70 bg-card shrink-0">
        <TextInput
          type="search"
          label={t('wordSearch')}
          isLabelHidden
          placeholder={t('wordSearch')}
          value={searchTerm}
          onChange={(val) => onSearchChange(val)}
          size="sm"
          width="100%"
        />
        <HStack vAlign="center" hAlign="between" gap={1} width="100%">
          <Text type="supporting" color="secondary" hasTabularNumbers maxLines={1}>
            {t('wordCount', { count: words.length })}
            {searchTerm && <span className="ml-1 text-accent">({t('foundWords', { count: displayedWords.length })})</span>}
          </Text>
          <HStack vAlign="center" gap={1}>
            <Selector
              label={t('sortMode')}
              isLabelHidden
              size="sm"
              value={sortMode}
              onChange={(value) => setSortMode(value as SortMode)}
              options={[
                { value: 'usage', label: t('sortByUsage') },
                { value: 'alphabetical', label: t('sortAlphabetical') },
                { value: 'recentVideo', label: t('sortByRecentVideo') }
              ]}
            />
            <IconButton
              label={t('exportTemplate')}
              tooltip={t('exportTemplate')}
              variant="ghost"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={onExportTemplate}
            />
            <IconButton
              label={t('importExcel')}
              tooltip={t('importExcel')}
              variant="ghost"
              size="sm"
              icon={<Upload className="w-3.5 h-3.5" />}
              onClick={() => void handleImportClick()}
            />
            <IconButton
              label={t('showAllVideos')}
              tooltip={t('showAllVideos')}
              variant={selectedWord ? 'ghost' : 'secondary'}
              size="sm"
              icon={<List className="w-3.5 h-3.5" />}
              onClick={handleShowAll}
            />
            <IconButton
              label={t('locateCurrentWord')}
              tooltip={t('locateCurrentWord')}
              variant="ghost"
              size="sm"
              isDisabled={!selectedWord}
              icon={<LocateFixed className="w-3.5 h-3.5" />}
              onClick={handleLocateCurrent}
            />
          </HStack>
        </HStack>
      </VStack>

      {/* 列表区域：使用虚拟列表，占满剩余高度 */}
      <div className="flex-1 min-h-0 pt-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-accent-bg border-t-transparent"></div>
              <span>{t('loadingWords')}</span>
            </div>
          </div>
        ) : displayedWords.length === 0 ? (
          <div className="text-center py-10 text-xs text-muted-foreground px-4">
            {searchTerm ? t('noMatchingWords') : t('wordListEmpty')}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            className="scrollbar-thin"
            data={displayedWords}
            increaseViewportBy={200}
            itemContent={(index, word) => {
              const active = selectedWord?.id === word.id;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className={[
                    'group px-3 py-2 rounded-xl cursor-pointer transition-all text-xs mb-1.5 flex flex-col gap-0.5',
                    active
                      ? 'bg-accent-bg text-on-accent font-medium shadow-2xs'
                      : 'hover:bg-muted/60 text-foreground'
                  ].join(' ')}
                  onClick={() => onWordClick(word)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onWordClick(word);
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="font-semibold text-sm tracking-tight truncate">{word.word}</div>
                    <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditWord(word);
                        }}
                        className={cn(
                          'p-1 rounded-md transition-all cursor-pointer shrink-0',
                          active
                            ? 'text-on-accent/70 hover:text-on-accent hover:bg-on-accent/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/80 opacity-0 group-hover:opacity-100'
                        )}
                        title={t('editWord')}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <ConfirmDeleteButton
                        title={t('deleteWord')}
                        confirmLabel={t('confirmDelete')}
                        deleting={deletingId === word.id}
                        onConfirm={() => handleDeleteConfirmed(word)}
                        triggerClassName={
                          active
                            ? 'text-on-accent/70 hover:text-on-accent'
                            : 'opacity-0 group-hover:opacity-100'
                        }
                      />
                      {!!word.videoCount && word.videoCount > 0 && (
                        <div
                          className={[
                            'text-metadata px-1.5 py-0.5 rounded-md font-medium shrink-0 tabular-nums',
                            active
                              ? 'bg-on-accent/20 text-on-accent'
                              : 'bg-muted text-muted-foreground'
                          ].join(' ')}
                        >
                          {t('videoCount', { count: word.videoCount })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={['flex items-center gap-1.5 text-xs', active ? 'text-on-accent/80' : 'text-muted-foreground'].join(' ')}>
                    <span className="truncate">{word.translate || t('noDefinition')}</span>
                    {word.lastClipAddedAt && (
                      <span
                        className={[
                          'shrink-0 text-xs tabular-nums',
                          active ? 'text-on-accent/60' : 'text-muted-foreground/80'
                        ].join(' ')}
                        title={t('sortByRecentVideo')}
                      >
                        {t('videoAddedAt', { time: TimeUtil.dateToRelativeTime(TimeUtil.isoToDate(word.lastClipAddedAt)) })}
                      </span>
                    )}
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
