# 隐式状态机地图

> 本文盘点 DashPlayer 里「已经在跑、但没有被显式建模」的状态机。
> 目的不是把全部状态都塞进 XState，而是让 **规则、合法转移、终态** 有唯一落点：
> 读代码的人不用靠交叉比对多个布尔值去猜，改代码的人不会从旁路写入漏掉不变量。
>
> 判定标准：同一组状态字段被 2 处以上写入、且存在「同时只能有一个成立」或
> 「只能按顺序推进」这类约束，即视为隐式状态机。

## 分级口径

- **P0**：约束已经存在、但被旁路破坏，或状态直接影响用户能否完成任务。优先处理。
- **P1**：约束存在且目前没出错，但规则散落在多处，新增入口极易破坏。
- **P2**：状态是线性的、当前实现足够简单；记录在案，暂不抽象。

---

## P0：已经出问题或直接阻断用户

### 1. 播放器「句末行为」模式（已收敛，属预防性改造）

- **位置**：`src/fronted/features/player/playerStore.ts`
- **隐式状态**：`autoPause` / `singleRepeat` / `shadowing` / `sentenceLoop` 四个字段
- **真实约束**：同一时刻只能有一个句末模式生效。`hoverRepeat` 是叠加在持久模式之上的
  瞬态覆盖层，不参与互斥。
- **此前的问题（对抗性复核后的修正结论）**：互斥规则由每个 setter 各自罗列
  「把别人置 false」来维持，`repeatCurrent` 的 `loop` 分支是唯一绕过规则的写入点。
  但复核发现**当前所有调用点传的都是 `loop: false`**（`PlayerShortcut`、
  `VideoPlayerPane`、`clearAdjust` 等），因此这条旁路**当前不可达**，属于潜在隐患
  而非线上缺陷。初版文档把它写成「真实缺陷」是加阳性，这里更正。
  规则本身仍值得收敛：`onTimeUpdate` 按固定顺序逐个 `if` 判定，一旦两个模式同时为真，
  实际行为取决于分支顺序而不是用户最后一次操作。
- **本次处理**：
  - 新增 `src/fronted/features/player/lib/sentence-end-mode.ts`：把「同时只能有一个」
    表达成纯函数（`enableSentenceEndMode` / `deriveSentenceEndMode` /
    `hasSentenceEndModeConflict`），带 9 个单测。
  - `playerStore` 内新增 `applyBooleanSentenceMode`，四个 setter 与 `repeatCurrent`
    统一走它；`sentenceLoop` 走 `clearSentenceEndModes()`。
  - 保留原有对外 API 与字段形状，UI、快捷键、设置弹层均无需改动。
- **后续可选**：把 `deriveSentenceEndMode` 接到工具栏，让「当前模式」由派生值渲染，
  而不是各组件自行组合布尔值。

### 2. 字幕翻译调度会话

- **位置**：`src/backend/services/subtitle-translation/SubtitleTranslationScheduler.ts`
- **隐式状态**：每个 `fileHash` 的会话内，`pendingJobs` / `runningJobs` /
  `completedIndices` / `deadIndices` / `inFlightIndices` 五个集合共同表达
  「待认领 → 执行中 → 完成 / 死信 / 被丢弃」。
- **风险点**：同一字幕坐标可能同时出现在多个集合里（重试入队、跳转导致窗口移动），
  目前靠 `isBatchInCurrentWindow` 与 `MAX_REQUEUE_COUNT` 两个局部判断兜住。
  新增一种失败处理路径时，很容易忘记同步清理 `inFlightIndices`。
- **建议**：为「单个字幕坐标」抽一个显式 `BatchState = queued | running | completed |
  dead | dropped`，用 `Map<number, BatchState>` 取代集合交集推导。收益主要在 DX/AX：
  状态可以被打日志、被断言，不必反推。
- **为何暂不动**：这是翻译主链路的热路径，当前有 2 个测试文件覆盖；改造应在有
  实测收益时单独进行，不与其它改动混在一起。

### 3. 跟读录音（`usePracticeRecorder`）

- **位置**：`src/fronted/features/practice/usePracticeRecorder.ts`
- **隐式状态**：`PracticeRecorderPhase = 'idle' | 'recording' | 'processing'`，
  叠加 `practiceStore.recording`（供快捷键层读取）。
