import { z } from 'zod';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema } from '@/backend/controllers/ipc/routeSchemas';
import type { SrtSentence } from '@/common/types/SentenceC';
import type { SentenceStruct } from '@/common/types/SentenceStruct';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type Controller from '@/backend/controllers/Controller';
import type SubtitleService from '@/backend/services/SubtitleService';
import { type SubtitleVocabularyMatchResult } from '@/backend/services/SubtitleService';
import type SubtitleComprehensionService from '@/backend/services/SubtitleComprehensionService';
import type { SubtitleComprehensionParams } from '@/common/types/subtitleComprehension';
import type SceneIndexService from '@/backend/services/SceneIndexService';
import type { SceneBoundary, SceneSentence } from '@/common/learning/sceneSegmentation';


/**
 * 字幕解析与生词匹配 IPC 控制器。
 */
@injectable()
export default class SubtitleController implements Controller {
    /**
     * 构造字幕控制器。
     *
     * @param subtitleService 字幕业务服务。
     * @param subtitleComprehensionService 句子理解度服务。
     */
    constructor(
        @inject(TYPES.SubtitleService) private readonly subtitleService: SubtitleService,
        @inject(TYPES.SubtitleComprehensionService)
        private readonly subtitleComprehensionService: SubtitleComprehensionService,
        @inject(TYPES.SceneIndexService)
        private readonly sceneIndexService: SceneIndexService,
    ) {}

    /**
     * 为当前播放会话解析字幕。
     *
     * @param params 字幕路径、视频 ID 和字幕加载会话 ID。
     * @returns 已结构化的字幕；会话过期或没有字幕时返回 `null`。
     */
    public async parseSrt(params: {
        subtitlePath: string | null;
        videoId: string;
        playbackSessionId: string;
    }): Promise<SrtSentence | null> {
        return this.subtitleService.parseSrtForPlayback(
            params.subtitlePath,
            params.videoId,
            params.playbackSessionId,
        );
    }

    /**
     * 匹配已解析字幕中出现的用户生词。
     *
     * @param params 字幕哈希、视频 ID 和字幕加载会话 ID。
     * @returns 带字幕哈希的生词匹配结果。
     */
    public async matchVocabulary(params: {
        fileHash: string;
        videoId: string;
        playbackSessionId: string;
    }): Promise<SubtitleVocabularyMatchResult> {
        return this.subtitleService.matchVocabulary(
            params.fileHash,
            params.videoId,
            params.playbackSessionId,
        );
    }

    /**
     * 将任意英文文本解析为前端展示结构。
     *
     * @param texts 待解析文本数组。
     * @returns 与入参顺序一一对应的结构化句子。
     */
    public async parseStructs(texts: string[]): Promise<SentenceStruct[]> {
        return this.subtitleService.parseStructs(texts);
    }

    /**
     * 估算一句话的直接理解概率，用于自适应中文字幕。
     *
     * @param params 句子文本与可选播放定位。
     * @returns 本地可解释的理解度快照。
     */
    public async buildComprehension(params: SubtitleComprehensionParams) {
        return this.subtitleComprehensionService.build(params);
    }

    /**
     * 读取或计算字幕的场景边界。
     *
     * 切分是纯本地的确定性启发式，后端缓存结果，前端不必每次进入播放页都
     * 重新遍历整份字幕。
     *
     * @param params 参与切分的字幕句（只需影响边界的字段）。
     * @returns 场景边界列表。
     */
    public async getSceneBoundaries(params: {
        sentences: SceneSentence[];
    }): Promise<SceneBoundary[]> {
        return this.sceneIndexService.getBoundaries(params.sentences);
    }

    /**
     * 注册字幕相关 IPC 路由。
     */
    registerRoutes(): void {
        registerRoute('subtitle/srt/parse-to-sentences', (p) => this.parseSrt(p), {
            schema: z.object({
                subtitlePath: z.string().nullable(),
                videoId: nonEmptyStringSchema,
                playbackSessionId: nonEmptyStringSchema,
            }),
        });
        registerRoute('subtitle/srt/match-vocabulary', (p) => this.matchVocabulary(p), {
            schema: z.object({
                fileHash: nonEmptyStringSchema,
                videoId: nonEmptyStringSchema,
                playbackSessionId: nonEmptyStringSchema,
            }),
        });
        registerRoute('subtitle/text/parse-structs', (p) => this.parseStructs(p), {
            schema: z.array(z.string()),
        });
        registerRoute('subtitle/comprehension', (p) => this.buildComprehension(p), {
            schema: z.object({
                text: z.string().min(1).max(2000),
                fileHash: z.string().min(1).optional(),
                sentenceIndex: z.number().int().nonnegative().optional(),
            }),
        });
        registerRoute('subtitle/scene-boundaries', (p) => this.getSceneBoundaries(p), {
            schema: z.object({
                sentences: z.array(z.object({
                    fileHash: z.string().min(1),
                    index: z.number().int().nonnegative(),
                    start: z.number(),
                    end: z.number(),
                    text: z.string(),
                })).min(2).max(20000),
            }),
        });
    }
}
