import path from 'path';
import { inject, injectable } from 'inversify';

import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import { resolveDictionaryDifficulty } from '@/backend/services/dictionaryDifficulty';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type MediaPathRegistry from '@/backend/services/MediaPathRegistry';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type WatchHistoryRepository from '@/backend/services/repositories/WatchHistoryRepository';
import {
    WatchHistoryProjectType,
    type WatchHistoryRecord,
} from '@/backend/services/repositories/WatchHistoryRepository';
import MatchSrt from '@/backend/utils/MatchSrt';
import { ObjUtil } from '@/backend/utils/ObjUtil';
import { analyzeWords } from '@/backend/utils/language/VocabularyMatcher';
import {
    lexicalSimilarity,
    rankContentCompassCandidates,
    type ContentCompassRankCandidate,
} from '@/common/learning/contentCompass';
import { isContentLemma } from '@/common/learning/contentWords';
import { estimateComprehension, resolveComprehensionBand } from '@/common/learning/comprehension';
import {
    parseAss,
    parseSrt,
    type SrtLine,
} from '@/common/utils/subtitle';
import MediaUtil from '@/common/utils/MediaUtil';
import type {
    ContentCompassEventParams,
    ContentCompassItemVO,
    ContentCompassListParams,
    ContentCompassStatsParams,
    ContentCompassStatsVO,
    ContentCompassVO,
} from '@/common/types/contentCompass';
import type {
    ComprehensionDifficulty,
    ComprehensionWordInput,
} from '@/common/types/subtitleComprehension';

const MAX_CANDIDATES = 12;
const MAX_RECENT_PROFILE_VIDEOS = 5;
const MAX_SAMPLE_LINES = 30;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const MAX_ANALYSIS_CACHE_ENTRIES = 64;
const MAX_REASON_WORDS = 4;
const DEFAULT_STATS_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLAUSE_PATTERN = /[,;:—–]|\b(?:because|although|though|while|whereas|unless|if|which|whose)\b/gi;

/**
 * 内容指南针服务契约。
 */
export default interface ContentCompassService {
    /**
     * 从媒体库中推荐下一段适合观看的内容。
     *
     * 只读取本地字幕与用户学习状态，不调用模型、不访问网络。
     */
    list(params: ContentCompassListParams): Promise<ContentCompassVO>;

    /**
     * 记录推荐曝光或用户反馈。
     */
    recordEvent(params: ContentCompassEventParams): Promise<void>;

    /**
     * 汇总推荐打开率、忽略率与同窗口复习回忆率。
     */
    getStats(params: ContentCompassStatsParams): Promise<ContentCompassStatsVO>;
}

interface CandidateRecord {
    record: WatchHistoryRecord;
    videoPath: string;
    subtitlePath: string;
}

interface AnalyzedSentence {
    words: Array<{ lemma: string; difficulty: ComprehensionDifficulty }>;
    wordCount: number;
    clauseCount: number;
    longWordCount: number;
}

interface SubtitleAnalysis {
    contentLemmas: Set<string>;
    normalizedFrequency: Map<string, number>;
    sentences: AnalyzedSentence[];
}

/**
 * 本地内容指南针。
 *
 * 视频级理解度、用户词复现与最近观看主题共同形成可解释排序。首版不下载
 * embedding 模型，而用字幕词频向量与预置词典做确定性近似；后续可在同一
 * 接口内替换为本地向量索引。
 */
@injectable()
export class ContentCompassServiceImpl implements ContentCompassService {
    private readonly logger = getMainLogger('ContentCompassService');
    private readonly analysisCache = new Map<string, SubtitleAnalysis>();
    private readonly dictionaryCache = new Map<string, ComprehensionDifficulty>();
    private readonly directorySubtitleCache = new Map<string, string[]>();

    constructor(
        @inject(TYPES.WatchHistoryRepository) private readonly watchHistoryRepository: WatchHistoryRepository,
        @inject(TYPES.LearningDataRepository) private readonly learningDataRepository: LearningDataRepository,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
        @inject(TYPES.BuiltinDictionaryStore) private readonly dictionaryStore: BuiltinDictionaryStore,
        @inject(TYPES.MediaPathRegistry) private readonly mediaPathRegistry: MediaPathRegistry,
    ) {}