- **已确认的真实缺陷（已修复，有回归测试）**：
  1. **面板卸载不归位全局标志**：组件卸载后不会再有 `phase` 变化去同步
     `practiceStore.recording`，该标志永久为 `true`，`PlayerShortcut` 的
     `playbackKeysEnabled = !learningVisible && !practiceRecording` 因此永久为 `false`，
     播放类快捷键在本次会话内全部失效，只能重启应用恢复。
  2. **录音中切到听写页签不停麦克风**：切页签只让跟读 UI 消失，面板并未卸载，
     卸载兜底不触发；麦克风继续采集，`recording` 同样卡住。
- **修复方式**：hook 新增 `cancel()`（停止采集但不提交评分）与 `active` 声明式开关；
  面板传 `active = visible && mode === 'shadowing' && currentSentence !== null`，
  任一条件失效即自动丢弃录音。卸载路径额外显式 `setRecording(false)`。
- **同时修复**：面板卸载或隐藏时未暂停 `audioRef` 中的录音回放，导致用户回到播放画面后
  录音仍在出声。
- **后续可选**：把 `phase` 的转移写成纯函数（`nextPhase(phase, event)`），
  事件取 `start / micDenied / stop / empty / scored / failed / cancel / unmount`。

---

## P1：规则散落，新增入口易破坏

### 4. 播放器「模态视图」互斥

- **位置**：`chatStore.learningVisible`、`practiceStore.visible`、`layoutStore.podcastMode`
- **约束**：整句学习页、跟读面板、播客模式三者互斥；快捷键层还依赖
  `learningVisible || practiceRecording` 决定是否禁用播放键。
- **现状**：互斥靠调用点手动 `hideLearning()` / `setVisible(false)` 配对，
  例如 `LearningModeButton`、`PracticeModeButton`、`PlayerShortcut` 各自处理。
- **建议**：抽一个 `playerViewMode = 'play' | 'learning' | 'practice' | 'podcast'`
  的单一字段 + `switchView()`，三个 store 只保留各自的面板内部状态。
  这是 UX 收益最大的一处：现在的「打开 A 忘了关 B」只能靠每个入口自觉。

### 5. 字幕滚动（`useSubtitleScroll`）

- **位置**：`src/fronted/features/player/hooks/useSubtitleScroll.ts`
- **隐式状态**：`ScrollState = 'NORMAL' | 'AUTO_SCROLLING' | 'USER_BROWSING' |
  'PAUSE_MEASUREMENT'`，转移由 `TIMING` 里的 5 个定时器驱动。
- **现状**：状态有类型、有注释，但没有集中转移函数；多个 `setTimeout` 回调各自
  重新读取 `get().scrollState` 再决定是否落状态。
- **建议**：保留现有实现，仅把「定时器 → 目标状态」的映射抽成常量表，
  让 5 个魔法时长与状态对应关系在一处可见。改动小、风险低。

### 6. 后台任务（`DpTaskState`）

- **位置**：`src/common/contracts/dp-task.ts`、`src/backend/services/DpTaskService.ts`
- **隐式状态**：`init → in_progress → done | failed | cancelled`，以及
  `cancelled` 也可从 `init` 直接到达（启动时 `recoverInterruptedTasks`）。
- **复核结论**：终态判定原本在**后端**（`DpTaskService`）和**前端**
  （`dpTaskStore`、`youtubeImportTaskUtil`）各写了一遍，但三处语义**完全一致**，
  当前不存在行为漂移，因此不是缺陷，只是重复。
- **已处理**：收敛到 `common/contracts/dp-task.ts` 的 `TERMINAL_DP_TASK_STATES` 与
  `isTerminalDpTaskState()`，三处改为引用同一份，并补了 4 个单测。
  这是纯 DX/AX 收益，零行为变化。
- **仍存在的风险**：新增终态（如 `expired`）时只需改 `TERMINAL_DP_TASK_STATES` 一处。

### 7. 启动门槛（`StartupGate`）

- **位置**：`src/fronted/app/App.tsx`
- **隐式状态**：`null（判定中）→ migration-failure | onboarding | main`
- **现状**：优先级已经写在类型注释里，`useEffect` 里用 `if (failure?.failed)` 提前返回
  表达。目前正确，但「迁移失败优先于引导」这条产品决策只存在于一行 `if`。
- **建议**：抽 `resolveStartupGate(failure, completedVersion)` 纯函数，
  已有测试 `src/__tests__/app.startup-gate.test.tsx` 可直接扩展成转移表断言。

