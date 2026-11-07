import { TRANSLATEGEMMA_4B_CHAT_TEMPLATE } from '@/common/constants/localAiChatTemplate';

/** 本地模型目录项；id 同时作为设置值、安装目录名与缓存隔离键的一部分。 */
export interface LocalAiModelDefinition {
    /** 稳定模型标识，目录内唯一。 */
    id: string;
    /** 展示名。 */
    name: string;
    /** 模型 GGUF 文件名。 */
    file: string;
    /** 精确字节数，用于续传范围与完整性校验。 */
    bytes: number;
    /** 展示用大小标签。 */
    sizeLabel: string;
    /**
     * 有序候选下载地址：声明顺序即优先级，首个为优先源（国内镜像），其余为备用源。
     * 自定义模型无下载源。
     */
    urls: readonly string[];
    /** 固定版本的 SHA256；自定义模型留空。 */
    sha256: string;
    /** 模型来源：catalog 由应用目录预置，custom 为用户手动放入模型目录的文件。 */
    source: 'catalog' | 'custom';
    /**
     * 可选的服务端聊天模板覆盖（Jinja 文本）。
     *
     * llama-server 以 `--jinja` 启动并优先使用 GGUF 内嵌模板；个别模型
     * （如 TranslateGemma 官方模板要求结构化 content）与纯字符串消息
     * 不兼容时必须在此声明等价模板，运行时会写入模型目录并以
     * `--chat-template-file` 启动。不声明的模型沿用内嵌模板。
     */
    chatTemplate?: string;
}

/** 可下载的本地模型目录；同一家族保证提示词与推理参数行为一致。 */
export const LOCAL_AI_MODELS: readonly LocalAiModelDefinition[] = [
    {
        id: 'qwen3.5-2b-q4_k_m',
        name: 'Qwen3.5 2B Q4_K_M',
        file: 'Qwen3.5-2B-Q4_K_M.gguf',
        bytes: 1280835840,
        sizeLabel: '1.28 GB',
        urls: [
            'https://www.modelscope.cn/models/unsloth/Qwen3.5-2B-GGUF/resolve/master/Qwen3.5-2B-Q4_K_M.gguf',
            'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
        ],
        sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
        source: 'catalog',
    },
    {
        id: 'translategemma-4b-q4_k_m',
        name: 'TranslateGemma 4B Q4_K_M',
        file: 'translategemma-4b-it.Q4_K_M.gguf',
        bytes: 2489909760,
        sizeLabel: '2.49 GB',
        urls: [
            'https://hf-mirror.com/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf',
            'https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf',
        ],
        sha256: '81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330',
        source: 'catalog',
        chatTemplate: TRANSLATEGEMMA_4B_CHAT_TEMPLATE,
    },
] as const;

/**
 * 本地模型设置键的默认取值。
 *
 * 词典与字幕翻译共用同一个本地模型槽位，默认取通用模型保证两个功能都可用；
 * 以字幕翻译为主且不用本地词典的用户，可在本地模型页切换到 TranslateGemma
 * （专用翻译模型，翻译质量显著更好，但不擅长词典讲解类生成）。
 */
export const LOCAL_AI_DEFAULT_MODEL_ID = 'qwen3.5-2b-q4_k_m';

/** 自定义模型 id 的固定前缀；后缀为模型目录根下的 GGUF 文件名。 */
export const CUSTOM_MODEL_ID_PREFIX = 'custom:';

/** 判断模型 id 是否指向用户手动放入的自定义模型。 */
export function isCustomModelId(modelId: string): boolean {
    return modelId.startsWith(CUSTOM_MODEL_ID_PREFIX);
}

/**
 * 按稳定 id 查找目录项。
 *
 * @param modelId 待查找的模型标识。
 * @returns 对应目录项；不存在时抛出显式错误，不做默认回退。
 */
export function requireLocalAiModel(modelId: string): LocalAiModelDefinition {
    const found = LOCAL_AI_MODELS.find((model) => model.id === modelId);
    if (!found) {
        throw new Error(`未知的本地模型：${modelId}`);
    }
    return found;
}

/** 单个本地模型的安装与下载状态；大小单位为字节。 */
export interface LocalAiModelStatus {
    /** 模型标识，目录模型与目录一致，自定义模型带 custom: 前缀。 */
    modelId: string;
    /** 展示名。 */
    name: string;
    /** 模型 GGUF 文件名。 */
    file: string;
    /** 精确字节数，用于续传范围与完整性校验。 */
    bytes: number;
    /** 展示用大小标签。 */
    sizeLabel: string;
    /** 运行时内存估算值（GB，保留一位小数），按模型体积约 1.5 倍估算（权重 + KV cache + 推理缓冲）；文案由前端按语言格式化。 */
    memoryEstimateGb: string;
    /** 是否已完整安装。 */
    ready: boolean;
    /** 下载任务阶段；自定义模型恒为 idle。 */
    phase: 'idle' | 'downloading' | 'verifying';
    /** 已下载字节数。 */
    downloaded: number;
    /** 总字节数。 */
    total: number;
    /** 固定版本的模型安装路径。 */
    modelPath: string;
    /** 有序候选下载地址（首个为官方地址，其余为备用镜像）；自定义模型为空数组。 */
    downloadUrls: string[];
    /** 最近一次下载失败原因；成功或无记录时为 null。 */
    error: string | null;
    /** 是否为用户手动放入模型目录的自定义模型。 */
    custom: boolean;
}

/** 本地模型稳态速度测试结果；时长单位毫秒，token 数据由推理端提供，缺失时为 null。 */
export interface LocalAiSpeedTestResult {
    /** 热身轮生成耗时；首轮仅作热身不计入结果。 */
    warmMs: number;
    /** 提示词 token 数。 */
    promptTokens: number | null;
    /** 生成 token 数。 */
    completionTokens: number | null;
    /** 热身轮生成速度（token/秒）。 */
    tokensPerSecond: number | null;
}

/** 本地模型管理页状态；大小单位为字节。 */
export interface LocalAiStatus {
    /** llama-server 运行时是否就绪。 */
    runtimeReady: boolean;
    /** 推理子进程是否在运行。 */
    running: boolean;
    /** 全部本地功能当前共用的模型标识。 */
    activeModelId: string;
    /** 模型根目录的绝对路径；用户手动放置 GGUF 文件的目标位置。 */
    modelsDirectory: string;
    /** 按目录顺序列出目录模型，末尾追加用户手动放入的自定义模型。 */
    models: LocalAiModelStatus[];
}
