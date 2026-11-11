import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type SceneIndexRepository from '@/backend/services/repositories/SceneIndexRepository';
import {
    SCENE_SEGMENTATION_VERSION,
    segmentScenes,
    type SceneBoundary,
    type SceneSentence,
} from '@/common/learning/sceneSegmentation';
import { sceneInputHash } from '@/common/learning/sceneIndexKey';

/**
 * 场景切分索引服务契约。
 */
export default interface SceneIndexService {
    /**
     * 读取或计算某个字幕文件的场景边界。
     *
     * 命中缓存且输入指纹一致时直接返回；否则重新切分并写回。
     *
     * @param sentences 按 index 升序的字幕句。
     * @returns 场景边界列表；没有边界时为空数组。
     */
    getBoundaries(sentences: readonly SceneSentence[]): Promise<SceneBoundary[]>;

    /**
     * 删除某个字幕文件的索引。
     *
     * @param fileHash 字幕内容哈希。
     * @returns 删除的行数。
     */
    invalidate(fileHash: string): Promise<number>;
}

/**
 * 基于本地确定性切分的场景索引服务。
 *
 * 切分本身不依赖模型、网络或画面，缓存的意义只是避免每次进入播放页都
 * 重新遍历整份字幕。读取失败时静默重算，绝不阻断播放。
 */
@injectable()
export class SceneIndexServiceImpl implements SceneIndexService {
    private readonly logger = getMainLogger('SceneIndexService');

    public constructor(
        @inject(TYPES.SceneIndexRepository) private readonly repository: SceneIndexRepository,
    ) {}

    public async getBoundaries(sentences: readonly SceneSentence[]): Promise<SceneBoundary[]> {
        if (sentences.length < 2) {
            return [];
        }
        const fileHash = sentences[0].fileHash;
        // 同一份字幕的所有句子必须来自同一文件；不一致说明调用方混用了字幕。
        if (!fileHash || sentences.some((sentence) => sentence.fileHash !== fileHash)) {
            return segmentScenes([...sentences]);
        }
        const inputHash = sceneInputHash(sentences);
        try {
            const cached = await this.repository.find(fileHash, SCENE_SEGMENTATION_VERSION);
            if (cached && cached.input_hash === inputHash) {
                const parsed = parseBoundaries(cached.boundaries_json);
                if (parsed) {
                    return parsed;
                }
                // JSON 损坏时按未命中处理，重算并覆盖，而不是把坏数据抛给调用方。
                this.logger.warn('scene index payload invalid, recomputing', { fileHash });
            }
        } catch (error) {
            this.logger.warn('scene index read skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        const boundaries = segmentScenes([...sentences]);
        try {
            await this.repository.upsert({
                fileHash,
                algorithmVersion: SCENE_SEGMENTATION_VERSION,
                inputHash,
                boundariesJson: JSON.stringify(boundaries),
            });
        } catch (error) {
            // 写入失败只影响下次是否重算，不影响本次结果。
            this.logger.warn('scene index write skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return boundaries;
    }

    public async invalidate(fileHash: string): Promise<number> {
        try {
            return await this.repository.deleteByFile(fileHash);
        } catch (error) {
            this.logger.warn('scene index invalidate skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
            return 0;
        }
    }
}

/**
 * 校验并解析持久化的边界数组。
 *
 * 只做结构校验，不重算：写入端与读取端共用同一个算法版本，结构不合法
 * 说明数据损坏或来自不兼容的旧版本，按未命中处理最安全。
 *
 * @param json 持久化的 JSON 文本。
 * @returns 合法的边界数组；结构不合法时为 null。
 */
function parseBoundaries(json: string): SceneBoundary[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) {
        return null;
    }
    const result: SceneBoundary[] = [];
    for (const item of parsed) {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        const record = item as Record<string, unknown>;
        const { sentenceIndex, atSec, kinds, confidence } = record;
        if (
            typeof sentenceIndex !== 'number'
            || typeof atSec !== 'number'
            || !Array.isArray(kinds)
            || kinds.length === 0
            || !kinds.every((kind) => kind === 'time-gap' || kind === 'topic-shift' || kind === 'speaker-shift')
            || typeof confidence !== 'number'
        ) {
            return null;
        }
        result.push({
            sentenceIndex,
            atSec,
            kinds: kinds as SceneBoundary['kinds'],
            confidence,
        });
    }
    return result;
}
