import path from 'path';
import { inject, injectable } from 'inversify';

import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import { resolveDictionaryDifficulty } from '@/backend/services/dictionaryDifficulty';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type MediaPathRegistry from '@/backend/services/MediaPathRegistry';
import type TopicEmbeddingService from '@/backend/services/TopicEmbeddingService';
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
    aggregateInterestScore,
    rankContentCompassCandidates,
    type ContentCompassRankCandidate,
} from '@/common/learning/contentCompass';
import { isContentLemma } from '@/common/learning/contentWords';
import { estimateComprehension, resolveComprehensionBand } from '@/common/learning/comprehension';
import {
    searchTopicVectors,
    toTopicVectorEntry,
    type TopicVectorEntry,
} from '@/common/learning/topicIndex';
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
 * 一次推荐计算使用的共享词表空间。
 *
 * 候选与近期视频各自维护独立词频表，直接算余弦会因维度不同而失败；
 * 这里把所有字幕的 lemma 并成同一坐标轴，再统一投影。
 */
interface TopicVectorSpace {
    /** 把一份词频表投影为共享空间向量。 */
    project: (frequency: Map<string, number>) => number[];
}

/**
 * 本地内容指南针。
 *
 * 视频级理解度、用户词复现与最近观看主题共同形成可解释排序。主题相似度优先
 * 使用可选的本地 embedding 模型；模型未安装或推理失败时自动降级为字幕词面向量，
 * 因此推荐在任何环境下都能给出结果。
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
        @inject(TYPES.TopicEmbeddingService) private readonly topicEmbeddingService: TopicEmbeddingService,
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

        const recentProfiles = await this.loadRecentTopicProfiles(records);
        const semanticVectors = await this.loadSemanticVectors(candidateDetails, recentProfiles);
        const interestOf = semanticVectors
            ? this.semanticInterestProvider(semanticVectors)
            : this.lexicalInterestProvider(candidateDetails, recentProfiles);
        const rankInputs: ContentCompassRankCandidate[] = candidateDetails.map(({ candidate, analysis }) => {
            const dueWords = this.collectOverlapWords(analysis.contentLemmas, dueLemmas, userWordMap);
            const dueSet = new Set(dueLemmas);
            const learningWords = activeWords
                .map((word) => word.word.toLowerCase())
                .filter((lemma) => !dueSet.has(lemma) && analysis.contentLemmas.has(lemma));
            return {
                id: candidate.record.id,
                directoryKey: candidate.record.base_path,
                comprehensionScore: this.estimateVideoComprehension(analysis, userWordMap),
                interestScore: interestOf(candidate.videoPath, analysis),
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
        // 所有推荐指标按「视频 × 自然日」去重：曝光在前端本就按天去重，其余动作
        // 也按同一粒度聚合，打开/不感兴趣/进入复习才是曝光集合的子集，比率不会越界。
        const shownKeys = new Set<string>();
        const dueShownKeys = new Set<string>();
        const openedKeys = new Set<string>();
        const dismissedKeys = new Set<string>();
        const reviewedKeys = new Set<string>();
        for (const event of events) {
            const key = `${event.video_id}|${event.created_at.slice(0, 10)}`;
            if (event.action === 'shown') {
                shownKeys.add(key);
                if (event.reason_code === 'due_review') {
                    dueShownKeys.add(key);
                }
            } else if (event.action === 'opened') {
                openedKeys.add(key);
            } else if (event.action === 'dismissed') {
                dismissedKeys.add(key);
            } else if (event.action === 'reviewed') {
                reviewedKeys.add(key);
            }
        }
        const countWithin = (subset: Set<string>, superset: Set<string>): number => {
            let count = 0;
            for (const key of subset) {
                if (superset.has(key)) {
                    count += 1;
                }
            }
            return count;
        };
        const shown = shownKeys.size;
        const opened = countWithin(openedKeys, shownKeys);
        const dismissed = countWithin(dismissedKeys, shownKeys);
        const reviewed = countWithin(reviewedKeys, dueShownKeys);
        const successfulReviews = outcomes.filter((outcome) =>
            outcome.rating === 'good' || outcome.rating === 'easy',
        ).length;
        return {
            since,
            shown,
            opened,
            dismissed,
            reviewed,
            openRate: shown === 0 ? null : opened / shown,
            dismissRate: shown === 0 ? null : dismissed / shown,
            reviewRate: dueShownKeys.size === 0 ? null : reviewed / dueShownKeys.size,
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

    /**
     * 把多份词频表并成同一坐标轴。
     *
     * @param frequencies 候选与近期视频的词频表。
     * @returns 共享词表空间与投影函数。
     */
    private buildTopicVectorSpace(frequencies: Array<Map<string, number>>): TopicVectorSpace {
        const index = new Map<string, number>();
        for (const frequency of frequencies) {
            for (const lemma of frequency.keys()) {
                if (!index.has(lemma)) {
                    index.set(lemma, index.size);
                }
            }
        }
        return {
            project: (frequency) => {
                const vector = new Array<number>(index.size).fill(0);
                for (const [lemma, value] of frequency) {
                    const position = index.get(lemma);
                    if (position !== undefined) {
                        vector[position] = value;
                    }
                }
                return vector;
            },
        };
    }

    /**
     * 词面兴趣分：把候选与近期视频投影到共享词表空间后检索。
     *
     * @param candidateDetails 候选及其字幕分析。
     * @param recentProfiles 近期观看视频的词频表。
     * @returns 按视频路径计算兴趣分的函数。
     */
    private lexicalInterestProvider(
        candidateDetails: Array<{ candidate: CandidateRecord; analysis: SubtitleAnalysis }>,
        recentProfiles: Array<{ videoPath: string; frequency: Map<string, number> }>,
    ): (videoPath: string, analysis: SubtitleAnalysis) => number {
        const space = this.buildTopicVectorSpace([
            ...candidateDetails.map(({ analysis }) => analysis.normalizedFrequency),
            ...recentProfiles.map(({ frequency }) => frequency),
        ]);
        const recentEntries: TopicVectorEntry[] = recentProfiles.map((profile) =>
            toTopicVectorEntry(profile.videoPath, space.project(profile.frequency)));
        return (videoPath, analysis) => {
            const otherEntries = recentEntries.filter((entry) => entry.id !== videoPath);
            return aggregateInterestScore(
                searchTopicVectors(space.project(analysis.normalizedFrequency), otherEntries)
                    .map((match) => match.similarity),
            );
        };
    }

    /**
     * 语义兴趣分：使用本地 embedding 向量检索。
     *
     * @param vectors 视频路径 → 已生成的原始向量。
     * @returns 按视频路径计算兴趣分的函数。
     */
    private semanticInterestProvider(
        vectors: Map<string, number[]>,
    ): (videoPath: string, analysis: SubtitleAnalysis) => number {
        return (videoPath) => {
            const query = vectors.get(videoPath);
            if (!query) {
                return 0;
            }
            const others: TopicVectorEntry[] = [];
            for (const [id, vector] of vectors) {
                if (id !== videoPath) {
                    others.push(toTopicVectorEntry(id, vector));
                }
            }
            return aggregateInterestScore(
                searchTopicVectors(query, others).map((match) => match.similarity),
            );
        };
    }

    /**
     * 为候选与近期视频生成语义向量。
     *
     * 每条视频用抽样字幕拼成一段主题文本；任一环节失败都返回 `null`，
     * 由调用方整体降级为词面相似度，避免部分语义、部分词面混算。
     *
     * @param candidateDetails 候选及其字幕分析。
     * @param recentProfiles 近期观看视频的词频表。
     * @returns 视频路径 → 向量；模型不可用时为 `null`。
     */
    private async loadSemanticVectors(
        candidateDetails: Array<{ candidate: CandidateRecord; analysis: SubtitleAnalysis }>,
        recentProfiles: Array<{ videoPath: string; frequency: Map<string, number> }>,
    ): Promise<Map<string, number[]> | null> {
        const topics = new Map<string, string>();
        for (const { candidate, analysis } of candidateDetails) {
            topics.set(candidate.videoPath, this.topicTextOf(analysis));
        }
        for (const profile of recentProfiles) {
            if (!topics.has(profile.videoPath)) {
                topics.set(profile.videoPath, this.topicTextFromFrequency(profile.frequency));
            }
        }
        if (topics.size === 0) {
            return null;
        }
        try {
            const embedded = await this.topicEmbeddingService.embed(
                Array.from(topics, ([id, text]) => ({ id, text })),
            );
            if (!embedded) {
                return null;
            }
            return new Map(embedded.map((item) => [item.id, item.vector]));
        } catch (error) {
            this.logger.warn('content compass semantic index skipped', {
                error: this.errorMessage(error),
            });
            return null;
        }
    }

    /**
     * 用分析阶段保留的句子构造主题文本。
     */
    private topicTextOf(analysis: SubtitleAnalysis): string {
        return analysis.sentences
            .map((sentence) => sentence.words.map((word) => word.lemma).join(' '))
            .filter((text) => text.length > 0)
            .join('. ');
    }

    /**
     * 近期视频只保留了词频，没有原句；按词频降序拼接高频词作为主题文本。
     */
    private topicTextFromFrequency(frequency: Map<string, number>): string {
        return Array.from(frequency)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 64)
            .map(([lemma]) => lemma)
            .join(' ');
    }

    private async loadRecentTopicProfiles(
        records: WatchHistoryRecord[],
    ): Promise<Array<{ videoPath: string; frequency: Map<string, number> }>> {
        const watched = records
            .filter((record) => record.current_position > 0)
            .slice(0, MAX_RECENT_PROFILE_VIDEOS);
        const recent = watched.length >= 3 ? watched : records.slice(0, MAX_RECENT_PROFILE_VIDEOS);
        const profiles: Array<{ videoPath: string; frequency: Map<string, number> }> = [];
        for (const record of recent) {
            const videoPath = path.join(record.base_path, record.file_name);
            try {
                const subtitlePath = await this.resolveSubtitlePath(record, videoPath);
                if (!subtitlePath) {
                    continue;
                }
                const analysis = await this.analyzeSubtitle(subtitlePath);
                if (analysis) {
                    profiles.push({ videoPath, frequency: analysis.normalizedFrequency });
                }
            } catch (error) {
                this.logger.warn('content compass interest profile skipped', {
                    video: record.file_name,
                    error: this.errorMessage(error),
                });
            }
        }
        return profiles;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
