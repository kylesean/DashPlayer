# Fork 分叉资产清单

> 本 fork（kylesean/DashPlayer）自上游 solidSpoon/DashPlayer v6.17.0（分叉点 a04dd291，2026-11-07）分叉，
> 产品方向已彻底分化：上游押注移动端/iOS 体验，本 fork 押注 YouTube 动线、跟读练习、意群精听与本地 LLM 兜底。
>
> **本文件是「同步上游」决策的常备依据**：每次重放上游改动前，先查此清单——上游改到已删除模块的文件时
> 直接判定「不适用」，改到共有模块时才需要评估合并。

## 1. 同步策略（硬约定）

- **只重放，永不 merge upstream**：上游用 yarn 1.22，本 fork 已迁 pnpm 10，lockfile 永久分叉；
  merge 会把已删除的模块整包带回并产生无法合流的 yarn.lock 冲突。
- **移动端例外**：`src/mobile/` 保持跟随上游（本 fork 未形成自己的移动端设计），
  上游移动端改动用整目录对齐方式吸收：`git checkout upstream/main -- src/mobile/`，
  随后核对 fork 独有文件是否被上游删除（对照本文件第 3 节）。
- **重放三分类**：安全/基建 → 手工重放；产品特性 → 只看思路；bug 修复 → 先查自己是否有同款问题。
- **每次同步的处置结论**追加到 `docs/upstream-watch.md`（一页流水账即可）。

## 2. 已删除的上游模块（重放时遇到即判定「不适用」）

| 模块 | 关键文件（上游视角） | fork 删除提交 |
|---|---|---|
| 配音 Dubbing | `DubbingService/Controller`、`features/player/dubbing/`、`common/contracts/dubbing.ts` | 86e0289d |
| 收藏片段 Favourite | `FavouriteClipsService`、`features/favourite/`、`clipTagRelation/tag/videoClip` 表 | b749b711 |
| 播放修复 PlaybackRepair | `PlaybackRepairService`（1018 行）、`features/repair/`、`playback-repair-rules.ts` | 563c04e6 |
| 本地章节切分 | `SplitVideoService`、`features/split/`、`chapter-parser.ts` | 578ee9c3 |
| 视频转录入口 | `TranscriptionService`、`features/transcript/`、`transcriptionTask` 表 | 68dfbbe3 |
| OPUS-MT / LocalMt 翻译 | `LocalMtService`、`LocalMtRuntime`、`local-mt.ts` 契约 | c0f6e3d2 |
| ai-elements 组件库 | `fronted/components/ai-elements/`（40+ 文件） | 43b12822 |
| 死表 | `dp_stems`、`dp_kvs` | cc5c8bcf |

对应 IPC 契约（`common/api/api-def.ts`）中的域也已同步移除。

## 3. Fork 独有模块（上游不存在的功能，重放上游时它们是冲突高发区）

| 模块 | 关键路径 |
|---|---|
| YouTube 导入 | `YoutubeImportService/Controller`、`infrastructure/ytdlp/`、`features/youtube-import/`、`common/contracts/youtube-import.ts` |
| 句子跟读与听写练习 | `SentencePracticeService`、`features/practice/`、`pronunciationScoring.ts`、`sentencePracticeRecord` 表 |
| 字幕意群重切分 | `common/utils/subtitle/meaning-group-segmenter.ts`、`docs/meaning-group-resegmentation.md` |
| 整句模式（意群归并） | `features/player/lib/sentence-grouping.ts`、主字幕区成组渲染 |
| 语境感知查词 | 词翻译缓存写回键不对称修复、句子上文接线（b6465ddc） |
| 整句学习本地兜底 | `ChatSessionService` 本地回退链路、`localAiChatTemplate.ts`、`parseMaybeJson.ts` |
| IPC 强校验 | `controllers/ipc/routeSchemas.ts`（契约外字段显式报错）、traceId 贯穿 |
| UI 设计系统 | Astryx 迁移（77 个提交中的 9 个 refactor 提交）、`src/astryx-themes.ts` |
| 工程基建 | pnpm 10（上游是 yarn 1.22）、ESLint 9 flat config、`docs/` 三份新约定文档 |

## 4. 共有模块（两侧都有，重放上游时需逐文件评估）

播放器核心（`PlayerEngine`/字幕渲染/翻译）、生词本（`VocabularyService`/`dp_words`）、
视频学习片段（`VideoLearningService`）、词典查询（`TranslateService`/腾讯/有道）、
并发内核（`utils/concurrency/`）、任务系统（`DpTaskService`）、
观看历史、设置系统、`src/common/api/api-def.ts`。

## 5. 已知的坐标遗留项（后续决策）

- `scripts/whisper-runtime-meta.mjs` 的 `DASHPLAYER_REPOSITORY` 仍指向上游
  `solidSpoon/DashPlayer`：whisper 运行时 Release（prerelease，tag `whisper-runtime-*`）
  目前从上游下载。上游重建运行时配方后本 fork 会跟着受影响。
  若要彻底独立，需在本仓库跑一次 `whisper-runtime.yml` 产出自己的运行时 Release 并改此常量。
- 更新检查（`CheckUpdate.ts`）已指向 fork 仓库（d8046a87）。
- AGPL-3.0 合规：分发时保留 LICENSE 与上游版权声明。

## 6. 版本线

- 基线 1.0.0（b2cf465a 重置），与上游 6.x 脱钩；首个 fork 发版 1.1.0。
- tag v1.0.0 为一次性基线锚点（后续 tag 全部由 Release Please 自动打）。
- 上游版本号仅作参考：上游 v6.18.0~v6.19.1（2026-11-08）的移动端内容已吸收，
  其余内容见 `docs/upstream-watch.md`。
