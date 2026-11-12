import * as crypto from 'crypto';
import * as path from 'path';
import { inject, injectable } from 'inversify';
import type LocalTtsService from '@/backend/services/LocalTtsService';
import type SettingService from '@/backend/services/SettingService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { resolveSherpaTtsVoice } from '@/backend/services/models/sherpaTtsModel';
import {
    extractSingleEnglishWord,
    fetchDictionaryPronunciation,
} from '@/backend/services/tts/DictionaryPronunciationFetcher';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import UrlUtil from '@/common/utils/UrlUtil';

/**
 * AiFuncService 的业务契约。
 */
export default interface AiFuncService {
    tts(text: string): Promise<string>;
}

/**
 * 编排 AI 功能与语音合成路由。
 *
 * 语音合成采用分层策略：
 * - 单个英语单词：优先复用或拉取真人词典发音（并落盘缓存），离线或未收录时无缝退回离线 TTS；
 * - 句子/短语：优先命中按生效音色键分的本地合成缓存，未命中时由 Sherpa-ONNX（Kokoro / Piper）合成。
 */
@injectable()
export class AiFuncServiceImpl implements AiFuncService {
    private readonly logger = getMainLogger('AiFuncService');

    constructor(
        @inject(TYPES.LocalTtsService) private readonly localTtsService: LocalTtsService,
        @inject(TYPES.SettingService) private readonly settingService: SettingService,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    public async tts(text: string): Promise<string> {
        const normalized = text.trim();
        if (!normalized) {
            throw new Error('TTS 文本不能为空');
        }

        const voice = resolveSherpaTtsVoice(this.settingService.getSherpaTtsVoice());
        const cacheDir = await this.resolveCacheDir();
        const textHash = crypto.createHash('sha1').update(normalized).digest('hex');

        const singleWord = extractSingleEnglishWord(normalized);
        if (singleWord) {
            const wordUrl = await this.resolveDictionaryWordAudio(singleWord, voice.accent, cacheDir, textHash);
            if (wordUrl) {
                return wordUrl;
            }
        }

        const activeVoiceId = (await this.localTtsService.resolveActiveVoiceId?.()) ?? voice.id;
        const ttsCachePath = cacheDir ? path.join(cacheDir, `tts-${activeVoiceId}-${textHash}.wav`) : null;
        if (ttsCachePath && await this.safeFileExists(ttsCachePath)) {
            return UrlUtil.toUrl(ttsCachePath);
        }

        const synthesizedPath = await this.localTtsService.synthesize(normalized);
        if (ttsCachePath && cacheDir) {
            try {
                await this.fileSystemGateway.ensureDirectory(cacheDir);
                await this.fileSystemGateway.moveFile(synthesizedPath, ttsCachePath);
                return UrlUtil.toUrl(ttsCachePath);
            } catch (error) {
                this.logger.debug('cache move skipped, serving direct synthesized audio', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return UrlUtil.toUrl(synthesizedPath);
    }

    private async resolveCacheDir(): Promise<string | null> {
        try {
            const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
            return path.join(tempRoot, 'tts-cache');
        } catch {
            return null;
        }
    }

    private async safeFileExists(filePath: string): Promise<boolean> {
        try {
            return await this.fileSystemGateway.fileExists(filePath);
        } catch {
            return false;
        }
    }

    private async resolveDictionaryWordAudio(
        word: string,
        accent: 'en-US' | 'en-GB',
        cacheDir: string | null,
        textHash: string,
    ): Promise<string | null> {
        const wordCachePath = cacheDir ? path.join(cacheDir, `word-${accent}-${textHash}.mp3`) : null;
        if (wordCachePath && await this.safeFileExists(wordCachePath)) {
            return UrlUtil.toUrl(wordCachePath);
        }

        const buffer = await fetchDictionaryPronunciation(word, accent);
        if (!buffer || !wordCachePath || !cacheDir) {
            return null;
        }
        try {
            await this.fileSystemGateway.ensureDirectory(cacheDir);
            await this.fileSystemGateway.writeBinaryFile(wordCachePath, buffer);
            return UrlUtil.toUrl(wordCachePath);
        } catch (error) {
            this.logger.debug('failed to persist dictionary audio cache', {
                word,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
}
