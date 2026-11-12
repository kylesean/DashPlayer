import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { concurrency } from '@/backend/utils/concurrency';
import type { MatchedWord, WordMatchService } from '@/backend/services/WordMatchService';

/**
 * 一行字幕的生词匹配结果。
 */
export type SubtitleVocabularyLineMatches = MatchedWord[];

/**
 * 整份字幕的共享生词分析结果。
 */
export type SubtitleVocabularyAnalysisResult = {
    /** 字幕内容哈希。 */
    fileHash: string;
    /** 生成这份结果时使用的词表版本。 */
    vocabularyRevision: number;
    /** 按原字幕行顺序保存的匹配结果。 */
    lineMatches: SubtitleVocabularyLineMatches[];
};

/**
 * 字幕生词分析的状态快照。
 */
export type SubtitleVocabularyAnalysisStatus = {
    /** 当前状态。 */
    status: 'idle' | 'analyzing' | 'completed';
    /** 已完成的分块进度，范围为 0 到 100。 */
    progress: number;
};

type AnalysisState = {
    /** 当前状态对应的词表版本。 */
    vocabularyRevision: number;
    /** 分块匹配结果，用于缓存和中断后续跑。 */
    chunks: Map<number, MatchedWord[][]>;
    /** 当前字幕总分块数。 */
    totalChunks: number;
    /** 完整分析结果。 */
    result?: SubtitleVocabularyAnalysisResult;
    /** 当前进度。 */
    progress: number;
};

type AnalysisSubscriber = {
    onProgress?: (progress: number) => Promise<void> | void;
    isCurrent?: () => boolean;
    active: boolean;
};

type ActiveAnalysis = {
    /** 当前运行的字幕哈希。 */
    fileHash: string;
    /** 当前运行序号。 */
    runId: number;
    /** 当前运行 Promise。 */
    promise: Promise<SubtitleVocabularyAnalysisResult>;
    /** 订阅同一次运行的所有调用方（各自保留进度回调与有效性检查，互不误杀）。 */
    subscribers: AnalysisSubscriber[];
};

/**
 * 共享字幕生词分析服务。
 *
 * 播放器和视频学习功能都通过这个单例完成逐行匹配，避免同一份字幕被重复扫描。
 * 结果按字幕哈希和词表版本复用，播放会话只负责让旧任务失效，不参与缓存寻址。
 */
export interface SubtitleVocabularyAnalysisService {
    /**
     * 获取或启动一份字幕的共享分析。
     *
     * @param fileHash 字幕内容哈希。
     * @param texts 按原字幕顺序排列的英文文本。
     * @param onProgress 分析进度通知。
     * @param isCurrent 可选的任务有效性检查；返回 false 时本轮会终止。
     * @returns 逐行生词匹配结果。
     */
    analyze(
        fileHash: string,
        texts: string[],
        onProgress?: (progress: number) => Promise<void> | void,
        isCurrent?: () => boolean,
    ): Promise<SubtitleVocabularyAnalysisResult>;

    /**
     * 获取指定字幕的分析状态。
     *
     * @param fileHash 字幕内容哈希。
     * @returns 当前分析状态。
     */
    getStatus(fileHash: string): SubtitleVocabularyAnalysisStatus;

    /**
     * 指定字幕是否有**真正在跑**的分析任务。
     *
     * 与 getStatus().status === 'analyzing' 的区别：被其它字幕取代的分析
     * （有分块但已非 active）getStatus 仍返回 analyzing，用它判定"在跑"
     * 会让轮询补跑逻辑永远不触发，状态永久卡死。
     */
    isActive(fileHash: string): boolean;

    /**
     * 使词表变化后的旧分析结果失效。
     */
    invalidate(): void;

    /**
     * 终止当前正在执行的分析，但保留已经完成的分块缓存。
     */
    cancelActive(): void;
}

/**
 * 共享字幕生词分析服务实现。
 */
@injectable()
export class SubtitleVocabularyAnalysisServiceImpl implements SubtitleVocabularyAnalysisService {
    private readonly states = new Map<string, AnalysisState>();
    private readonly scheduler = concurrency.scheduler('default');
    /** 当前全局唯一的字幕分析任务。 */
    private activeAnalysis?: ActiveAnalysis;
    /** 单调递增的运行序号。 */
    private nextRunId = 0;

    /**
     * 构造共享字幕生词分析服务。
     *
     * @param wordMatchService 词表匹配服务。
     */
    constructor(
        @inject(TYPES.WordMatchService) private readonly wordMatchService: WordMatchService,
    ) {}