    public async list(params: ContentCompassListParams): Promise<ContentCompassVO> {
        const limit = Math.max(1, Math.min(6, Math.trunc(params.limit ?? 3)));
        const excluded = new Set(params.excludeVideoIds ?? []);
        const [fileRecords, directoryRecords, userWords, reviewCards] = await Promise.all([
            this.watchHistoryRepository.listByProjectType(WatchHistoryProjectType.FILE),
            this.watchHistoryRepository.listByProjectType(WatchHistoryProjectType.DIRECTORY),
            this.learningDataRepository.listUserWords(),
            this.learningDataRepository.listReviewCards(),
        ]);
        const records = this.dedupeRecords([...fileRecords, ...directoryRecords]);
        const candidates = await this.resolveCandidatesWithSubtitles(
            this.selectCandidates(records, excluded),
        );
        if (candidates.length === 0) {
            return { generatedAt: new Date().toISOString(), items: [] };
        }

        const userWordMap = new Map(userWords.map((word) => [word.word.toLowerCase(), word]));
        const activeWords = userWords.filter((word) =>
            word.status === 'learning' || word.status === 'familiar',
        );
        const activeLemmas = new Set(activeWords.map((word) => word.word.toLowerCase()));
        const now = Date.now();
        const dueLemmas = new Set(
            reviewCards
                .filter((card) => Date.parse(card.due_at) <= now)
                .map((card) => card.word.toLowerCase())
                .filter((lemma) => activeLemmas.has(lemma)),
        );

        const candidateDetails: Array<{
            candidate: CandidateRecord;
            analysis: SubtitleAnalysis;
        }> = [];
        for (const candidate of candidates) {
            try {
                const analysis = await this.analyzeSubtitle(candidate.subtitlePath);
                if (analysis) {
                    candidateDetails.push({ candidate, analysis });
                }
            } catch (error) {
                this.logger.warn('content compass candidate skipped', {
                    video: candidate.record.file_name,
                    error: this.errorMessage(error),
                });
            }
        }
        if (candidateDetails.length === 0) {
            return { generatedAt: new Date().toISOString(), items: [] };
        }

        const recentVectors = await this.loadRecentTopicVectors(records);
        const rankInputs: ContentCompassRankCandidate[] = candidateDetails.map(({ candidate, analysis }) => {
            const dueWords = this.collectOverlapWords(analysis.contentLemmas, dueLemmas, userWordMap);
            const dueSet = new Set(dueLemmas);
            const learningWords = activeWords
                .map((word) => word.word.toLowerCase())
                .filter((lemma) => !dueSet.has(lemma) && analysis.contentLemmas.has(lemma));
            const otherVectors = recentVectors
                .filter((entry) => entry.videoPath !== candidate.videoPath)
                .map((entry) => entry.vector);
            const interestScore = otherVectors.length === 0
                ? 0
                : otherVectors.reduce(
                    (sum, vector) => sum + lexicalSimilarity(analysis.normalizedFrequency, vector),
                    0,
                ) / otherVectors.length;
            return {
                id: candidate.record.id,
                directoryKey: candidate.record.base_path,
                comprehensionScore: this.estimateVideoComprehension(analysis, userWordMap),
                interestScore,
                dueWords,
                learningWords,
            };
        });
        const ranked = rankContentCompassCandidates(rankInputs, limit);
        const detailMap = new Map(candidateDetails.map(({ candidate, analysis }) => [
            candidate.record.id,
            { candidate, analysis },
        ]));
        const items: ContentCompassItemVO[] = [];
        for (const rankedItem of ranked) {
            const detail = detailMap.get(rankedItem.id);
            if (!detail) {
                continue;
            }
            this.mediaPathRegistry.allowFile(detail.candidate.videoPath);
            items.push({
                videoId: detail.candidate.record.id,
                fileName: detail.candidate.record.file_name,
                basePath: detail.candidate.record.base_path,
                srtFile: detail.candidate.subtitlePath,
                currentPosition: detail.candidate.record.current_position,
                score: rankedItem.score,
                comprehension: Number(rankedItem.comprehensionScore.toFixed(3)),
                comprehensionBand: resolveComprehensionBand(rankedItem.comprehensionScore),
                interest: Number(rankedItem.interestScore.toFixed(3)),
                reason: {
                    code: rankedItem.reason,
                    words: (rankedItem.reason === 'due_review'
                        ? rankedItem.dueWords
                        : rankedItem.learningWords
                    ).slice(0, MAX_REASON_WORDS),
                    dueCount: rankedItem.dueWords.length,
                    learningCount: rankedItem.learningWords.length,
                },
            });
        }
        return { generatedAt: new Date().toISOString(), items };
    }

