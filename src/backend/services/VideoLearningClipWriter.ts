import type { InsertVideoLearningClip } from '@/backend/infrastructure/db/tables/videoLearningClip';
import type { InsertVideoLearningClipWord } from '@/backend/infrastructure/db/tables/videoLearningClipWord';
import type VideoLearningClipRepository from '@/backend/services/repositories/VideoLearningClipRepository';
import type { WordMatchService } from '@/backend/services/WordMatchService';
import type { ClipMeta, ClipSrtLine, OssBaseMeta } from '@/common/types/clipMeta';
import TimeUtil from '@/common/utils/TimeUtil';
import StrUtil from '@/common/utils/str-util';

/**
 * 学习片段写入器：片段记录、关联词行的构建与落库。
 *
 * 从 VideoLearningService 拆出的用意：addToDb 与 syncFromOss 里「构建片段行 +
 * 计算关联词」的代码原本逐字重复两份，写入路径（单条保存、全量重建、删除、
 * 存在性检查）也散落在服务各处。收敛到一个类后，调用方（编排服务）只负责
 * 何时写、写入器负责怎么写。
 *
 * 并发约定：本类不持锁；同步与裁切任务共用 video-learning-sync 互斥锁，
 * 调用方在锁内调用这些方法。
 */
export default class VideoLearningClipWriter {
    constructor(
        private readonly deps: {
            /** 学习片段仓储。 */
            clipRepository: VideoLearningClipRepository;
            /** 词表匹配服务，用于从片段字幕计算关联词。 */
            wordMatchService: WordMatchService;
        }
    ) {}

    /**
     * 从片段元数据中取片段字幕原文（isClip 行的 contentEn 拼接）。
     *
     * @param source 片段元数据。
     * @returns 片段字幕原文；没有片段行时为空串。
     */
    public extractClipText(source: Pick<ClipMeta & OssBaseMeta, 'clip_content'>): string {
        const srtLines: ClipSrtLine[] = source.clip_content ?? [];
        return srtLines.filter(e => e.isClip).map(e => e.contentEn).join('\n');
    }

    /**
     * 由片段元数据构建数据库行：上下文与片段字幕按是否为片段行拆开拼接。
     *
     * @param source 片段元数据（key、video_name 与 clip_content 必填）。
     * @returns 待写入的片段行。
     */
    public buildClipRecord(source: Pick<ClipMeta & OssBaseMeta, 'key' | 'video_name' | 'clip_content'>): InsertVideoLearningClip {
        const srtLines: ClipSrtLine[] = source.clip_content ?? [];
        const srtContext = srtLines.filter(e => !e.isClip).map(e => e.contentEn).join('\n');
        const srtClip = this.extractClipText(source);

        return {
            key: source.key,
            video_name: source.video_name,
            srt_clip: srtClip,
            srt_context: srtContext,
            created_at: TimeUtil.timeUtc(),
            updated_at: TimeUtil.timeUtc()
        };
    }

    /**
     * 由片段字幕文本计算关联词行；空白字幕返回空数组。
     *
     * @param clipKey 片段键。
     * @param srtClip 片段字幕原文。
     * @returns 关联词行。
     */
    public async buildWordRelations(clipKey: string, srtClip: string): Promise<InsertVideoLearningClipWord[]> {
        if (StrUtil.isNotBlank(srtClip)) {
            const matches = await this.deps.wordMatchService.matchWordsInText(srtClip);
            const uniqueWords = Array.from(
                new Set(
                    matches
                        .map(m => (m.databaseWord?.word || m.normalized || m.original || '').toLowerCase())
                        .filter(Boolean)
                )
            );

            return uniqueWords.map(word => ({
                clip_key: clipKey,
                word,
                created_at: TimeUtil.timeUtc(),
                updated_at: TimeUtil.timeUtc()
            }));
        }
        return [];
    }

    /**
     * 将远端片段元数据及其关联词写入本地数据库。
     *
     * @param metaData 远端片段元数据。
     */
    public async saveClipFromMeta(metaData: ClipMeta & OssBaseMeta): Promise<void> {
        const clip = this.buildClipRecord(metaData);
        const wordRelations = await this.buildWordRelations(metaData.key, clip.srt_clip ?? '');
        await this.deps.clipRepository.saveClipWithWords(clip, wordRelations);
    }

    /**
     * 用完整片段与关联词列表全量重建本地索引。
     *
     * @param clips 待写入的片段行。
     * @param wordRelations 待写入的关联词行。
     */
    public async replaceAll(clips: InsertVideoLearningClip[], wordRelations: InsertVideoLearningClipWord[]): Promise<void> {
        await this.deps.clipRepository.replaceAll(clips, wordRelations);
    }

    /**
     * 检查片段是否已写入本地数据库。
     *
     * @param key 片段键。
     * @returns 片段存在时返回 true。
     */
    public async exists(key: string): Promise<boolean> {
        return await this.deps.clipRepository.exists(key);
    }

    /**
     * 删除片段及其关联词。
     *
     * @param key 片段键。
     */
    public async deleteClipWithWords(key: string): Promise<void> {
        await this.deps.clipRepository.deleteClipWithWords(key);
    }
}