    /**
     * 获取或启动一份字幕的共享分析。
     *
     * 已完成结果直接复用；同一字幕已有运行任务时复用同一个 Promise。
     * 请求另一份字幕会让当前运行失效，但已完成分块仍然保留。
     *
     * @param fileHash 字幕内容哈希。
     * @param texts 按原字幕顺序排列的英文文本。
     * @param onProgress 分析进度通知。
     * @param isCurrent 可选的任务有效性检查。
     * @returns 逐行生词匹配结果。
     */
    public async analyze(
        fileHash: string,
        texts: string[],
        onProgress?: (progress: number) => Promise<void> | void,
        isCurrent?: () => boolean,
    ): Promise<SubtitleVocabularyAnalysisResult> {
        const vocabularyRevision = this.wordMatchService.getVocabularyRevision();
        const existingState = this.states.get(fileHash);
        if (
            existingState
            && existingState.vocabularyRevision === vocabularyRevision
            && existingState.result
        ) {
            return existingState.result;
        }
        if (isCurrent && !isCurrent()) {
            throw new Error('SUBTITLE_VOCABULARY_ANALYSIS_CANCELLED');
        }
        if (
            this.activeAnalysis?.fileHash === fileHash
            && existingState?.vocabularyRevision === vocabularyRevision
        ) {
            const subscriber: AnalysisSubscriber = { onProgress, isCurrent, active: true };
            this.activeAnalysis.subscribers.push(subscriber);
            const result = await this.activeAnalysis.promise;
            if (subscriber.isCurrent && !subscriber.isCurrent()) {
                throw new Error('SUBTITLE_VOCABULARY_ANALYSIS_CANCELLED');
            }
            return result;
        }

        const chunkSize = 50;
        const totalChunks = Math.ceil(texts.length / chunkSize);
        const state: AnalysisState = (
            existingState
            && existingState.vocabularyRevision === vocabularyRevision
            && existingState.totalChunks === totalChunks
        )
            ? existingState
            : {
                vocabularyRevision,
                chunks: new Map<number, MatchedWord[][]>(),
                totalChunks,
                progress: 0,
            };
        state.result = undefined;
        state.progress = 0;
        this.states.set(fileHash, state);

        const previousAnalysis = this.activeAnalysis;
        if (previousAnalysis) {
            const previousState = this.states.get(previousAnalysis.fileHash);
            if (previousState) {
                previousState.progress = Math.min(previousState.progress, 99);
            }
        }

        const initialSubscriber: AnalysisSubscriber = { onProgress, isCurrent, active: true };
        const run: ActiveAnalysis = {
            fileHash,
            runId: ++this.nextRunId,
            promise: Promise.resolve({
                fileHash,
                vocabularyRevision,
                lineMatches: [],
            }),
            subscribers: [initialSubscriber],
        };
        this.activeAnalysis = run;
        run.promise = this.runAnalysis(fileHash, texts, state, run);
        const result = await run.promise;
        if (initialSubscriber.isCurrent && !initialSubscriber.isCurrent()) {
            throw new Error('SUBTITLE_VOCABULARY_ANALYSIS_CANCELLED');
        }
        return result;
    }

    /**
     * 获取指定字幕的当前分析状态。
     *
     * @param fileHash 字幕内容哈希。
     * @returns 当前分析状态。
     */
    public getStatus(fileHash: string): SubtitleVocabularyAnalysisStatus {
        const state = this.states.get(fileHash);
        if (!state) {
            return { status: 'idle', progress: 0 };
        }
        if (state.result) {
            return { status: 'completed', progress: 100 };
        }
        if (this.activeAnalysis?.fileHash === fileHash) {
            return { status: 'analyzing', progress: state.progress };
        }
        return {
            status: state.chunks.size > 0 ? 'analyzing' : 'idle',
            progress: state.totalChunks === 0
                ? 0
                : Math.min(99, Math.round((state.chunks.size / state.totalChunks) * 100)),
        };
    }

    public isActive(fileHash: string): boolean {
        return this.activeAnalysis?.fileHash === fileHash;
    }

    /**
     * 清除词表变化前的共享字幕分析结果。
     */
    public invalidate(): void {
        this.activeAnalysis = undefined;
        this.states.clear();
    }

    /**
     * 终止当前正在执行的分析。
     *
     * 已经完成的分块仍然保留，后续相同字幕再次分析时从未完成的分块继续。
     */
    public cancelActive(): void {
        this.activeAnalysis = undefined;
    }

