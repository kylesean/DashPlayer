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

- **状态：记录，待决策**
- **问题**：上游 OPUS-MT（`Xenova/opus-mt-en-zh`）总计 **284.7 MB**（encoder int8 50 MB + decoder fp32 225 MB + 分词器）；
  fork 移除后「本地」引擎改为本地 LLM：默认 Qwen3.5 2B Q4 **1.28 GB**，可选 TranslateGemma 4B Q4 **2.49 GB**。
  首次使用门槛提高了约 4.5 倍。
- **结论：不存在“明显更强且体积不增”的现成模型**。en→zh 方向 OPUS-MT 在其体积档仍是强基线；
  NLLB-200-distilled-600M（int8 ≈ 600 MB）更偏多语言与直译，en→zh 未见明确优势；质量提升必须换更大模型：

| 档位 | 模型 | 体积（Q4/int8） | 说明 |
|---|---|---|---|
| 轻量（原基线） | Xenova/opus-mt-en-zh | **285 MB** | en→zh 同体积强基线；依赖 transformers.js ONNX |
| 中档 | Hunyuan-MT-1.8B (HY-MT1.5-1.8B) | 约 1.1 GB | 腾讯 WMT25 冠军家族，33 语言，专用翻译模型 |
| 中档备选 | NLLB-200-distilled-600M | 约 600 MB（int8） | 200 语言，en→zh 偏直译，未必优于 OPUS-MT |
| 高档（现状可选） | TranslateGemma 4B Q4 | 2.49 GB | 翻译质量显著更好，但模型大、显存/内存占用高 |
| 高档（现状默认） | Qwen3.5 2B Q4 | 1.28 GB | 通用模型，兼顾词典与翻译 |

- **可选方案**：
  1. **恢复 OPUS-MT 为「轻量本地翻译」引擎**（285 MB，门槛与上游完全一致），LLM 档位保留为可选——最符合“不提高首次门槛”的要求；
  2. 接受一次性门槛提升到约 1.1 GB，用 Hunyuan-MT-1.8B 作为单一本地引擎（明显强于 OPUS-MT，仍小于 TranslateGemma）；
  3. 维持现状（≥1.28 GB）。
- **建议**：方案 1 或 2。若选 1，需要恢复 `transformers.js` 依赖、LocalMt 运行时与契约，并把设置页引擎选项恢复为三档（无/轻量/本地大模型）。
