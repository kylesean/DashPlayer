import { createHash } from 'node:crypto';

import type { SrtSentence } from '@/common/types/SentenceC';
import type { SubtitleVocabularyAnalysisService } from '@/backend/services/SubtitleVocabularyAnalysisService';

/**
 * 字幕分析得到的可裁切片段。
 */
export type ClipCandidate = {
    /** 字幕行序号。 */
    indexInSrt: number;
    /** 片段稳定键。 */
    clipKey: string;
    /** 当前片段命中的单词列表。 */
    matchedWords: string[];
};

/**
 * 单行字幕的命中词结果。
 *
 * 片段键与视频相关，不能与命中词一起缓存，否则同一字幕换视频后
 * 会继续返回上一个视频的片段键。
 */
type MatchedLine = {
    indexInSrt: number;
    matchedWords: string[];
};

/**
 * 将共享字幕生词结果转换为裁切候选片段。
 *
 * 这里不再执行单词匹配，只负责消费共享的逐行结果。
 */
export default class VideoLearningClipAnalysis {
    private readonly candidates = new Map<string, MatchedLine[]>();

    /**
     * 创建裁切候选转换器。
     *
     * @param getVocabularyAnalysisService 延迟获取共享字幕生词分析服务。
     */
    public constructor(
        private readonly getVocabularyAnalysisService: () => SubtitleVocabularyAnalysisService,
    ) {}

    /**
     * 读取已完成的候选片段缓存。
     *
     * @param videoPath 视频路径；用于生成与视频绑定的片段键。
     * @param srtKey 字幕缓存键。
     * @returns 已完成时返回候选片段，否则返回 undefined。
     */
    public getCachedCandidates(videoPath: string, srtKey: string): ClipCandidate[] | undefined {
        const cached = this.candidates.get(srtKey);
        return cached ? this.toCandidates(videoPath, srtKey, cached) : undefined;
    }

    /**
     * 判断指定字幕是否仍在分析。
     *
     * 必须用 isActive（是否挂 activeAnalysis）而不是 getStatus().status === 'analyzing'：
     * 被其它字幕取代的分析（有分块但已让位）getStatus 仍返回 analyzing，
     * 用它判定会让 detectClipStatus 的轮询补跑永不触发，状态永久卡在"分析中"。
     *
     * @param srtKey 字幕缓存键。
     * @returns 存在运行中的共享分析任务时返回 true。
     */
    public isRunning(srtKey: string): boolean {
        return this.getVocabularyAnalysisService().isActive(srtKey);
    }

    /**
     * 读取正在进行的共享分析进度。
     *
     * @param srtKey 字幕缓存键。
     * @returns 当前进度；未开始时返回 undefined。
     */
    public getProgress(srtKey: string): number | undefined {
        const status = this.getVocabularyAnalysisService().getStatus(srtKey);
        return status.status === 'analyzing' ? status.progress : undefined;
    }

    /**
     * 读取已缓存分块可推导出的续跑进度。
     *
     * @param srtKey 字幕缓存键。
     * @returns 当前已有的分析进度；没有缓存时返回 undefined。
     */
    public getCachedProgress(srtKey: string): number | undefined {
        const status = this.getVocabularyAnalysisService().getStatus(srtKey);
        return status.status === 'idle' ? undefined : status.progress;
    }

    /**
     * 根据共享逐行生词结果生成可裁切片段。
     *
     * 同一字幕的重复调用复用命中词缓存；尚未完成时等待共享分析任务。
     * 片段键包含视频身份：同一字幕配不同视频时不能复用彼此的片段。
     *
     * @param videoPath 视频路径。
     * @param srtKey 字幕缓存键。
     * @param srt 已加载的字幕内容。
     * @param onProgress 分析进度通知。
     * @returns 可裁切片段列表。
     */
    public async collectCandidates(
        videoPath: string,
        srtKey: string,
        srt: SrtSentence,
        onProgress?: (progress: number) => Promise<void> | void,
    ): Promise<ClipCandidate[]> {
        const cachedLines = this.candidates.get(srtKey);
        if (cachedLines) {
            return this.toCandidates(videoPath, srtKey, cachedLines);
        }

        const texts = srt.sentences.map((sentence) => sentence.text.toLowerCase());
        const analysis = await this.getVocabularyAnalysisService().analyze(
            srt.fileHash,
            texts,
            onProgress,
        );

        const lines: MatchedLine[] = srt.sentences.map((sentence, indexInSrt) => {
            const matchedWords = Array.from(
                new Set(
                    (analysis.lineMatches[indexInSrt] ?? [])
                        .map((match) => (
                            match.databaseWord?.word
                            || match.normalized
                            || match.original
                            || ''
                        ).toLowerCase())
                        .filter(Boolean),
                ),
            );
            return { indexInSrt, matchedWords };
        });

        this.candidates.set(srtKey, lines);
        return this.toCandidates(videoPath, srtKey, lines);
    }

    /**
     * 把命中词结果转换为带视频身份的候选片段。
     *
     * @param videoPath 视频路径。
     * @param srtKey 字幕缓存键。
     * @param lines 逐行命中词结果。
     * @returns 非空命中词的候选片段。
     */
    private toCandidates(videoPath: string, srtKey: string, lines: MatchedLine[]): ClipCandidate[] {
        const videoKey = createHash('sha1').update(videoPath).digest('hex');
        return lines
            .filter((line) => line.matchedWords.length > 0)
            .map((line) => ({
                indexInSrt: line.indexInSrt,
                clipKey: `${srtKey}__${line.indexInSrt}__${videoKey}`,
                matchedWords: line.matchedWords,
            }));
    }

    /**
     * 清除裁切候选缓存和共享字幕分析缓存。
     */
    public clear(): void {
        this.candidates.clear();
        this.getVocabularyAnalysisService().invalidate();
    }
}
