/**
 * 可选的英语离线 TTS 音色。
 *
 * 支持两条推理引擎（共用同一随应用分发的 sherpa-onnx-offline-tts 二进制）：
 * - `kokoro`：Kokoro-82M v0.19 int8（98.5MB 单包覆盖美/英 4 个精选拟人声线，语气起伏与呼吸感接近真人）。
 * - `vits`：Piper VITS ONNX（轻量兼容旧音色，老用户已下载的模型保持继续可用）。
 */
export type SherpaTtsEngine = 'vits' | 'kokoro';

export interface SherpaTtsVoice {
    /** 稳定标识，持久化在设置里，改动会导致用户选择失效。 */
    id: string;
    /** 底层 TTS 模型架构。 */
    engine: SherpaTtsEngine;
    /** 设置页展示的可读名称后缀（如 Kokoro Bella / Piper Lessac）。 */
    displayName?: string;
    /** 多说话人模型（Kokoro）的说话人 ID，传入 `--sid`。 */
    speakerId?: number;
    /** 多说话人模型必需的声纹权重文件名（Kokoro 为 voices.bin）。 */
    voicesFileName?: string;
    /** 口音：决定单词卡上的「美/英」标记与默认选择。 */
    accent: 'en-US' | 'en-GB';
    /** 音色性别，仅用于设置页展示。 */
    gender: 'female' | 'male';
    /** 音质档位：low 轻量、medium 标准、high 高拟真（Kokoro）。 */
    quality: 'low' | 'medium' | 'high';
    /** 模型归档解压后的目录名。 */
    directoryName: string;
    /** 归档文件名。 */
    archiveName: string;
    /**
     * 归档 SHA256。
     *
     * 取值来自 `k2-fsa/sherpa-onnx` 官方 release `tts-models` 的 asset digest。
     */
    archiveSha256?: string;
    /** 归档内 ONNX 模型文件名。 */
    modelFileName: string;
}

const KOKORO_EN_V0_19_META = {
    engine: 'kokoro' as const,
    quality: 'high' as const,
    directoryName: 'kokoro-int8-en-v0_19',
    archiveName: 'kokoro-int8-en-v0_19.tar.bz2',
    archiveSha256: 'c9f0dd393615805b0bab050c340834d5e684e732aec91c0e860cd30e982c08bd',
    modelFileName: 'model.int8.onnx',
    voicesFileName: 'voices.bin',
};

/**
 * 音色清单。
 *
 * 将轻量兼容的 Piper 与高拟真 Kokoro 共存，其中 `en-US-amy-low` 保持在索引 0 以兼容历史测试与老配置。
 */
export const SHERPA_TTS_VOICES: readonly SherpaTtsVoice[] = [
    {
        id: 'en-US-amy-low',
        engine: 'vits',
        displayName: 'Piper Amy',
        accent: 'en-US',
        gender: 'female',
        quality: 'low',
        directoryName: 'vits-piper-en_US-amy-low',
        archiveName: 'vits-piper-en_US-amy-low.tar.bz2',
        archiveSha256: 'c70f5284a09a7fd4ed203b39b2ff51cac1432b422b852eb647b481dade3cf639',
        modelFileName: 'en_US-amy-low.onnx',
    },
    {
        id: 'kokoro-en-US-bella',
        ...KOKORO_EN_V0_19_META,
        displayName: 'Kokoro Bella',
        speakerId: 1,
        accent: 'en-US',
        gender: 'female',
    },
    {
        id: 'kokoro-en-US-michael',
        ...KOKORO_EN_V0_19_META,
        displayName: 'Kokoro Michael',
        speakerId: 6,
        accent: 'en-US',
        gender: 'male',
    },
    {
        id: 'kokoro-en-GB-emma',
        ...KOKORO_EN_V0_19_META,
        displayName: 'Kokoro Emma',
        speakerId: 7,
        accent: 'en-GB',
        gender: 'female',
    },
    {
        id: 'kokoro-en-GB-george',
        ...KOKORO_EN_V0_19_META,
        displayName: 'Kokoro George',
        speakerId: 9,
        accent: 'en-GB',
        gender: 'male',
    },
    {
        id: 'en-US-lessac-medium',
        engine: 'vits',
        displayName: 'Piper Lessac',
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
        engine: 'vits',
        displayName: 'Piper Alan',
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
        engine: 'vits',
        displayName: 'Piper Alba',
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
 * 新用户或未显式修改过音色的用户默认指向高拟真的 Kokoro 美音女声（Bella）；
 * 若本地尚未下载 Kokoro 但已有 Piper 旧模型，合成会自动回退到已安装模型。
 */
export const SHERPA_TTS_DEFAULT_VOICE_ID = 'kokoro-en-US-bella';

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
 * 生成某音色的有序下载地址：
 * - Piper 音色：ModelScope 镜像优先（国内直连），GitHub 官方 release 兜底；
 * - Kokoro 音色：直接指向 `k2-fsa/sherpa-onnx` 官方 release（目前社区镜像未托管该包，避免 404 干扰手动下载指引）。
 *
 * @param voice 音色配置。
 * @returns 候选下载地址。
 */
export const sherpaTtsDownloadUrls = (voice: SherpaTtsVoice): string[] => {
    const githubUrl = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${voice.archiveName}`;
    if (voice.engine === 'kokoro') {
        return [githubUrl];
    }
    return [
        `https://www.modelscope.cn/models/solidSpoon/dashplayer-offline-models/resolve/master/${voice.archiveName}`,
        githubUrl,
    ];
};

/** 任一音色安装后都必须存在的公共文件。 */
export const SHERPA_TTS_REQUIRED_FILES = [
    'tokens.txt',
    'espeak-ng-data',
] as const;

/**
 * 返回校验某音色安装完整性所需的全部相对路径（文件或目录）。
 * 统一服务、控制器与安装器对同一音色的校验口径。
 */
export const getSherpaTtsRequiredFiles = (voice: SherpaTtsVoice): string[] => {
    const required = [voice.modelFileName, ...SHERPA_TTS_REQUIRED_FILES];
    if (voice.voicesFileName) {
        required.push(voice.voicesFileName);
    }
    return required;
};