    public async recordEvent(params: ContentCompassEventParams): Promise<void> {
        const videoId = params.videoId?.trim();
        if (!videoId) {
            throw new Error('推荐视频不能为空');
        }
        await this.learningDataRepository.insertRecommendationEvent({
            video_id: videoId,
            action: params.action,
            surface: params.surface ?? 'home',
            score: Math.max(0, Math.min(1, params.score ?? 0)),
            reason_code: params.reasonCode ?? null,
        });
    }

    public async getStats(params: ContentCompassStatsParams): Promise<ContentCompassStatsVO> {
        const days = Math.max(1, Math.min(90, Math.trunc(params.days ?? DEFAULT_STATS_DAYS)));
        const since = new Date(Date.now() - days * DAY_MS).toISOString();
        const [events, outcomes] = await Promise.all([
            this.learningDataRepository.listRecommendationEventsSince(since),
            this.learningDataRepository.listReviewOutcomesSince(since),
        ]);
        const shown = events.filter((event) => event.action === 'shown').length;
        const opened = events.filter((event) => event.action === 'opened').length;
        const dismissed = events.filter((event) => event.action === 'dismissed').length;
        const successfulReviews = outcomes.filter((outcome) =>
            outcome.rating === 'good' || outcome.rating === 'easy',
        ).length;
        return {
            since,
            shown,
            opened,
            dismissed,
            openRate: shown === 0 ? null : Math.min(1, opened / shown),
            dismissRate: shown === 0 ? null : Math.min(1, dismissed / shown),
            retention: {
                reviewed: outcomes.length,
                retention: outcomes.length === 0 ? null : successfulReviews / outcomes.length,
            },
        };
    }

    /**
     * 按媒体路径去重，并优先保留已经显式关联字幕的记录。
     */
    private dedupeRecords(records: WatchHistoryRecord[]): WatchHistoryRecord[] {
        const byPath = new Map<string, WatchHistoryRecord>();
        for (const record of records) {
            if (!MediaUtil.isMedia(record.file_name)) {
                continue;
            }
            const key = path.resolve(record.base_path, record.file_name);
            const existing = byPath.get(key);
            if (!existing || (!existing.srt_file && record.srt_file)) {
                byPath.set(key, record);
            }
        }
        return Array.from(byPath.values())
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    }

    /**
     * 目录轮转排序，避免最近导入的同一文件夹霸占全部候选。
     *
     * 这里不截断候选数量：只有解析出可用字幕的视频才算有效候选，提前截断会
     * 让前序无字幕视频挤掉后面的可推荐内容。
     */
    private selectCandidates(
        records: WatchHistoryRecord[],
        excluded: Set<string>,
    ): CandidateRecord[] {
        const groups = new Map<string, WatchHistoryRecord[]>();
        for (const record of records) {
            if (excluded.has(record.id)) {
                continue;
            }
            const group = groups.get(record.base_path) ?? [];
            group.push(record);
            groups.set(record.base_path, group);
        }
        const orderedGroups = Array.from(groups.values());
        const picked: WatchHistoryRecord[] = [];
        for (const group of orderedGroups) {
            if (group[0]) {
                picked.push(group[0]);
            }
        }
        const pickedIds = new Set(picked.map((record) => record.id));
        for (const record of records) {
            if (!excluded.has(record.id) && !pickedIds.has(record.id)) {
                picked.push(record);
                pickedIds.add(record.id);
            }
        }
        return picked.map((record) => ({
            record,
            videoPath: path.join(record.base_path, record.file_name),
            subtitlePath: '',
        }));
    }

    /**
     * 为候选解析字幕；没有字幕的媒体不能参与难度与词复现估算。
     */
    private async resolveCandidatesWithSubtitles(
        candidates: CandidateRecord[],
        limit = MAX_CANDIDATES,
    ): Promise<CandidateRecord[]> {
        const resolved: CandidateRecord[] = [];
        for (const candidate of candidates) {
            if (resolved.length >= limit) {
                break;
            }
            try {
                if (!await this.fileSystemGateway.fileExists(candidate.videoPath)) {
                    continue;
                }
                const subtitlePath = await this.resolveSubtitlePath(candidate.record, candidate.videoPath);
                if (subtitlePath) {
                    resolved.push({ ...candidate, subtitlePath });
                }
            } catch (error) {
                this.logger.warn('content compass subtitle resolve failed', {
                    video: candidate.record.file_name,
                    error: this.errorMessage(error),
                });
            }
        }
        return resolved;
    }