    /**
     * 执行逐块字幕生词匹配。
     *
     * @param fileHash 字幕内容哈希。
     * @param texts 按原字幕顺序排列的英文文本。
     * @param state 当前字幕缓存状态。
     * @param run 当前运行标识。
     * @param onProgress 分析进度通知。
     * @param isCurrent 可选的任务有效性检查。
     * @returns 逐行生词匹配结果。
     */
    private async runAnalysis(
        fileHash: string,
        texts: string[],
        state: AnalysisState,
        run: ActiveAnalysis,
    ): Promise<SubtitleVocabularyAnalysisResult> {
        try {
            this.scheduler.beginFrame();
            const lineMatches: MatchedWord[][] = new Array(texts.length);
            let completedChunks = 0;
            const chunkSize = 50;

            for (let chunkIndex = 0; chunkIndex < state.totalChunks; chunkIndex++) {
                const cachedChunk = state.chunks.get(chunkIndex);
                if (!cachedChunk) {
                    continue;
                }
                const start = chunkIndex * chunkSize;
                cachedChunk.forEach((matches, offset) => {
                    lineMatches[start + offset] = matches;
                });
                completedChunks++;
            }

            await this.notifyProgress(state, completedChunks, run);

            for (let chunkIndex = 0; chunkIndex < state.totalChunks; chunkIndex++) {
                this.assertCurrent(run, state);
                if (state.chunks.has(chunkIndex)) {
                    continue;
                }

                const start = chunkIndex * chunkSize;
                const matches = await this.wordMatchService.matchWordsInTexts(
                    texts.slice(start, start + chunkSize),
                );
                this.assertCurrent(run, state);
                state.chunks.set(chunkIndex, matches);
                matches.forEach((matchesForLine, offset) => {
                    lineMatches[start + offset] = matchesForLine;
                });

                completedChunks++;
                await this.notifyProgress(state, completedChunks, run);
                await this.scheduler.yieldIfNeeded();
            }

            this.assertCurrent(run, state);
            const result: SubtitleVocabularyAnalysisResult = {
                fileHash,
                vocabularyRevision: state.vocabularyRevision,
                lineMatches: lineMatches.map((matches) => matches ?? []),
            };
            state.result = result;
            state.progress = 100;
            await this.fanOutProgress(run, 100);
            return result;
        } finally {
            if (this.activeAnalysis?.runId === run.runId) {
                this.activeAnalysis = undefined;
            }
        }
    }

    private async fanOutProgress(run: ActiveAnalysis, progress: number): Promise<void> {
        for (const subscriber of run.subscribers) {
            if (!subscriber.active || !subscriber.onProgress) {
                continue;
            }
            if (subscriber.isCurrent && !subscriber.isCurrent()) {
                subscriber.active = false;
                continue;
            }
            await subscriber.onProgress(progress);
        }
    }

    /**
     * 更新进度并检查当前任务身份。
     *
     * @param state 当前字幕缓存状态。
     * @param completedChunks 已完成的分块数量。
     * @param run 当前运行标识。
     */
    private async notifyProgress(
        state: AnalysisState,
        completedChunks: number,
        run: ActiveAnalysis,
    ): Promise<void> {
        this.assertCurrent(run, state);
        const progress = state.totalChunks === 0
            ? 100
            : Math.min(99, Math.round((completedChunks / state.totalChunks) * 100));
        state.progress = progress;
        await this.fanOutProgress(run, progress);
    }

    /**
     * 确认共享分析任务仍然有效；仅当所有订阅调用方都失效时才中止本轮运行。
     *
     * @param run 当前运行标识。
     * @param state 当前字幕缓存状态。
     */
    private assertCurrent(
        run: ActiveAnalysis,
        state: AnalysisState,
    ): void {
        if (this.activeAnalysis?.runId !== run.runId) {
            throw new Error('SUBTITLE_VOCABULARY_ANALYSIS_REPLACED');
        }
        if (this.states.get(run.fileHash) !== state) {
            throw new Error('SUBTITLE_VOCABULARY_ANALYSIS_INVALIDATED');
        }
        let anyActive = false;
        for (const subscriber of run.subscribers) {
            if (!subscriber.active) continue;
            if (subscriber.isCurrent && !subscriber.isCurrent()) {
                subscriber.active = false;
                continue;
            }
            anyActive = true;
        }
        if (!anyActive) {
            throw new Error('SUBTITLE_VOCABULARY_ANALYSIS_CANCELLED');
        }
    }
}
