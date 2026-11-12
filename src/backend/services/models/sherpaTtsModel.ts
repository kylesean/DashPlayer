/**
 * 可选的英语 TTS 音色。
 *
 * 全部基于 Piper VITS（ONNX），共用同一套 sherpa-onnx 推理管线，
 * 差别只有模型文件、音色与口音。新增音色只需在这里加一条：
 * 下载、安装、选择、朗读四条链路都是数据驱动的。
 */
export interface SherpaTtsVoice {
    /** 稳定标识，持久化在设置里，改动会导致用户选择失效。 */
    id: string;
    /** 口音：决定单词卡上的「美/英」标记与默认选择。 */
    accent: 'en-US' | 'en-GB';
    /** 音色性别，仅用于设置页展示。 */
    gender: 'female' | 'male';
    /** 音质档位：low 体积最小，medium/high 更自然但更大。 */
    quality: 'low' | 'medium' | 'high';
    /** 模型归档解压后的目录名。 */
    directoryName: string;
    /** 归档文件名。 */
    archiveName: string;
    /**
     * 归档 SHA256。
     *
     * 提供时会校验下载完整性，不一致直接报错；未提供时跳过校验，
     * 仅靠解压与必需文件检查兜底。
     *
     * 取值来自 `k2-fsa/sherpa-onnx` 官方 release `tts-models` 的 asset digest；
     * 更换下载源时必须先核对同一份归档的哈希，不能沿用旧值。
     */
    archiveSha256?: string;
    /** 归档内 ONNX 模型文件名。 */
    modelFileName: string;
}

/**
 * 音色清单。
 *
 * 默认使用 `en_US-lessac-medium`：它是 Piper 英语里公认最自然的女声之一，
 * 而 `amy-low` 音质明显偏机械（学习场景里长时间听会疲劳）。medium 档模型
 * 约 60MB，CPU 实时率仍在 10x 以上，代价可接受。
 *
 * `amy-low` 保留在清单里：老用户的设置值指向它时继续可用，不必强制重新下载。
 */
export const SHERPA_TTS_VOICES: readonly SherpaTtsVoice[] = [
    {
        id: 'en-US-amy-low',
        accent: 'en-US',
        gender: 'female',
        quality: 'low',
        directoryName: 'vits-piper-en_US-amy-low',
        archiveName: 'vits-piper-en_US-amy-low.tar.bz2',
        archiveSha256: 'c70f5284a09a7fd4ed203b39b2ff51cac1432b422b852eb647b481dade3cf639',
        modelFileName: 'en_US-amy-low.onnx',
    },
    {
        id: 'en-US-lessac-medium',
        accent: 'en-US',
        gender: 'female',
        quality: 'medium',
        directoryName: 'vits-piper-en_US-lessac-medium',
        archiveName: 'vits-piper-en_US-lessac-medium.tar.bz2',
        archiveSha256: '9e3febfacf0abf4270172d2958bcec246032b7e88efc2720840cc80c93de334e',
        modelFileName: 'en_US-lessac-medium.onnx',
    },
    {
        id: 'en-GB-alan-medium',
        accent: 'en-GB',
        gender: 'male',
        quality: 'medium',
        directoryName: 'vits-piper-en_GB-alan-medium',
        archiveName: 'vits-piper-en_GB-alan-medium.tar.bz2',
        archiveSha256: 'a48d4017da0f77668b27bed63fe6e04dd64c6397e1fadad4f460efb0ef7c9012',
        modelFileName: 'en_GB-alan-medium.onnx',
    },
    {
        id: 'en-GB-alba-medium',
        accent: 'en-GB',
        gender: 'female',
        quality: 'medium',
        directoryName: 'vits-piper-en_GB-alba-medium',
        archiveName: 'vits-piper-en_GB-alba-medium.tar.bz2',
        archiveSha256: 'fcd45962906933eec4431d3688f7d74aaac8713c87c6717f91fd3b23463aa1a1',
        modelFileName: 'en_GB-alba-medium.onnx',
    },
] as const;

/**
 * 默认音色。
 *
 * 只影响「从未设置过」的用户；已有设置值指向 amy-low 的老用户保持不变，
 * 由设置页的「音色」下拉框自行切换。
 */
export const SHERPA_TTS_DEFAULT_VOICE_ID = 'en-US-lessac-medium';

/**
 * 按 id 取音色配置。
 *
 * @param id 音色标识；未知或缺失时回退默认音色。
 * @returns 音色配置。
 */
export const resolveSherpaTtsVoice = (id?: string | null): SherpaTtsVoice => {
    return SHERPA_TTS_VOICES.find((voice) => voice.id === id)
        ?? SHERPA_TTS_VOICES.find((voice) => voice.id === SHERPA_TTS_DEFAULT_VOICE_ID)
        ?? SHERPA_TTS_VOICES[0];
};

/**
 * 生成某音色的有序下载地址：ModelScope 镜像优先（国内可直连），GitHub 兜底。
 *
 * @param voice 音色配置。
 * @returns 候选下载地址。
 */
export const sherpaTtsDownloadUrls = (voice: SherpaTtsVoice): string[] => [
    `https://www.modelscope.cn/models/solidSpoon/dashplayer-offline-models/resolve/master/${voice.archiveName}`,
    `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${voice.archiveName}`,
];

/** 任一音色安装后都必须存在的文件。 */
export const SHERPA_TTS_REQUIRED_FILES = [
    'tokens.txt',
    'espeak-ng-data',
] as const;
