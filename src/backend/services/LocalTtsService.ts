import * as path from 'path';
import { inject, injectable } from 'inversify';
import { WithSemaphore } from '@/backend/utils/concurrency/decorators';
import { SHERPA_TTS_MODEL_DIRECTORY } from '@/backend/services/models/sherpaTtsModel';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import TYPES from '@/backend/ioc/types';
import { SherpaOnnxTtsCli } from '@/backend/infrastructure/media/sherpa/SherpaOnnxTtsCli';
import type SherpaTtsModelService from '@/backend/services/SherpaTtsModelService';/**
 * LocalTtsService 的业务契约。
 */
export default interface LocalTtsService {
    /**
     * 将文本合成为 WAV 文件。
     * @param text 待读取的英文文本；空文本直接失败。
     * @returns 临时 WAV 文件路径。
     */
    synthesize(text: string): Promise<string>;
}



/**
 * 使用本地 Sherpa-ONNX Piper 模型生成语音。
 */
@injectable()
export class LocalTtsServiceImpl implements LocalTtsService {
    constructor(
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.SherpaTtsModelService) private readonly modelService: SherpaTtsModelService,
        @inject(TYPES.SherpaOnnxTtsCli) private readonly cli: SherpaOnnxTtsCli,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    /**
     * 将文本合成为 WAV 文件。
     * @param text 待读取的英文文本；空文本直接失败。
     * @returns 临时 WAV 文件路径。
     */
    @WithSemaphore('tts')
    public async synthesize(text: string): Promise<string> {
        if (!text.trim()) throw new Error('TTS 文本不能为空');
        const status = await this.modelService.getStatus();
        if (!status.ready) throw new Error('Sherpa TTS 模型尚未下载，请先到设置中心下载模型');
        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        const modelDir = path.join(modelsRoot, SHERPA_TTS_MODEL_DIRECTORY);
        // 合成产物放在媒体库的临时目录里，而不是系统临时目录：
        // - 媒体库根目录是 media:// 协议唯一授权的根，放在这里朗读链接才不会 403；
        // - 系统临时目录（如 /tmp）是全局可写目录，别的进程可以预建同名目录抢走写入权；
        // - 放在这里还能跟着应用自己的临时目录清理一起走，不至于无限堆积。
        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const outputDir = path.join(tempRoot, 'tts');
        await this.fileSystemGateway.ensureDirectory(outputDir);
        const outputPath = path.join(outputDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
        return this.cli.run({
            modelPath: path.join(modelDir, 'en_US-amy-low.onnx'),
            tokensPath: path.join(modelDir, 'tokens.txt'),
            dataDir: path.join(modelDir, 'espeak-ng-data'),
            outputPath,
            text: text.trim(),
        });
    }
}
