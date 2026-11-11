import { Play, Info } from 'lucide-react';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import ConfirmDeleteButton from '@/fronted/components/shared/common/ConfirmDeleteButton';
import type { VideoClip } from '../types';
import UrlUtil from '@/common/utils/UrlUtil';
import TimeUtil from '@/common/utils/TimeUtil';
import { cn } from '@/fronted/lib/utils';
import { useTranslation } from 'react-i18next';

type Props = {
  clips: VideoClip[];
  playingKey?: string;
  thumbnails?: Record<string, string>;
  onClickClip: (index: number) => void;
  /** 正在删除的片段键，用于按钮转圈与防重复提交。 */
  deletingKey?: string | null;
  /** 请求删除某个片段，删除逻辑与状态刷新由页面负责。 */
  onDeleteClip: (index: number) => void;
};

export default function ClipGrid({ clips, playingKey, thumbnails, onClickClip, deletingKey, onDeleteClip }: Props) {
  const { t } = useTranslation('common');
  const getThumbnailUrlSync = (clip: VideoClip): string => {
    const raw = thumbnails?.[clip.key];
    if (!raw) return '';
    if (
        raw.startsWith('data:') ||
        raw.startsWith('http://') ||
        raw.startsWith('https://') ||
        raw.startsWith('media://')
    ) {
        return raw;
    }
    return UrlUtil.toUrl(raw);
  };

  if (clips.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <Play className="w-12 h-12 mx-auto mb-4 opacity-70" />
          <p className="text-lg mb-2">{t('clipGridEmptyTitle')}</p>
          <p className="text-sm">{t('clipGridEmptyDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto scrollbar-none p-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {clips.map((clip, idx) => {
          const title = clip.videoName.split('/').pop() || 'Unknown';
          const thumb = getThumbnailUrlSync(clip);
          const mainClip = clip.clipContent.find((c) => c.isClip) || clip.clipContent[0];
          const subtitle = `${mainClip?.contentEn || ''} ${mainClip?.contentZh || ''}`.trim();
          const isPlaying = clip.key === playingKey;

              return (
                <div
                  key={clip.key}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'overflow-hidden rounded-xl cursor-pointer transition-all duration-200 group bg-card text-card-foreground border border-border/60 flex flex-col',
                    isPlaying
                      ? 'ring-2 ring-accent-bg border-transparent shadow-sm'
                      : 'hover:border-border hover:shadow-sm',
                    clip.sourceType === 'local' && !isPlaying
                      ? 'border-dashed border-media-amber/80'
                      : undefined
                  )}
                  onClick={() => onClickClip(idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onClickClip(idx);
                    }
                  }}
                >
                  {/* 视频预览图 */}
                  <div className="relative bg-muted/60 aspect-[16/8.5] flex items-center justify-center overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className={cn(
                          'w-full h-full flex items-center justify-center text-media-fg/80',
                          clip.sourceType === 'local'
                            ? 'bg-gradient-to-br from-media-amber to-media-orange'
                            : 'bg-gradient-to-br from-media-slate to-media-slate-deep'
                        )}
                      >
                        <Play className="w-7 h-7" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-media-bg/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-8 h-8 rounded-full bg-background/90 text-foreground flex items-center justify-center shadow-sm">
                        <Play className="w-4 h-4 fill-current translate-x-0.5" />
                      </div>
                    </div>

                    {/* 状态标识 */}
                    {isPlaying && (
                      <div className="absolute top-2 left-2 bg-accent-bg text-on-accent text-metadata font-medium px-2 py-0.5 rounded-md shadow-2xs">
                        {t('clipGridPlaying')}
                      </div>
                    )}
                    {clip.sourceType === 'local' && !isPlaying && (
                      <div className="absolute top-2 left-2 bg-warning/90 text-media-fg text-metadata font-medium px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs backdrop-blur-xs">
                        <div className="w-1.5 h-1.5 bg-current rounded-full animate-pulse"></div>
                        {t('clipGridProcessing')}
                      </div>
                    )}

                    {/* hover 操作区：删除（仅已完成片段）与详情提示 */}
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {clip.sourceType !== 'local' && (
                        <ConfirmDeleteButton
                          title={t('deleteClip')}
                          confirmLabel={t('confirmDelete')}
                          deleting={deletingKey === clip.key}
                          onConfirm={() => onDeleteClip(idx)}
                          triggerClassName="bg-media-bg/40 backdrop-blur-xs text-media-fg/80 hover:bg-media-bg/60 hover:text-media-fg"
                        />
                      )}
                      <Tooltip
                        placement="below"
                        content={
                          <div className="space-y-1 text-xs">
                            <div>
                              <strong>{t('status')}:</strong> {clip.sourceType === 'local' ? t('clipGridProcessing') : t('clipGridDone')}
                            </div>
                            <div>
                              <strong>{t('videoName')}:</strong> {title}
                            </div>
                            <div>
                              <strong>{t('timeRange')}:</strong> {TimeUtil.secondToTimeStrCompact(mainClip?.start || 0)} -{' '}
                              {TimeUtil.secondToTimeStrCompact(mainClip?.end || 0)}
                            </div>
                            <div>
                              <strong>{t('createdAt')}:</strong> {new Date(clip.createdAt).toLocaleString()}
                            </div>
                          </div>
                        }
                      >
                        <div className="bg-media-bg/40 backdrop-blur-xs text-media-fg/80 p-1 rounded-md cursor-default hover:bg-media-bg/60 hover:text-media-fg transition-colors">
                          <Info className="w-3.5 h-3.5" />
                        </div>
                      </Tooltip>
                    </div>
                  </div>

                  {/* 视频信息 */}
                  <div className="p-2.5 bg-card flex-1 flex items-center">
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">{subtitle}</p>
                  </div>
                </div>
              );
        })}
      </div>
    </div>
  );
}