    private async resolveSubtitlePath(
        record: WatchHistoryRecord,
        videoPath: string,
    ): Promise<string> {
        if (record.srt_file && MediaUtil.isSubtitle(record.srt_file)) {
            try {
                if (await this.fileSystemGateway.fileExists(record.srt_file)) {
                    return record.srt_file;
                }
            } catch {
                // 已关联字幕失效时继续扫描同目录。
            }
        }
        const subtitlePaths = await this.listSubtitlePaths(record.base_path);
        const matched = MatchSrt.matchOneDetail(videoPath, subtitlePaths);
        return matched && !matched.suspicious ? matched.path : '';
    }

    private async listSubtitlePaths(directory: string): Promise<string[]> {
        const cached = this.directorySubtitleCache.get(directory);
        if (cached) {
            return cached;
        }
        try {
            const fileNames = await this.fileSystemGateway.listFileNames(directory);
            const subtitlePaths = fileNames
                .filter((fileName) => MediaUtil.isSubtitle(fileName))
                .map((fileName) => path.join(directory, fileName));
            this.directorySubtitleCache.set(directory, subtitlePaths);
            return subtitlePaths;
        } catch (error) {
            this.logger.warn('content compass subtitle directory scan failed', {
                directory,
                error: this.errorMessage(error),
            });
            this.directorySubtitleCache.set(directory, []);
            return [];
        }
    }

    private async analyzeSubtitle(subtitlePath: string): Promise<SubtitleAnalysis | null> {
        const fileSize = await this.fileSystemGateway.getFileSize(subtitlePath);
        if (fileSize <= 0 || fileSize > MAX_SUBTITLE_BYTES) {
            return null;
        }
        const content = await this.fileSystemGateway.readTextFile(subtitlePath);
        const cacheKey = ObjUtil.hash({
            content,
            extension: path.extname(subtitlePath).toLowerCase(),
        });
        const cached = this.analysisCache.get(cacheKey);
        if (cached) {
            // 刷新 LRU 顺序。
            this.analysisCache.delete(cacheKey);
            this.analysisCache.set(cacheKey, cached);
            return cached;
        }
        const lines = MediaUtil.isAss(subtitlePath) ? parseAss(content) : parseSrt(content);
        const sampled = this.sampleLines(lines);
        if (sampled.length === 0) {
            return null;
        }

        const sentences: AnalyzedSentence[] = [];
        const contentLemmas = new Set<string>();
        const frequencies = new Map<string, number>();
        let totalContentTokens = 0;
        for (const line of sampled) {
            const analyzed = this.analyzeSentence(line.contentEn);
            if (analyzed.words.length === 0) {
                continue;
            }
            sentences.push(analyzed);
            for (const token of analyzeWords(line.contentEn)) {
                if (token.type !== 'word') {
                    continue;
                }
                const lemma = token.lemma.toLowerCase();
                if (!isContentLemma(lemma)) {
                    continue;
                }
                contentLemmas.add(lemma);
                frequencies.set(lemma, (frequencies.get(lemma) ?? 0) + 1);
                totalContentTokens += 1;
            }
        }
        if (sentences.length === 0) {
            return null;
        }
        const normalizedFrequency = new Map<string, number>();
        for (const [lemma, count] of frequencies) {
            normalizedFrequency.set(lemma, count / Math.max(1, totalContentTokens));
        }
        const analysis: SubtitleAnalysis = {
            contentLemmas,
            normalizedFrequency,
            sentences,
        };
        this.analysisCache.set(cacheKey, analysis);
        while (this.analysisCache.size > MAX_ANALYSIS_CACHE_ENTRIES) {
            const oldest = this.analysisCache.keys().next();
            if (oldest.done) {
                break;
            }
            this.analysisCache.delete(oldest.value);
        }
        return analysis;
    }

