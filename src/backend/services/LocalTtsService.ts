import * as path from 'path';
import { inject, injectable } from 'inversify';
import { WithSemaphore } from '@/backend/utils/concurrency/decorators';
import {
    SHERPA_TTS_VOICES,
    getSherpaTtsRequiredFiles,
    resolveSherpaTtsVoice,
    type SherpaTtsVoice,
} from '@/backend/services/models/sherpaTtsModel';
import type SettingService from '@/backend/services/SettingService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import TYPES from '@/backend/ioc/types';
import { SherpaOnnxTtsCli } from '@/backend/infrastructure/media/sherpa/SherpaOnnxTtsCli';

/**
 * LocalTtsService 的业务契约。
 */
export default interface LocalTtsService {
    /**
     * 将文本合成为 WAV 文件。
     * @param text 待读取的英文文本；空文本直接失败。
     * @returns 临时 WAV 文件路径。
     */
    synthesize(text: string): Promise<string>;

    /**
     * 解析当前实际可用（已安装）的音色 id，用于上层音频缓存键精确匹配。
     */
    resolveActiveVoiceId?(): Promise<string | null>;
}



/**
 * 使用本地 Sherpa-ONNX Piper 模型生成语音。
 */
@injectable()
export class LocalTtsServiceImpl implements LocalTtsService {
    constructor(
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.SherpaOnnxTtsCli) private readonly cli: SherpaOnnxTtsCli,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
        @inject(TYPES.SettingService) private readonly settingService: SettingService,
    ) {}

    /**
     * 将文本合成为 WAV 文件。
     * @param text 待读取的英文文本；空文本直接失败。
     * @returns 临时 WAV 文件路径。
     */
    @WithSemaphore('tts')
    public async synthesize(text: string): Promise<string> {
        if (!text.trim()) throw new Error('TTS 文本不能为空');
        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        const voice = await this.resolveUsableVoice(modelsRoot);
        const modelDir = path.join(modelsRoot, voice.directoryName);
        // 合成产物放在媒体库的临时目录里，而不是系统临时目录：
        // - 媒体库根目录是 media:// 协议唯一授权的根，放在这里朗读链接才不会 403；
        // - 系统临时目录（如 /tmp）是全局可写目录，别的进程可以预建同名目录抢走写入权；
        // - 放在这里还能跟着应用自己的临时目录清理一起走，不至于无限堆积。
        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const outputDir = path.join(tempRoot, 'tts');
        await this.fileSystemGateway.ensureDirectory(outputDir);
        const outputPath = path.join(outputDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
        return this.cli.run({
            engine: voice.engine,
            modelPath: path.join(modelDir, voice.modelFileName),
            tokensPath: path.join(modelDir, 'tokens.txt'),
            dataDir: path.join(modelDir, 'espeak-ng-data'),
            voicesPath: voice.voicesFileName ? path.join(modelDir, voice.voicesFileName) : undefined,
            speakerId: voice.speakerId,
            outputPath,
            text: text.trim(),
        });
    }

    /** @inheritdoc */
    public async resolveActiveVoiceId(): Promise<string | null> {
        try {
            const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
            const voice = await this.resolveUsableVoice(modelsRoot);
            return voice.id;
        } catch {
            return null;
        }
    }

    /**
     * 选出真正可以合成的音色。
     *
     * 默认音色可能在升级后尚未下载（例如默认值从 amy-low 换成 lessac-medium），
     * 此时直接报错会让「点喇叭没反应」——朗读是高频辅助功能，不该因为一次
     * 默认值变更就整体不可用。
     *
     * 策略：优先用用户选中的音色；若它未安装，退而使用任意一个已完整安装的
     * 音色（保持口音优先级：同口音优先）。全都未安装时才报错，提示去下载。
     *
     * @param modelsRoot 模型根目录。
     * @returns 可用于合成的音色。
     */
    private async resolveUsableVoice(modelsRoot: string): Promise<SherpaTtsVoice> {
        const selected = resolveSherpaTtsVoice(this.settingService.getSherpaTtsVoice());
        if (await this.isVoiceInstalled(modelsRoot, selected)) {
            return selected;
        }
        // 选中音色未装：按「同口音优先 → 其余」且同档内优先选更高音质（high > medium > low）。
        const qualityRank: Record<SherpaTtsVoice['quality'], number> = { high: 3, medium: 2, low: 1 };
        const byQualityDesc = (a: SherpaTtsVoice, b: SherpaTtsVoice) => qualityRank[b.quality] - qualityRank[a.quality];
        const candidates = [
            ...SHERPA_TTS_VOICES.filter((voice) => voice.accent === selected.accent).sort(byQualityDesc),
            ...SHERPA_TTS_VOICES.filter((voice) => voice.accent !== selected.accent).sort(byQualityDesc),
        ];
        for (const voice of candidates) {
            if (await this.isVoiceInstalled(modelsRoot, voice)) {
                return voice;
            }
        }
        throw new Error('Sherpa TTS 模型尚未下载，请先到设置中心下载模型');
    }

    /**
     * 判断某音色的必需文件是否齐全。
     *
     * @param modelsRoot 模型根目录。
     * @param voice 音色配置。
     * @returns 齐全时返回 true。
     */
    private async isVoiceInstalled(modelsRoot: string, voice: SherpaTtsVoice): Promise<boolean> {
        const modelDir = path.join(modelsRoot, voice.directoryName);
        // 必需条目里 `espeak-ng-data` 是目录，不能用 fileExists（目录会抛错）；
        // pathIsMissing 对文件和目录一视同仁，只判断路径是否存在。
        const required = getSherpaTtsRequiredFiles(voice);
        const missing = await Promise.all(
            required.map((name) => this.fileSystemGateway.pathIsMissing(path.join(modelDir, name))),
        );
        return missing.every((isMissing) => !isMissing);
    }
}
