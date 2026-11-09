# 产品需求与决策记录

> 记录定位复盘后确认的需求、实现状态与待决策项。与 `docs/fork-divergence.md`（分叉资产）互补：
> 这里记「要做什么/为什么」，那里记「哪些是 fork 的、哪些跟上游」。

## 1. 手动策展能力（标记句子/片段）

- **状态：记录，暂不实现（观察使用习惯）**
- **背景**：移除收藏片段后，复习只剩「生词本 + 自动切片」，缺少“手动标记某句/某段反复精听”的入口。
- **决策**：先观察真实使用频率；确需时补一个轻量「标记句子」能力（复用生词本/观看历史，不恢复 tag 系统与整套 favourite 模块）。
- **验收标准（若实现）**：播放页可对当前句一键标记；标记列表可按视频聚合；与生词本不混淆；无标签体系。

## 2. 本地视频播放失败的最小诊断提示

- **状态：已实现（2026-11-09）**
- **背景**：播放修复链路删除后，`PlayerPage` 仍订阅 `mediaErrorCode`/`playbackStallCount` 但无任何消费方；
  `FileSelector` 还留有“格式兼容性引导统一由播放页负责”的注释，实际已无实现。问题发生但没有出口。
- **实现**：`Layout.tsx` 在 `mediaErrorCode !== null` 时显示顶部提示条：
  “视频无法播放（错误码 X）。本地视频建议转成 H.264 + AAC 的 MP4 后重试；YouTube 导入的视频不受影响。”
  同时删除 `PlayerPage` 中的死订阅。
- **明确不做**：不恢复诊断/转码/能力学习/修复任务表整套 PlaybackRepair。

## 3. 无字幕视频的字幕生成入口

- **状态：已实现（2026-11-09，最小编排）**
- **背景**：转录入口删除后，无字幕的 YouTube 视频或本地视频字幕区为空且不引导；
  而 `TranscriptionEngineSelector`、whisper.cpp/sherpa-onnx 网关、模型下载与设置页资源卡全部保留。
- **实现**：
  - 后端 `SubtitleGenerationService`：读取时长 → 按 300s 分片（1s 重叠）抽 16k 单声道 WAV →
    本地 ASR 逐片识别 → `EnglishSubtitleSegmenter` 合并分句 → 写同名 `.srt` → `attachSrt`。
    DpTask 承载进度与取消；同名 SRT 已存在时显式失败，不静默覆盖。
  - IPC：`subtitle-generation/start`、`subtitle-generation/cancel`。
  - 前端：无字幕时字幕面板显示「生成字幕」卡片，进度经全局任务中心推送；
    完成后 `reloadSubtitles()` 自动重建字幕上下文。
- **明确不做**：上游的「按播放位置重排分片」「增量字幕展示/会话快照」不做。
- **已知限制**：模型未下载时任务失败并提示“请在设置中心下载模型”；不做自动下载。

## 4. 本地字幕翻译模型的首次使用门槛

- **状态：已决策（2026-11-09）**
- **问题**：上游 OPUS-MT（`Xenova/opus-mt-en-zh`）总计 **284.7 MB**（encoder int8 50 MB + decoder fp32 225 MB + 分词器）；
  fork 移除后「本地」引擎改为本地 LLM：默认 Qwen3.5 2B Q4 **1.28 GB**，另有 TranslateGemma 4B Q4 **2.49 GB**。
- **关键分析**：
  - 本地模型槽位同时服务四个场景：词典语境解释（要求严格结构化 JSON）、字幕批量翻译、
    整句分析、聊天兜底。**专用翻译模型（OPUS-MT / Hunyuan-MT / TranslateGemma）不擅长指令跟随与
    结构化输出**，不能作为唯一模型，否则词典与整句学习会退化。
  - 不存在“明显强于 OPUS-MT 且体积不增”的现成模型；质量提升必然换更大模型。
  - 单一事实来源的正确形态是「一个通用指令模型 + 用提示词补场景差异」，而不是“模型 × 场景”的组合爆炸。