    /**
     * 均匀抽样，防止超长视频让首页推荐等待整条字幕分析。
     */
    private sampleLines(lines: SrtLine[]): SrtLine[] {
        const usable = lines.filter((line) => line.contentEn.trim().length > 0);
        if (usable.length <= MAX_SAMPLE_LINES) {
            return usable;
        }
        const step = usable.length / MAX_SAMPLE_LINES;
        return Array.from({ length: MAX_SAMPLE_LINES }, (_, index) =>
            usable[Math.min(usable.length - 1, Math.floor(index * step))],
        );
    }

    private analyzeSentence(text: string): AnalyzedSentence {
        const words: AnalyzedSentence['words'] = [];
        let wordCount = 0;
        let longWordCount = 0;
        const tokens = analyzeWords(text);
        tokens.forEach((token, index) => {
            if (token.type !== 'word') {
                return;
            }
            wordCount += 1;
            const lemma = token.lemma.toLowerCase();
            if (!isContentLemma(lemma)) {
                return;
            }
            // 句首之外的大写词按专名处理，降低人名和作品名对难度的干扰。
            if (index > 0 && /^[A-Z]/.test(token.text)) {
                return;
            }
            if (lemma.length >= 9) {
                longWordCount += 1;
            }
            words.push({
                lemma,
                difficulty: this.resolveDictionary(lemma, token.text.toLowerCase()),
            });
        });
        return {
            words,
            wordCount,
            clauseCount: (text.match(CLAUSE_PATTERN) ?? []).length,
            longWordCount,
        };
    }

    private resolveDictionary(lemma: string, surface: string): ComprehensionDifficulty {
        const cached = this.dictionaryCache.get(lemma);
        if (cached) {
            return cached;
        }
        try {
            const entry = this.dictionaryStore.lookup(lemma) ?? this.dictionaryStore.lookup(surface);
            const difficulty = resolveDictionaryDifficulty(entry);
            this.dictionaryCache.set(lemma, difficulty);
            return difficulty;
        } catch (error) {
            this.logger.warn('content compass dictionary lookup failed', {
                lemma,
                error: this.errorMessage(error),
            });
            this.dictionaryCache.set(lemma, 'unknown');
            return 'unknown';
        }
    }

    private estimateVideoComprehension(
        analysis: SubtitleAnalysis,
        userWordMap: Map<string, Word>,
    ): number {
        const scores = analysis.sentences.map((sentence) => {
            const wordInputs: ComprehensionWordInput[] = sentence.words.map((word) => {
                const userWord = userWordMap.get(word.lemma);
                return {
                    lemma: word.lemma,
                    difficulty: word.difficulty,
                    userStatus: userWord?.status,
                    mastery: userWord?.mastery,
                };
            });
            return estimateComprehension({
                words: wordInputs,
                wordCount: sentence.wordCount,
                clauseCount: sentence.clauseCount,
                longWordCount: sentence.longWordCount,
            }).score;
        });
        if (scores.length === 0) {
            return 0;
        }
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    }

    private collectOverlapWords(
        contentLemmas: Set<string>,
        expectedLemmas: Set<string>,
        userWordMap: Map<string, Word>,
    ): string[] {
        const words: string[] = [];
        for (const lemma of expectedLemmas) {
            if (!contentLemmas.has(lemma)) {
                continue;
            }
            const word = userWordMap.get(lemma);
            if (word) {
                words.push(word.word);
            }
        }
        return words;
    }

    private async loadRecentTopicVectors(
        records: WatchHistoryRecord[],
    ): Promise<Array<{ videoPath: string; vector: Map<string, number> }>> {
        const watched = records
            .filter((record) => record.current_position > 0)
            .slice(0, MAX_RECENT_PROFILE_VIDEOS);
        const recent = watched.length >= 3 ? watched : records.slice(0, MAX_RECENT_PROFILE_VIDEOS);
        const vectors: Array<{ videoPath: string; vector: Map<string, number> }> = [];
        for (const record of recent) {
            const videoPath = path.join(record.base_path, record.file_name);
            try {
                const subtitlePath = await this.resolveSubtitlePath(record, videoPath);
                if (!subtitlePath) {
                    continue;
                }
                const analysis = await this.analyzeSubtitle(subtitlePath);
                if (analysis) {
                    vectors.push({ videoPath, vector: analysis.normalizedFrequency });
                }
            } catch (error) {
                this.logger.warn('content compass interest profile skipped', {
                    video: record.file_name,
                    error: this.errorMessage(error),
                });
            }
        }
        return vectors;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
