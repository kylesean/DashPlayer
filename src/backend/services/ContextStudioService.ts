import fs from 'node:fs/promises';
import path from 'node:path';
import { desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { inject, injectable, optional } from 'inversify';
import type { Db } from '@/backend/infrastructure/db/createDb';
import { wordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { watchHistory } from '@/backend/infrastructure/db/tables/watchHistory';
import { sentenceTranslates } from '@/backend/infrastructure/db/tables/sentenceTranslates';
import TYPES from '@/backend/ioc/types';
import type SavedSentenceRepository from '@/backend/services/repositories/SavedSentenceRepository';
import type MediaPathRegistry from '@/backend/services/MediaPathRegistry';
import MatchSrt from '@/backend/utils/MatchSrt';
import { parseAss, parseSrt, resegmentIntoMeaningGroups, type SrtLine } from '@/common/utils/subtitle';
import { findBetterEnglishSubtitle } from '@/common/utils/subtitle/preferred-track';
import MediaUtil from '@/common/utils/MediaUtil';
import type {
    ReaderDocumentSummary,
    SavedSentenceVO,
    SaveSentenceInput,
    UpdateSavedSentenceInput,
    WordContextOccurrence,
} from '@/common/types/contextStudio';

interface VideoMetadataEntry {
    title: string;
    videoPath: string;
    srtFile?: string | null;
}

interface SubtitleCandidates {
    raw: SrtLine[];
    segmented: SrtLine[];
}

function normalizeSubtitleText(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function resolveSubtitlePathForVideo(meta: VideoMetadataEntry): Promise<string | null> {
    if (meta.srtFile && MediaUtil.isSubtitle(meta.srtFile)) {
        try {
            await fs.access(meta.srtFile);
            const dir = path.dirname(meta.srtFile);
            const names = await fs.readdir(dir).catch(() => [] as string[]);
            const better = findBetterEnglishSubtitle(path.basename(meta.srtFile), names);
            return better ? path.join(dir, better) : meta.srtFile;
        } catch {
            // 已记录字幕失效时继续按视频目录回退匹配
        }
    }

    if (!meta.videoPath) return null;
    try {
        const videoDir = path.dirname(meta.videoPath);
        const names = await fs.readdir(videoDir);
        const subtitlePaths = names
            .filter((name) => MediaUtil.isSubtitle(name))
            .map((name) => path.join(videoDir, name));
        if (subtitlePaths.length === 0) return null;
        const matched = MatchSrt.matchOneDetail(meta.videoPath, subtitlePaths);
        return matched && !matched.suspicious ? matched.path : null;
    } catch {
        return null;
    }
}

async function readSubtitleCandidates(meta: VideoMetadataEntry): Promise<SubtitleCandidates> {
    const srtPath = await resolveSubtitlePathForVideo(meta);
    if (!srtPath) {
        return { raw: [], segmented: [] };
    }
    try {
        const content = await fs.readFile(srtPath, 'utf-8');
        const raw = MediaUtil.isAss(srtPath) ? parseAss(content) : parseSrt(content);
        const segmented = resegmentIntoMeaningGroups(raw);
        return { raw, segmented };
    } catch {
        return { raw: [], segmented: [] };
    }
}

function matchSubtitleTimeRange(
    candidates: SubtitleCandidates,
    sentenceIndex?: number | null,
    text?: string,
): { start: number; end: number } | undefined {
    const { segmented, raw } = candidates;
    if (segmented.length === 0 && raw.length === 0) {
        return undefined;
    }

    const normTarget = text ? normalizeSubtitleText(text) : '';
    if (normTarget) {
        const segMatch = segmented.find((line) => normalizeSubtitleText(line.contentEn) === normTarget);
        if (segMatch) {
            return { start: segMatch.start, end: segMatch.end };
        }
        const rawMatch = raw.find((line) => normalizeSubtitleText(line.contentEn) === normTarget);
        if (rawMatch) {
            return { start: rawMatch.start, end: rawMatch.end };
        }
        // 兼容跨多条 raw cue 合并或截断的句子：用连续子串定位时间段
        const spanMatches = raw.filter((line) => {
            const normLine = normalizeSubtitleText(line.contentEn);
            return normLine.length >= 6 && normTarget.includes(normLine);
        });
        if (spanMatches.length > 0) {
            return {
                start: spanMatches[0].start,
                end: spanMatches[spanMatches.length - 1].end,
            };
        }
    }

    if (typeof sentenceIndex === 'number') {
        const bySegmented = segmented[sentenceIndex] ?? segmented.find((line) => line.index === sentenceIndex);
        if (bySegmented) {
            return { start: bySegmented.start, end: bySegmented.end };
        }
        const byRaw = raw.find((line) => line.index === sentenceIndex) ?? raw[sentenceIndex];
        if (byRaw) {
            return { start: byRaw.start, end: byRaw.end };
        }
    }

    return undefined;
}

/**
 * 语境工坊与精读文稿核心业务服务。
 *
 * 负责统一管理收藏金句、聚合单词在真实视频中的轻量语境出处（不依赖物理切片），
 * 并为精读文稿提供带有字幕的媒体文档清单。
 */
@injectable()
export default class ContextStudioService {
    constructor(
        @inject(TYPES.SavedSentenceRepository) private readonly savedSentenceRepo: SavedSentenceRepository,
        @inject(TYPES.Database) private readonly db: Db,
        @optional() @inject(TYPES.MediaPathRegistry) private readonly mediaPathRegistry?: MediaPathRegistry,
    ) {}

    public async saveSentence(input: SaveSentenceInput): Promise<SavedSentenceVO> {
        let videoTitle = input.videoTitle?.trim() || '';
        if (!videoTitle && input.videoId) {
            const rows = await this.db
                .select({ fileName: watchHistory.file_name })
                .from(watchHistory)
                .where(eq(watchHistory.id, input.videoId))
                .limit(1);
            if (rows[0]?.fileName) {
                videoTitle = MediaUtil.formatDisplayTitle(rows[0].fileName);
            }
        }
        return this.savedSentenceRepo.upsert({
            ...input,
            videoTitle,
        });
    }

    public async unsaveSentence(sentenceKey: string): Promise<boolean> {
        return this.savedSentenceRepo.deleteByKey(sentenceKey);
    }

    private async loadVideoMetadataMap(videoIds: string[]): Promise<Map<string, VideoMetadataEntry>> {
        const map = new Map<string, VideoMetadataEntry>();
        if (videoIds.length === 0) {
            return map;
        }
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(inArray(watchHistory.id, videoIds));
        for (const row of rows) {
            const videoPath = path.join(row.base_path, row.file_name);
            this.mediaPathRegistry?.allowFile(videoPath);
            map.set(row.id, {
                title: MediaUtil.formatDisplayTitle(row.file_name),
                videoPath,
                srtFile: row.srt_file,
            });
        }
        return map;
    }

    public async listSavedSentences(): Promise<SavedSentenceVO[]> {
        const list = await this.savedSentenceRepo.findAll();
        const videoIds = Array.from(new Set(list.map((s) => s.videoId).filter(Boolean)));
        if (videoIds.length === 0) {
            return list;
        }
        const videoMap = await this.loadVideoMetadataMap(videoIds);
        return list.map((item) => {
            const meta = videoMap.get(item.videoId);
            return meta?.videoPath ? { ...item, videoPath: meta.videoPath } : item;
        });
    }

    public async listSavedKeysByVideo(videoId: string): Promise<string[]> {
        return this.savedSentenceRepo.findKeysByVideoId(videoId);
    }

    public async updateSavedSentence(input: UpdateSavedSentenceInput): Promise<SavedSentenceVO | null> {
        return this.savedSentenceRepo.updateNoteOrTag(input);
    }

    /**
     * 聚合某个单词在真实视频语境中的出现记录。
     *
     * 基于 wordEncounter 事件流与 watchHistory 元数据，零物理视频切片依赖。
     */
    public async getWordContexts(word: string): Promise<WordContextOccurrence[]> {
        const normalized = word.trim().toLowerCase();
        if (!normalized) {
            return [];
        }

        const encounters = await this.db
            .select()
            .from(wordEncounter)
            .where(or(eq(wordEncounter.lemma, normalized), eq(wordEncounter.word, normalized)))
            .orderBy(desc(wordEncounter.created_at), desc(wordEncounter.id))
            .limit(40);

        const filtered = encounters.filter((item) => Boolean(item.context && item.context.trim().length > 0));
        if (filtered.length === 0) {
            return [];
        }

        const videoIds = Array.from(
            new Set(filtered.map((item) => item.video_id).filter((id): id is string => Boolean(id))),
        );
        const videoMap = await this.loadVideoMetadataMap(videoIds);
        const subtitleCache = new Map<string, SubtitleCandidates>();
        await Promise.all(
            Array.from(videoMap.entries()).map(async ([videoId, meta]) => {
                subtitleCache.set(videoId, await readSubtitleCandidates(meta));
            }),
        );

        const seenContexts = new Set<string>();
        const occurrences: WordContextOccurrence[] = [];

        for (const item of filtered) {
            const text = item.context?.trim() ?? '';
            const dedupeKey = `${item.video_id ?? ''}:${item.sentence_index ?? ''}:${text.toLowerCase()}`;
            if (seenContexts.has(dedupeKey)) {
                continue;
            }
            seenContexts.add(dedupeKey);

            const videoMeta = item.video_id ? videoMap.get(item.video_id) : undefined;
            const candidates = item.video_id ? subtitleCache.get(item.video_id) : undefined;
            const matchedRange = candidates
                ? matchSubtitleTimeRange(candidates, item.sentence_index, text)
                : undefined;

            occurrences.push({
                id: `enc-${item.id}`,
                videoId: item.video_id ?? '',
                videoTitle: videoMeta?.title || '未知视频',
                videoPath: videoMeta?.videoPath,
                fileHash: item.file_hash ?? undefined,
                sentenceIndex: item.sentence_index ?? undefined,
                startTime: matchedRange?.start,
                endTime: matchedRange?.end,
                context: text,
                createdAt: item.created_at,
                source: 'encounter',
            });
        }

        // 若句子原文存在翻译缓存，顺带补齐中文译文
        const sentenceTexts = Array.from(new Set(occurrences.map((o) => o.context).filter(Boolean)));
        if (sentenceTexts.length > 0) {
            const transRows = await this.db
                .select()
                .from(sentenceTranslates)
                .where(inArray(sentenceTranslates.sentence, sentenceTexts));
            const transMap = new Map<string, string>();
            for (const row of transRows) {
                if (row.sentence && row.translate) {
                    transMap.set(row.sentence, row.translate);
                }
            }
            for (const occ of occurrences) {
                const zh = transMap.get(occ.context);
                if (zh) {
                    occ.contextZh = zh;
                }
            }
        }

        return occurrences;
    }

    /**
     * 列出带有字幕文件的视频文档，供「精读文稿（Script Reader）」选择阅读。
     */
    public async listReaderDocuments(): Promise<ReaderDocumentSummary[]> {
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(isNotNull(watchHistory.srt_file))
            .orderBy(desc(watchHistory.updated_at))
            .limit(100);

        return rows
            .filter((row) => Boolean(row.srt_file && row.srt_file.trim().length > 0))
            .map((row) => {
                const videoPath = path.join(row.base_path, row.file_name);
                this.mediaPathRegistry?.allowFile(videoPath);
                return {
                    videoId: row.id,
                    title: MediaUtil.formatDisplayTitle(row.file_name),
                    srtFile: row.srt_file ?? '',
                    videoPath,
                    updatedAt: row.updated_at,
                };
            });
    }
}
