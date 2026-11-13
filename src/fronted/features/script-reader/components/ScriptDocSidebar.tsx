import { FileText, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReaderDocumentSummary } from '@/common/types/contextStudio';
import { cn } from '@/fronted/lib/utils';
import { getSavedReaderProgress } from '../lib/readerProgress';

interface ScriptDocSidebarProps {
    documents: readonly ReaderDocumentSummary[];
    loadingDocs: boolean;
    docQuery: string;
    onDocQueryChange: (query: string) => void;
    activeVideoId?: string;
    playingVideoId?: string | null;
    onSelectDoc: (videoId: string) => void;
}

/**
 * 精读文稿左侧目录：支持标题筛选、高亮正在播放的视频、显示上次阅读位置提示。
 */
export function ScriptDocSidebar({
    documents,
    loadingDocs,
    docQuery,
    onDocQueryChange,
    activeVideoId,
    playingVideoId,
    onSelectDoc,
}: ScriptDocSidebarProps) {
    const { t } = useTranslation('pages');

    return (
        <aside className="w-64 shrink-0 border-r border-border/40 bg-surface/40 flex flex-col min-h-0">
            <div className="p-3 border-b border-border/40 shrink-0">
                <div className="relative flex items-center">
                    <Search className="h-3.5 w-3.5 text-secondary absolute left-2.5 pointer-events-none" />
                    <input
                        type="text"
                        value={docQuery}
                        onChange={(e) => onDocQueryChange(e.target.value)}
                        placeholder={t('scriptReader.searchDocs', { defaultValue: '搜索文稿...' })}
                        className="w-full rounded-lg border border-border/50 bg-body pl-8 pr-3 py-1.5 text-sm text-primary placeholder:text-secondary/70 focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                {loadingDocs ? (
                    <div className="p-4 text-center text-sm text-secondary">
                        {t('scriptReader.loadingDocs', { defaultValue: '加载文稿中...' })}
                    </div>
                ) : documents.length === 0 ? (
                    <div className="p-4 text-center text-sm text-secondary">
                        {t('scriptReader.emptyDocs', { defaultValue: '暂无文稿' })}
                    </div>
                ) : (
                    documents.map((doc) => {
                        const active = doc.videoId === activeVideoId;
                        const isPlayingInPlayer = doc.videoId === playingVideoId;
                        const savedIndex = getSavedReaderProgress(doc.videoId);

                        return (
                            <button
                                key={doc.videoId}
                                type="button"
                                onClick={() => onSelectDoc(doc.videoId)}
                                className={cn(
                                    'w-full text-left rounded-lg px-2.5 py-2 transition-colors cursor-pointer flex items-start gap-2',
                                    active
                                        ? 'bg-accent-bg/15 text-accent font-medium'
                                        : 'text-primary/85 hover:bg-muted/60',
                                )}
                            >
                                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-75" />
                                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                    <span className="text-sm line-clamp-2 leading-snug">{doc.title}</span>
                                    {(isPlayingInPlayer || (savedIndex !== null && savedIndex > 0)) && (
                                        <span className="text-metadata text-secondary font-normal">
                                            {isPlayingInPlayer
                                                ? t('scriptReader.nowPlayingTag', { defaultValue: '当前播放' })
                                                : t('scriptReader.savedProgressTag', {
                                                    defaultValue: '上次读到第 {{num}} 句',
                                                    num: savedIndex! + 1,
                                                })}
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
