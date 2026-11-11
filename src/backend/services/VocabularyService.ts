import { Workbook } from 'exceljs';
import { generateText, Output } from 'ai';
import { inject, injectable } from 'inversify';
import { z } from 'zod';
import TYPES from '@/backend/ioc/types';
import type { VideoLearningService } from '@/backend/services/VideoLearningService';
import type { WordMatchService } from '@/backend/services/WordMatchService';
import type AiProviderService from '@/backend/services/AiProviderService';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import type VideoLearningClipWordRepository from '@/backend/services/repositories/VideoLearningClipWordRepository';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { loadDefaultVocabulary } from '@/backend/utils/defaultVocabulary';
import type SubtitleService from '@/backend/services/SubtitleService';
import { lemmatizeWord } from '@/backend/utils/language/VocabularyMatcher';
import { concurrency } from '@/backend/utils/concurrency';
import { assertVocabularyPath } from '@/backend/utils/file-path-guard';
import {
    addDefaultVocabularyRestoreNote,
    createVocabularyWorksheet,
    readSpreadsheetRows,
    parseImportedWords,
} from '@/backend/services/VocabularySpreadsheet';
import { isActiveWordStatus, type WordSource, type WordStatus } from '@/common/types/vocabulary';
import { createNewReviewSchedule } from '@/common/learning/reviewScheduler';

export interface GetAllWordsParams {
    search?: string;
}

export interface GetAllWordsResult {
    success: boolean;
    data?: unknown[];
    error?: string;
}

export interface ExportTemplateResult {
    success: boolean;
    data?: string;
    error?: string;
}

export interface ImportWordsResult {
    success: boolean;
    message?: string;
    error?: string;
}

/**
 * 收藏单词的返回数据。
 */
export interface FavoriteWordData {
    /** 入库的单词（原始形态，小写）。 */
    word: string;
    /** 单词释义。 */
    translate: string;
    /** 单词此前是否已存在。 */
    alreadyExists: boolean;
}

export interface FavoriteWordResult {
    success: boolean;
    data?: FavoriteWordData;
    error?: string;
}

/**
 * 编辑单词参数；单词本身是业务键，需用旧单词定位记录。
 */
export interface UpdateWordParams {
    /** 编辑前的单词。 */
    oldWord: string;
    /** 编辑后的单词。 */
    word: string;
    /** 编辑后的释义。 */
    translate: string;
}

export interface SimpleActionResult {
    success: boolean;
    error?: string;
}

/**
 * 更新单词学习状态的参数。
 */
export interface UpdateWordStateParams {
    /** 单词原文；后端会先还原为 lemma。 */
    word: string;
    /** 目标学习状态。 */
    status: WordStatus;
}

/**
 * 更新单词学习状态的结果。
 */
export interface UpdateWordStateResult {
    success: boolean;
    data?: {
        word: string;
        status: WordStatus;
    };
    error?: string;
}

/** 删除单词结果；成功时携带实际删除的入库单词（已还原为原始形态）。 */
export interface DeleteWordResult {
    success: boolean;
    data?: { word: string };
    error?: string;
}

export interface GenerateDefinitionResult {
    success: boolean;
    data?: string;
    error?: string;
}

export default interface VocabularyService {
    getAllWords(params: GetAllWordsParams): Promise<GetAllWordsResult>;
    exportTemplate(): Promise<ExportTemplateResult>;
    importWords(filePath: string): Promise<ImportWordsResult>;
    /**
     * 收藏单词：还原为原始形态后入库。
     *
     * 行为说明：
     * - 输入的变体（复数、时态等）先还原为原始形态（lemma）再查重入库；
     * - 释义优先使用调用方随交互携带的词典结果（如播放器弹窗已查到的释义），
     *   未携带或为空时才调用词典 AI 生成；
     * - 已存在的单词直接返回现有记录（幂等）。
     *
     * @param word 用户点击的单词原文（可能是复数、时态等变体）。
     * @param translate 调用方已有的释义文本；为空时由 AI 生成。
     */
    favoriteWord(word: string, translate?: string): Promise<FavoriteWordResult>;
    /**
     * 更新单词学习状态。
     *
     * 行为说明：
     * - 输入变体先还原为 lemma；
     * - 已存在时只改状态，不丢释义；
     * - 不存在时创建一条状态记录，供「认识 / 忽略」抑制后续提示。
     */
    updateWordState(params: UpdateWordStateParams): Promise<UpdateWordStateResult>;
    /**
     * 编辑单词与释义；单词变化时同步迁移片段关联。
     */
    updateWord(params: UpdateWordParams): Promise<SimpleActionResult>;
    /**
     * 删除单词，并清理其片段关联。
     *
     * 行为说明：
     * - 输入的变体（复数、时态等）先还原为原始形态（lemma）再删除，与收藏入口对称；
     * - 成功时返回实际删除的入库单词，供前端同步生词高亮词表。
     */
    deleteWord(word: string): Promise<DeleteWordResult>;
    /**
     * 调用 AI 为单词生成简明中文释义。
     */
    generateDefinition(word: string): Promise<GenerateDefinitionResult>;
}

