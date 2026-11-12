/**
 * 离线朗读音色。
 *
 * 与后端 `SHERPA_TTS_VOICES` 一一对应；这里只暴露设置页需要的展示字段，
 * 不含下载地址与校验值。
 */
export interface TtsVoiceVO {
    /** 稳定标识，用于持久化与切换。 */
    id: string;
    /** 可选音色名称（如 Kokoro Bella / Piper Lessac），用于在设置页区分同一口音性别下的不同引擎音色。 */
    name?: string;
    /** 口音：单词卡据此显示「美/英」并决定默认选择。 */
    accent: 'en-US' | 'en-GB';
    /** 音色性别，仅用于设置页展示。 */
    gender: 'female' | 'male';
    /** 音质档位。 */
    quality: 'low' | 'medium' | 'high';
    /** 该音色是否已完整安装。 */
    installed: boolean;
}

/** 音色清单与当前选择。 */
export interface TtsVoiceListVO {
    /** 当前生效的音色 id。 */
    selected: string;
    /** 全部可选音色。 */
    voices: TtsVoiceVO[];
}
