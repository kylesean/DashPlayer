/**
 * 随包分发的 llama.cpp 运行时版本。
 *
 * 对话模型与向量模型共用同一个二进制：EmbeddingGemma 2 的 `gemma-embedding2`
 * 架构需要 b11500+，而 Qwen3.5 在同一版本下正常生成，因此没有理由维护两套。
 * 升级版本时同步更新 `scripts/download.mjs` 的资源名与 SHA-256。
 */
export const LLAMA_RUNTIME_VERSION = 'b12292';

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
] as const;

/**
 * 本地模型设置键的默认取值。
 *
 * 本地只保留一个「通用指令模型」作为单一事实来源：词典语境解释、字幕翻译、
 * 整句学习与聊天兜底全部复用它，场景差异由提示词承担。专用翻译模型不进入
 * 默认路径——它们不擅长结构化输出与讲解类生成。硬件更强的用户可通过
 * 「自定义模型」放入自己的 GGUF，而不是在目录里堆多套模型。
 */
export const LOCAL_AI_DEFAULT_MODEL_ID = 'qwen3.5-2b-q4_k_m';

/**
 * 可选的本地语义向量模型。
 *
 * 与对话模型分开管理：它只服务于内容推荐的语义相似度，不能切换到聊天/翻译路径，
 * 也不会出现在「使用中模型」里。未安装时推荐自动降级为词面相似度。
 *
 * 选择 EmbeddingGemma 2 而不是 bge-small 的原因：
 * - 多语言（bge-small-en 只支持英文，中英混合字幕会退化）；
 * - 768 维、24 层，语义区分度明显更好；
 * - 官方多模态权重可复用同一 llama-server 进程做图像/音频向量。
 *
 * 代价是必须搭配 llama.cpp b11500+ 运行时（`gemma-embedding2` 架构），
 * 因此下载脚本与两个运行时都固定在 b12292。
 */
export const LOCAL_EMBEDDING_MODEL: LocalAiModelDefinition = {
    id: 'embeddinggemma-2-q4_k_xl',
    name: 'EmbeddingGemma 2 Q4_K_XL',
    file: 'embeddinggemma-2-UD-Q4_K_XL.gguf',
    bytes: 175673856,
    sizeLabel: '168 MB',
    urls: [
        'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q4_K_XL.gguf',
    ],
    sha256: 'ea905fd08e8061db77a0031cbb5096d459d7cfd2bdd0ad2ba66e483f16719493',
    source: 'catalog',
};

/**
 * EmbeddingGemma 2 的多模态投影文件。
 *
 * 只有需要图像/音频向量时才安装：文本推荐不依赖它。单独成项而不是塞进
 * `LOCAL_EMBEDDING_MODEL`，是为了让只做文本语义的安装保持 168 MB 而不是 700 MB。
 */
export const LOCAL_EMBEDDING_MMPROJ: LocalAiModelDefinition = {
    id: 'embeddinggemma-2-mmproj-q8_0',
    name: 'EmbeddingGemma 2 MMProj Q8_0',
    file: 'embeddinggemma-2-mmproj-Q8_0.gguf',
    bytes: 554821120,
    sizeLabel: '529 MB',
    urls: [
        'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/mmproj-Q8_0.gguf',
    ],
    sha256: '90e7b0238009e2954f856f2081dcf7f35af026b64c765e98f4777053e1754460',
    source: 'catalog',
};

/** 向量维度；EmbeddingGemma 2 固定 768 维，用于拒绝异常响应。 */
export const LOCAL_EMBEDDING_DIMENSION = 768;

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