- **最终决策**：
  1. 本地模型目录只保留 **一个通用指令模型**：Qwen3.5 2B Q4（1.28 GB），作为词典/字幕翻译/整句学习/聊天的统一来源；
  2. **移除 TranslateGemma 4B**（专用翻译模型，不进入默认路径）；
  3. **不引入 Hunyuan-MT**；未来只有在出现“通用模型翻译不够好”的实测证据时，才允许作为**唯一一个可选翻译增强**，
     且需先通过现有 `subtitleBatchPrompt.local-eval` 对照评估；
  4. 量化只保留 Q4_K_M 一档，不向用户暴露量化版本；硬件更强的用户通过「自定义模型」放入自己的 GGUF；
  5. 存储的模型 id 失效时由 `LocalAiRuntime.getActiveModelId` 显式迁移到新默认值（已有行为），不需要额外迁移脚本。

### 附：各场景的实际引擎默认值（事实核对）

| 场景 | 默认 | 说明 |
|---|---|---|
| 查词 | **内置离线词典优先** | 无句子上下文或未配置引擎时直接返回 `dictionary.sqlite`；带语境且配置了 `providers.dictionary`（openai/local）才调 LLM，失败回退内置词典 |
| 字幕翻译 | 云端 `openai`（`providers.subtitleTranslation`） | 可切 `local`（本地模型）或 `none`；未配置/失败走资源回退 |
| 整句分析 / 聊天 | 有云端配置时云端，本地模型兜底 | 本地模型只承担离线兜底，不替代云端 |

## 5. 词典导入（用户自备）

- **状态：已实现（2026-11-09）**
- **合规边界**：只做「用户自备文件 → 应用内统一格式」的转换，不内置、不下载任何版权词典内容（内置下载指向侵权源属于帮助侵权，非商业项目也不豁免）。
- **支持格式**：StarDict（`.ifo` + `.idx/.idx.gz` + `.dict/.dict.dz`）、CSV（`word,phonetic,translation`）、SQLite（`entries` 表至少含 `word`/`translation`）。MDict（`.mdx`）暂不支持，格式复杂度高，建议先转换为上述格式。
- **实现**：`ImportedDictionaryService` 转换并写入 `userData/dictionaries/<id>/dictionary.sqlite`（开发环境带 `-dev` 后缀），注册表为同目录 `index.json`；设置页「本地词典包（自备）」提供导入、启停、删除。
- **查词顺序**：启用的导入词典（按导入顺序）→ 内置 ECDICT → 云端/本地 LLM；LLM 失败时回退导入词典 → 内置词典。
- **已知限制**：导入为一次性全量转换，超大词典（十万级以上词条）会占用较多内存/时间；不读取 MDict 的音频/图片资源。

## 6. 词典增强优先级（P0–P3）决策

- **P0 内置 ECDICT 1.0.28**：保持，不换。
- **P1a 词形反向索引**：**不做**。实测现有 `lemmatizeWord`（wink）已覆盖 `went→go`、`better→good`、`children→child`、`mice→mouse`、`sank→sink`、`data→datum` 等，仅 `learnt` 这类少见变体漏掉；为它升 schema + 重建数据不划算。
- **P1b OEWN 英英释义**：**已实现（2026-11-09）**。采用 Princeton WordNet 3.1（16.4 MB，WordNet License）作为可选下载包：
  设置页「英英释义增强包」下载后解压并构建为本地 SQLite（`userData/dictionaries/oewn-english/english.sqlite`），
  单词卡追加英文释义、同义词与反义词；不随主安装包分发，卸载即删除。下载/构建进度走后台任务中心，支持取消。
- **P2/P3（Tatoeba 例句、CMUdict 发音、CEFR、CC-CEDICT 反查）**：不做，理由见开发对话记录。

## 7. YouTube 导入只拉英文轨

- **决策**：`yt-dlp` 只请求 `en,en-orig`，不再拉 `zh-Hans`。
- **理由**：YouTube 上的中文轨绝大多数是「英语自动字幕 → 机翻」的产物，断句和用词都不如本项目自己的翻译管线；而且这些视频本就以英文学习为主。
  旧实现虽然会把 `zh-Hans.srt` 下到库里，但导入服务只挂载 `*.en*.srt`（`ENGLISH_SRT_PATTERN`），中文轨从未被使用，纯属浪费带宽，还多一次 timedtext 请求、多一次 429 限流机会。
- **代价**：如果导入的是纯中文视频，不会再顺手带上 YouTube 的中文轨；这类视频需要走本地 ASR 生成字幕。