### 8. 引导流程（`OnboardingView`）

- **位置**：`src/fronted/features/onboarding/OnboardingView.tsx:208`
- **隐式状态**：`screen = 'storage' | 'download' | 'manual' | 'done'`
- **现状**：`setScreen` 有 5 个调用点，前进/后退/跳过/手动下载四条路径。
  `finishing` 与 `downloadingBundle` 两个布尔又叠加在 `screen` 之上表达「正在收尾」。
- **建议**：与 #3 同法，抽 `nextScreen(screen, event)`；把 `finishing` 并入
  `screen = 'finishing'`，消除「screen=download 且 finishing=true」这种组合态。

### 9. 窗口尺寸模式（`WindowPortImpl`）

- **位置**：`src/backend/infrastructure/window/WindowPortImpl.ts`
- **隐式状态**：`WindowState = 'normal' | 'maximized' | 'minimized' | 'fullscreen' |
  'closed' | 'home' | 'player'`
- **现状**：`home` 是唯一异步收尾的状态，用 `homeResolveToken` 作废过期请求，
  再依据窗口管理器行为决定「锁死 / 让路」。这段判定写得很好，但它是**隐式的三态**：
  锁定中 / 已让路 / 已作废，只体现在两个 `if` 里。
- **建议**：把 `applyHomeWindowMode` 的三种结局显式返回
  （`locked | yielded-size | yielded-late-resize`），日志与测试都能直接断言。

### 10. 设置自动保存（`useAutoSaveSettingsForm`）

- **位置**：`src/fronted/features/settings/useAutoSaveSettingsForm.ts`
- **隐式状态**：`AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'`，
  叠加 `ready`、`saveInFlightRef`、`saveQueuedRef`、`baselineSnapshotRef` 四个内部标志。
- **现状**：串行提交 + 排队一轮 + 卸载时补提交，逻辑正确但难以在脑中模拟。
- **建议**：把「是否有脏数据 / 是否在飞 / 是否已排队」合并成一个显式
  `saveMachine = idle | dirty | saving | saving-dirty | error`。
  这是纯 DX 收益：状态从 4 个布尔收敛为 1 个枚举。

---

## P2：线性流程，记录即可

| # | 状态机 | 位置 | 状态 |
|---|---|---|---|
| 11 | 媒体错误 / 卡死自愈 | `PlayerEngine.tsx` | `recoveryCount` 计数上限 3，超出后停止自愈 |
| 12 | 播放器「瞬态计划」 | `playerStore.ts` `TransientPlan` | `loopDone / loopTotal / completed`，已注释清楚 |
| 13 | 整句分析流 | `chatStore.analysisStatus` | `idle → streaming → done / error`，用 `analysisMessageId` 丢弃迟到片段 |
| 14 | 聊天流 | `chatTransport.ts` `activeStreams` | `start → chunk* → finish / error / abort`，终态即摘除 |
| 15 | 模型下载 | `model-download-phase.ts` | `downloading → verifying → extracting → installing → idle` |
| 16 | 视频学习裁切 | `VideoLearningClipTaskQueue` + `VideoLearningClipStatus` | 队列 `pending → running → done`；状态 `analyzing → pending → in_progress → completed` |
| 17 | 迁移失败恢复 | `MigrationFailureGate.tsx` | `acting = 'retry' \| 'reset' \| null` + 确认弹窗 |
| 18 | 应用关停 | `src/main.ts:382` | `ShutdownPhase = idle → stopping → ready` |
| 19 | dev 播放入口 | `useDevPlayerEntry.ts` | `idle → resolving → ready / failed` |
| 20 | YouTube 导入 | `useYoutubeImportTasks.ts` | 多任务聚合：全部到终态后才统一决策跳转 |

---

## 改动原则

1. **先收敛不变量，再谈框架。** 本仓库的状态大多只需「一处写入 + 纯函数推导」，
   引入 XState 这类库会把成本抬到与收益不匹配的高度。
2. **不改变对外形状。** 上面 #1 的做法是范例：新增纯函数模块，store 字段与
   action 签名保持不变，UI 零改动。
3. **纯函数优先。** 状态转移写成 `(state, event) => state` 后，测试不再需要
   挂载 React 或模拟定时器，AX（agent 读改代码）的收益也最大。
4. **一次一个状态机。** 每个改动独立可回滚，避免与翻译/播放等热路径耦合。