/**
 * 单词导入导出服务实现。
 */
@injectable()
export class VocabularyServiceImpl implements VocabularyService {
    private readonly logger = getMainLogger('VocabularyServiceImpl');

    /**
     * 构造生词本业务服务。
     *
     * @param videoLearningService 视频学习片段服务。
     * @param wordsRepository 单词表仓储。
     * @param reviewCardRepository 复习卡仓储。
     * @param wordMatchService 词表匹配服务。
     * @param aiProviderService 云端模型提供服务。
     * @param clipWordRepository 学习片段关联词仓储。
     * @param subtitleService 字幕业务服务。
     * @param storageDirectoryProvider 外部存储目录提供器。
     * @param fileSystemGateway 文件系统访问端口。
     */
    constructor(
        @inject(TYPES.VideoLearningService) private readonly videoLearningService: VideoLearningService,
        @inject(TYPES.WordsRepository) private readonly wordsRepository: WordsRepository,
        @inject(TYPES.ReviewCardRepository) private readonly reviewCardRepository: ReviewCardRepository,
        @inject(TYPES.WordMatchService) private readonly wordMatchService: WordMatchService,
        @inject(TYPES.AiProviderService) private readonly aiProviderService: AiProviderService,
        @inject(TYPES.VideoLearningClipWordRepository) private readonly clipWordRepository: VideoLearningClipWordRepository,
        @inject(TYPES.SubtitleService) private readonly subtitleService: SubtitleService,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    async getAllWords(params: GetAllWordsParams = {}): Promise<GetAllWordsResult> {
        try {
            const wordsResult = await this.wordsRepository.getAll({ search: params.search });

            return {
                success: true,
                data: wordsResult.map(word => ({
                    id: word.id,
                    word: word.word,
                    translate: word.translate || '',
                    status: word.status,
                    source: word.source,
                    mastery: word.mastery,
                    confidence: word.confidence,
                    created_at: word.created_at,
                    updated_at: word.updated_at
                }))
            };
        } catch (error) {
            this.logger.error('获取单词失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取单词失败'
            };
        }
    }

    /**
     * 导出单词管理模板。
     *
     * 行为说明：
     * - 第一个工作表导出当前用户词表，作为后续导入的唯一数据源。
     * - 第二个工作表导出内置默认词表，便于用户恢复模板内容。
     *
     * @returns Base64 编码的 Excel 文件内容。
     */
    async exportTemplate(): Promise<ExportTemplateResult> {
        try {
            const wordsResult = await this.getAllWords();
            if (!wordsResult.success || !wordsResult.data) {
                return {
                    success: false,
                    error: wordsResult.error || '获取单词数据失败'
                };
            }

            const defaultWords = await loadDefaultVocabulary();
            const currentVocabularyRows = (wordsResult.data as Array<{ word: string; translate: string | null }>).map(word => ({
                英文: word.word,
                释义: word.translate || ''
            }));
            const defaultVocabularyRows = defaultWords.map(word => ({
                英文: word.word,
                释义: word.translate || ''
            }));

            const wb = new Workbook();
            createVocabularyWorksheet(wb, '单词管理', currentVocabularyRows);
            const defaultWorksheet = createVocabularyWorksheet(wb, '默认词表', defaultVocabularyRows);
            addDefaultVocabularyRestoreNote(defaultWorksheet);

            const excelBuffer = await wb.xlsx.writeBuffer();

            return {
                success: true,
                data: Buffer.from(excelBuffer).toString('base64')
            };
        } catch (error) {
            this.logger.error('导出模板失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '导出模板失败'
            };
        }
    }

    /**
     * 导入单词表格。
     *
     * 行为说明：
     * - 支持 .xlsx 与 .csv 两种格式；旧版 .xls 不再支持，会明确提示另存为 .xlsx。
     * - 仅以第一个工作表为准，第二个默认词表页仅供参考。
     * - 读盘之前先按扩展名与体积把关，避免这条路由被当成任意文件读取器。
     * - 导入结果会全量覆盖当前单词表。
     * - 导入完成后会同步重建单词管理片段索引。
     *
     * @param filePath 词汇表文件路径（.xlsx 或 .csv）。
     * @returns 导入结果。
     */
    async importWords(filePath: string): Promise<ImportWordsResult> {
        try {
            // 先按扩展名钉死文件类型：这条路由不允许被当成任意文件读取器。
            assertVocabularyPath(filePath);
            const sizeBytes = await this.fileSystemGateway.getFileSize(filePath);
            // 体积上限同样在读盘之前生效，避免把超大文件整个读进内存。
            assertVocabularyPath(filePath, sizeBytes);

            const fileBuffer = await this.fileSystemGateway.readBinaryFile(filePath);
            const rows = await readSpreadsheetRows(filePath, fileBuffer);
            if (rows.length === 0) {
                return {
                    success: false,
                    error: '导入失败：文件内容为空'
                };
            }

            const existingWords = await this.wordsRepository.getAll();
            const importedWords = parseImportedWords(rows);
            const existingWordSet = new Set(existingWords.map((item) => item.word));
            const importedWordSet = new Set(importedWords.map((item) => item.word));
            const retainedCount = importedWords.filter((item) => existingWordSet.has(item.word)).length;
            const addedCount = importedWords.length - retainedCount;
            const removedCount = existingWords.filter((item) => !importedWordSet.has(item.word)).length;

            await this.wordsRepository.replaceAll(importedWords);
            // 导入词统一是 learning 状态，同样参与字幕标注与推荐，必须同步进入复习队列；
            // 同时清掉已不在词表里的孤儿卡，避免同名再次导入时复活旧调度。
            const activeWords = importedWords.map((item) => item.word);
            await this.reviewCardRepository.ensureForWords(activeWords, new Date().toISOString());
            await this.reviewCardRepository.deleteOrphans();
            this.wordMatchService.invalidateVocabularyCache();
            this.subtitleService.invalidateVocabularyAnalysisCache();

            try {
                await this.videoLearningService.syncFromOss();
                this.videoLearningService.invalidateClipAnalysisCache();
            } catch (syncError) {
                this.logger.error('同步单词管理片段失败', { error: syncError });
                return {
                    success: false,
                    error: syncError instanceof Error
                        ? `单词导入完成，但同步单词管理片段失败：${syncError.message}`
                        : '单词导入完成，但同步单词管理片段失败'
                };
            }

            return {
                success: true,
                message: `导入完成：共 ${importedWords.length} 条，保留 ${retainedCount} 条，新增 ${addedCount} 条，删除 ${removedCount} 条，已同步单词管理片段`
            };
        } catch (error) {
            this.logger.error('导入单词失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '导入单词失败'
            };
        }
    }

    /**
     * 收藏单词。
     *
     * 行为说明：
     * - 输入的变体（复数、时态等）先还原为原始形态（lemma）再查重入库；
     * - 释义优先使用调用方携带的词典结果，未携带时才调用词典 AI 生成；
     * - 已存在的单词直接返回现有记录（幂等）；
     * - 并发收藏同一词的不同变体时，后落库的一方转为已存在返回，不再报错。
     *
     * @param word 用户点击的单词原文。
     * @param translate 调用方已有的释义文本；为空时由 AI 生成。
     * @returns 收藏结果；成功时携带入库单词与释义。
     */
    async favoriteWord(word: string, translate?: string): Promise<FavoriteWordResult> {
        try {
            const input = word?.trim() ?? '';
            if (!input) {
                return {
                    success: false,
                    error: '单词不能为空'
                };
            }

            const lemma = lemmatizeWord(input);
            const existing = await this.wordsRepository.findByWord(lemma);
            if (existing) {
                const carriedTranslate = translate?.trim() ?? '';
                const nextTranslate = existing.translate?.trim()
                    || carriedTranslate
                    || await this.generateDefinitionText(lemma);
                if (nextTranslate && nextTranslate !== existing.translate) {
                    await this.wordsRepository.updateByWord(lemma, { word: lemma, translate: nextTranslate });
                }
                if (!isActiveWordStatus(existing.status) || existing.source === 'default') {
                    const nextSource: WordSource = existing.source === 'default' ? 'manual' : existing.source;
                    await this.wordsRepository.updateState(lemma, {
                        status: 'learning',
                        source: nextSource,
                    });
                    this.invalidateVocabularyCaches();
                }
                return {
                    success: true,
                    data: {
                        word: existing.word,
                        translate: nextTranslate,
                        alreadyExists: true
                    }
                };
            }

            const carriedTranslate = translate?.trim() ?? '';
            const finalTranslate = carriedTranslate || await this.generateDefinitionText(lemma);
            try {
                await this.wordsRepository.insertOne({
                    word: lemma,
                    translate: finalTranslate,
                    status: 'learning',
                    source: 'manual',
                });
            } catch (insertError) {
                // 并发收藏同一词的不同变体时会撞唯一约束；重新查到记录即转为已存在返回。
                const raced = await this.wordsRepository.findByWord(lemma);
                if (raced) {
                    return {
                        success: true,
                        data: {
                            word: raced.word,
                            translate: raced.translate || '',
                            alreadyExists: true
                        }
                    };
                }
                throw insertError;
            }
            this.invalidateVocabularyCaches();

            return {
                success: true,
                data: {
                    word: lemma,
                    translate: finalTranslate,
                    alreadyExists: false
                }
            };
        } catch (error) {
            this.logger.error('收藏单词失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '收藏单词失败'
            };
        }
    }

    /**
     * 更新单词学习状态。
     *
     * @param params 单词原文与目标状态。
     * @returns 操作结果；成功时携带实际入库 lemma 与状态。
     */
    async updateWordState(params: UpdateWordStateParams): Promise<UpdateWordStateResult> {
        try {
            const input = params.word?.trim() ?? '';
            if (!input) {
                return { success: false, error: '单词不能为空' };
            }

            const lemma = lemmatizeWord(input);
            const existing = await this.wordsRepository.findByWord(lemma);
            if (existing) {
                const source: WordSource = existing.source === 'default' ? 'manual' : existing.source;
                await this.wordsRepository.updateState(lemma, {
                    status: params.status,
                    source,
                });
            } else {
                await this.wordsRepository.insertOne({
                    word: lemma,
                    translate: null,
                    status: params.status,
                    source: 'manual',
                });
            }
            if (params.status === 'known' || params.status === 'ignored') {
                await this.reviewCardRepository.deleteByWord(lemma);
            } else {
                // 手动设回学习中/熟悉时 mastery 已被清零，卡片必须重新到期，
                // 否则会出现「掌握度 0、却要 30 天后才复习」的矛盾。
                const schedule = createNewReviewSchedule();
                await this.reviewCardRepository.upsert({
                    word: lemma,
                    due_at: schedule.dueAt,
                    state: schedule.state,
                    reps: schedule.reps,
                    lapses: schedule.lapses,
                    stability: schedule.stability,
                    difficulty: schedule.difficulty,
                    last_review_at: schedule.lastReviewAt,
                    last_rating: schedule.lastRating,
                });
            }
            this.invalidateVocabularyCaches();

            return {
                success: true,
                data: { word: lemma, status: params.status },
            };
        } catch (error) {
            this.logger.error('更新单词状态失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '更新单词状态失败',
            };
        }
    }

    /**
     * 编辑单词与释义。
     *
     * 行为说明：
     * - 单词是业务键，用旧单词定位记录后整体替换；
     * - 新单词统一小写，与其他单词冲突时明确报错；
     * - 单词变化时同步迁移学习片段关联。
     *
     * @param params 旧单词、新单词与新释义。
     * @returns 操作结果。
     */
    async updateWord(params: UpdateWordParams): Promise<SimpleActionResult> {
        try {
            const oldWord = params.oldWord?.trim().toLowerCase() ?? '';
            const newWord = params.word?.trim().toLowerCase() ?? '';
            if (!oldWord || !newWord) {
                return {
                    success: false,
                    error: '单词不能为空'
                };
            }

            const target = await this.wordsRepository.findByWord(oldWord);
            if (!target) {
                return {
                    success: false,
                    error: '未找到要编辑的单词'
                };
            }

            if (newWord !== oldWord) {
                const conflict = await this.wordsRepository.findByWord(newWord);
                if (conflict) {
                    return {
                        success: false,
                        error: '目标单词已存在'
                    };
                }
            }

            const translate = params.translate?.trim() ?? '';
            await this.wordsRepository.updateByWord(oldWord, { word: newWord, translate });
            if (newWord !== oldWord) {
                await this.clipWordRepository.renameWord(oldWord, newWord);
            }
            this.invalidateVocabularyCaches();

            return { success: true };
        } catch (error) {
            this.logger.error('更新单词失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '更新单词失败'
            };
        }
    }

    /**
     * 删除单词，并清理其学习片段关联。
     *
     * 行为说明：
     * - 输入的变体（复数、时态等）先还原为原始形态（lemma）再删除，与收藏入口对称；
     * - 表中不存在该词时仍返回成功（幂等删除），并携带还原后的单词。
     *
     * @param word 用户操作的单词原文（可能是复数、时态等变体）。
     * @returns 操作结果；成功时携带实际删除的入库单词。
     */
    async deleteWord(word: string): Promise<DeleteWordResult> {
        try {
            const input = word?.trim() ?? '';
            if (!input) {
                return {
                    success: false,
                    error: '单词不能为空'
                };
            }

            const lemma = lemmatizeWord(input);
            await this.wordsRepository.deleteByWord(lemma);
            await this.reviewCardRepository.deleteByWord(lemma);
            await this.clipWordRepository.deleteByWord(lemma);
            this.invalidateVocabularyCaches();

            return { success: true, data: { word: lemma } };
        } catch (error) {
            this.logger.error('删除单词失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '删除单词失败'
            };
        }
    }

    /**
     * 调用 AI 为单词生成简明中文释义。
     *
     * @param word 单词。
     * @returns 生成结果；成功时携带释义文本。
     */
    async generateDefinition(word: string): Promise<GenerateDefinitionResult> {
        try {
            const input = word?.trim() ?? '';
            if (!input) {
                return {
                    success: false,
                    error: '单词不能为空'
                };
            }

            const translate = await this.generateDefinitionText(input);
            return {
                success: true,
                data: translate
            };
        } catch (error) {
            this.logger.error('生成释义失败', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : '生成释义失败'
            };
        }
    }

    /**
     * 调用 AI 生成单词释义文本；失败时抛错，由调用方决定如何呈现。
     *
     * @param word 单词。
     * @returns 生成的释义。
     * @throws 模型未配置、请求失败或返回内容无效时抛出。
     */
    private async generateDefinitionText(word: string): Promise<string> {
        const model = this.aiProviderService.getModel('dictionary');
        if (!model) {
            throw new Error('词典 AI 模型未配置，请先在设置中配置词典模型');
        }

        const schema = z.object({
            translate: z.string().describe('单词的简明中文释义'),
        });

        const result = await concurrency.withRateLimit('gpt', () =>
            generateText({
                model,
                output: Output.object({ schema }),
                prompt: this.buildDefinitionPrompt(word),
                maxRetries: 0,
                timeout: DEFINITION_REQUEST_TIMEOUT_MS,
            }));

        const translate = result.output?.translate?.trim();
        if (!translate) {
            throw new Error('AI 未返回有效释义');
        }
        return translate;
    }

    /**
     * 构建单词本释义生成提示词。
     *
     * @param word 查询单词。
     * @returns 提示词文本。
     */
    private buildDefinitionPrompt(word: string): string {
        return [
            '你是一位专业的英汉词典助手。',
            `请为英文单词 "${word}" 写一条适合记入单词本的简明中文释义。`,
            '',
            '要求：',
            '1. 覆盖该词最常用的 1-3 个含义；',
            '2. 每个义项以词性缩写开头（如 n.、v.、adj. 等），义项之间用中文分号分隔；',
            '3. 总长度不超过 60 个字，语言精炼，不要例句，不要额外解释；',
            // 提示词必须出现 "JSON" 字样：json_object 模式下部分兼容端点（如 uniapi 的
            // deepseek-v4-flash）会校验这一点，缺失时直接 400，收藏单词整体失败。
            '4. 以 JSON 格式输出，结果放入 translate 字段。'
        ].join('\n');
    }

    /**
     * 词表发生变化后失效相关缓存，保证生词高亮与分析结果及时更新。
     */
    private invalidateVocabularyCaches(): void {
        this.wordMatchService.invalidateVocabularyCache();
        this.subtitleService.invalidateVocabularyAnalysisCache();
        this.videoLearningService.invalidateClipAnalysisCache();
    }
}

/** 释义生成请求超时时间（毫秒）。 */
const DEFINITION_REQUEST_TIMEOUT_MS = 30_000;