## 复核记录（2026-11-10）

初版盘点后做了一轮对抗性复核，目标是剔除误判与加阳性。结论如下：

| 结论 | 处置 |
|---|---|
| `repeatCurrent({loop:true})` 绕过互斥 | **降级**：所有调用点都传 `loop:false`，当前不可达，属潜在隐患 |
| 面板卸载后 `practiceStore.recording` 卡死 | **确认为缺陷**（单测先红后绿），已修复 |
| 录音中切听写页签不停麦克风 | **确认为缺陷**，已修复 |
| 关闭面板后录音回放仍在出声 | **确认为缺陷**，已修复 |
| `isFinalState` 三处副本 | **降级**：语义一致、无漂移，属重复而非缺陷；已收敛 |
| 模态视图互斥（学习页/练习/播客） | 逐入口核对后未发现同时可见，**维持 P1**，暂不改 |

修复均带回归测试：

- `src/fronted/features/practice/__tests__/usePracticeRecorder.unmount.test.ts`（3 例）
- `src/common/contracts/__tests__/dp-task-terminal.test.ts`（4 例）
- `src/fronted/features/player/lib/__tests__/sentence-end-mode.test.ts`（9 例）

全量验证：`pnpm run test:base run` → 78 个文件、603 个用例（594 通过 / 9 跳过）；
`tsc --noEmit` 与 `eslint` 均无 error。

### 第二轮：测试有效性审计

第二轮的质疑是「fork 后代码大改，原测试可能已经失效」。用变异测试（故意改坏实现，
看测试是否变红）逐处验证，而不是只读测试代码。

**证实为失效测试（已修正）**

| 位置 | 问题 | 修正 |
|---|---|---|
| `settings/__tests__/store.test.ts`「配置文件权限收紧到 0600」 | 注释声称断言 `configFileMode`，实际只断言 `typeof storeGet === 'function'`。把 `0o600` 改成 `0o644`、甚至整段删掉，测试都通过——而这正是保护云端 API 密钥不被同机其他账号读取的那道防线 | 记录 Store 构造参数并逐项断言 `configFileMode === 0o600`；变异后测试转红 |
| `SubtitleTranslationScheduler` 死信路径 | `onBatchDeadLetter` 只被断言过「未被调用」，从未断言「被调用」。`MAX_REQUEUE_COUNT` 改成 99 后测试全绿，意味着「失败批次无限重试」不会被发现 | 新增用例：持续失败批次达到上限后进入死信、不再产生新批次；`2→99` 与 `2→0` 两种变异均转红 |

**证实为有效测试（无需改动）**

`sentence-grouping`（gap 阈值）、`pronunciationScoring`（`SUB_WEIGHT`）、
`TranscriptionEngineSelector`（默认引擎）、`ConcurrencyKernel`（上下文隔离）、
`SentencePracticeService`（6 个用例覆盖落库/隔离/非法入参）——变异后均按预期转红。

**跳过用例复核**：9 个跳过全部是条件跳过（`ffmpeg` 真实二进制、付费 AI 真实推理），
属合理设计，不是失效用例。

**我自己的修复也补了测试并做了回滚验证**

- `playerStore` 此前**完全没有测试**，句末模式互斥只有纯函数测试、没有接线测试。
  新增 6 个 store 级用例；把 `repeatCurrent` 改回 `set({ singleRepeat: true })` 后转红。
- 把 `PracticePanel` 的 `active` 条件改回 `true` 后，面板级测试转红。
- 回滚卸载复位与 `active` 开关后，hook 级测试 2 例转红。

### 第三轮：修复自身引入的回归

审计中发现**我上一轮的修复引入了一个新缺陷**，已修正并加测试：

`cancel()` 没有 `phase` 守卫。用户点击停止后评分仍在进行（`processing`），此时切到听写页签，
`cancel()` 会把 phase 打回 `idle`，用户能立刻再开一段录音，与仍在进行的评分并发，
结果会挂到错误的句子上。修正为仅在 `recording` 阶段生效；`processing` 阶段由
`handleRecordingDone` 自己收尾。

补充的两个边界用例：

- 评分中切走时 phase 必须保持 `processing`
- 评分中卸载组件时不抛错、`recording` 不泄漏

**最终验证**：`pnpm run test:base run` → 81 个文件、617 个用例（608 通过 / 9 跳过）；
`tsc --noEmit` 无错误；`eslint` 无 error。
