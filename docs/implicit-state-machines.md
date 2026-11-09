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

### 2. 字幕翻译调度会话（已收敛）

- **位置**：`src/backend/services/subtitle-translation/SubtitleTranslationScheduler.ts`
- **原隐式状态**：每个 `fileHash` 的会话内，`completedIndices` / `deadIndices` /
  `inFlightIndices` 三个集合共同表达「一个坐标现在处于什么阶段」，
  再叠加 `pendingJobs` / `runningJobs` 推导「待认领 → 执行中 → 完成 / 死信 / 被丢弃」。
- **真实风险（不是假想）**：三个集合是**同一件事的三个布尔位**，
  `in-flight` 的清理只写在 `.finally()` 一处。新增失败路径（例如以后要支持
  「部分取消」）时漏一次清理，坐标就永久停在在途，既不重试也不报错，
  表现为「这几句字幕永远没有译文」，且日志里看不出异常。
- **本次处理**：
  - 新增 `subtitle-translation-index-state.ts`：
    `SubtitleIndexState = 'queued' | 'in-flight' | 'completed' | 'dead'`，
    用 `Map<number, SubtitleIndexState>` 取代三集合交集推导（`queued` 不落表，
    避免为整份字幕预填空状态）。
  - `releaseInFlightIndices` 只回退仍处于 `in-flight` 的坐标。
    **注意这不是修原实现的 bug**：原来三个集合彼此独立，`inFlightIndices.delete()`
    不会碰到 `completedIndices` / `deadIndices`。合并成单表后，「删除在途」与
    「抹掉终态」变成了同一条写路径，因此必须显式加守卫；否则收尾会把同一批次里
    已标成 `completed` / `dead` 的坐标一起打回待调度，造成死信复活与重复翻译。
    这条守卫正是这次重构自身引入的风险，已用单测钉住。
  - 失败去向收敛为纯函数 `decideFailedBatchOutcome`，判定顺序显式写成
    「无重试坐标 > 离开窗口 > 重试耗尽 > 重新入队」。顺序本身是产品决策
    （离开窗口的批次即使重试耗尽也只记 `dropped`），现在有单测钉住。
  - `MAX_REQUEUE_COUNT` 保持导出，测试不再硬编码。
- **顺带修掉的一个真实契约缺陷**：`knownBatchStarts` 只按批次起点记忆「建过批次」。
  若同一会话内 `sentenceIndices` 变多（增量转录追加、或意群开关导致同 `fileHash`
  重切分），该区间里新出现的坐标会因起点已登记而被**永久跳过**。
  已用探针测试复现（首次 3 句、扩到 5 句时只翻译了前 3 句），
  修复为「坐标集合变化时清空 `knownBatchStarts`」，重建时已完成的坐标由状态表过滤，
  不会重复翻译。
  - **可达性如实标注**：本 fork 目前没有增量转录写入路径，重载字幕也会先释放会话，
    所以这是**契约健壮性缺陷**，不是当前线上的用户可见故障。
    但它是「静默少翻译」类问题，一旦接入增量字幕就会立刻变成真实故障，因此一并修掉。
- **测试**：`__tests__/subtitle-translation-index-state.test.ts`（5 例）
  + 调度器新增 2 例（坐标变多必须补建批次、坐标不变不得重复建批次）。
  变异验证：去掉 `releaseInFlightIndices` 的条件判断 → 状态表用例转红；
  删掉 `.finally()` 里的释放调用 → 调度器 2 例转红；
  去掉 `knownBatchStarts.clear()` → 新增用例转红。

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

### 4. 播放器「模态视图」互斥（已收敛，并修掉一处真实 UX 故障）

- **位置**：`chatStore.learningVisible`、`practiceStore.visible`、`layoutStore.podcastMode`
- **约束**：整句学习页、跟读面板、播客模式三者互斥；快捷键层还依赖
  `learningVisible || practiceRecording` 决定是否禁用播放键。
- **原现状**：互斥靠调用点手动 `hideLearning()` / `setVisible(false)` 配对，
  四个入口（`LearningModeButton`、`PracticeModeButton`、`PlayerShortcut`、
  `Subtitle.tsx` 点字幕跳转）各自处理，谁漏一次就叠两层。
- **已确认的真实缺陷（本轮修复）**：播客层是 `z-30` 全屏覆盖，学习页是 `z-20`，
  而学习快捷键**不受播客模式限制**。播客模式下按学习键会
  暂停播放 + 把 `learningVisible` 置真，但页面被播客层盖住——
  用户看到的是「播放莫名停了、界面没变」，且此时学习页确实在跑后台请求。
  `LearningModeButton` 与 `PracticeModeButton` 只收练习/学习，没人收播客，
  所以三个入口在播客下都会踩到。
- **本次处理**：
  - 新增 `src/fronted/features/player/lib/player-view-mode.ts`：
    `PlayerViewMode = 'play' | 'learning' | 'practice' | 'podcast'`，
    `viewModeFlags` 是唯一一份「打开某视图时另外两个必须是什么」的定义；
    `derivePlayerViewMode` 按覆盖层优先级（播客 > 练习 > 学习）退化非法组合；
    `resolveViewToggle` / `isViewToggleActive` 表达按钮语义。带 5 个单测。
  - 新增 `player-view-sync.ts`（只碰练习与播客，打断依赖环）与
    `player-view-controller.ts`（唯一写入点 `setPlayerViewMode` / `togglePlayerView`
    / `exitOverlayView`），带 8 个集成单测。
  - 四个入口全部改走统一入口；`chatStore` 进入学习页时也调用
    `beginOverlayView('learning')`，覆盖「建会话成功后才落状态」的那条路径。
  - **没有换掉三个字段**：UI 读取方式、store 对外形状、快捷键判定全部保持不变，
    只把写入收敛到一处。这是刻意的取舍——换字段会牵动十几个组件，
    收益（DX）却和收敛写入点一样。
- **同时避开一个我差点引入的回归**：音频文件的播客模式是唯一有画面的舞台。
  若「学习页 → 返回」直接落到 `play`，音频会看到没有画面的黑屏舞台。
  因此覆盖层进入时记录底层视图，`exitOverlayView()` 按记录值还原
  （播客 → 学习 → 返回仍是播客）。这一点有 3 个单测钉住，变异后转红。

### 5. 字幕滚动（`useSubtitleScroll`，已抽表）

- **位置**：`src/fronted/features/player/hooks/useSubtitleScroll.ts`
  + `src/fronted/features/player/lib/subtitle-scroll-timers.ts`
- **隐式状态**：`ScrollState = 'NORMAL' | 'AUTO_SCROLLING' | 'USER_BROWSING' |
  'PAUSE_MEASUREMENT'`，转移由 5 个 `setTimeout` 驱动。
- **原现状**：5 个时长是散落各处的魔法数字，只能靠读 `setTimeout` 旁边的注释
  才知道哪个数字对应哪个状态。状态机本身逻辑正确，**这不是缺陷**。
- **本次处理**：`SCROLL_TIMERS` 把「延时 → 目标状态 → 存在理由」放在一处，
  并新增 `RESTORE` 目标语义表达「测量冻结是暂停后放回，不是进入固定状态」。
  逻辑与时长数值完全不变，只改可读性（纯 DX/AX 收益）。
- **测试**：`lib/__tests__/subtitle-scroll-timers.test.ts`（5 例）钉住
  量级区间（50–1000ms）、目标语义，以及「归顶沉降必须长于切句防抖」
  这条容易被误改的时序约束。既有 16 例滚动行为测试全部保持通过。
  变异验证：把 `TOP_SETTLE` 改成 100ms → 时序约束用例转红。

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

### 7. 启动门槛（`StartupGate`，已收敛）

- **位置**：`src/fronted/app/App.tsx` + `src/fronted/app/lib/startup-gate.ts`
- **隐式状态**：`null（判定中）→ migration-failure | onboarding | main`
- **原现状**：优先级只写在类型注释里，`useEffect` 里用 `if (failure?.failed)`
  提前返回表达。「迁移失败优先于引导」这条产品决策只存在于一行 `if`，
  改动时没有任何断言能拦住顺序被调换。
- **本次处理**：抽 `resolveStartupGate(failure, completedVersion)` 纯函数，
  用泛型保留调用方完整的 `MigrationFailureDetail`（不复制后端契约字段）。
  `App.tsx` 只负责取数、取消与落状态。
- **测试**：`src/fronted/app/lib/__tests__/startup-gate.test.ts`（6 例）
  + 既有 `src/__tests__/app.startup-gate.test.tsx`（4 例，组件级）。
  覆盖：迁移失败压过引导与主界面、读取失败不拦截启动、
  **空串版本号等价于从未完成引导**（后端未写配置时的真实返回形态）。
  变异验证：把 `failure?.failed` 改成恒假 → 纯函数 2 例 + 组件 1 例同时转红。

### 8. 引导流程（`OnboardingView`，已收敛并修掉一处真实竞态）

- **位置**：`src/fronted/features/onboarding/OnboardingView.tsx`
  + `src/fronted/features/onboarding/lib/onboarding-screen.ts`
- **原隐式状态**：`screen = 'storage' | 'download' | 'manual' | 'done'`，
  再叠加 `finishing` 与 `downloadingBundle` 两个布尔表达「正在收尾 / 正在下载」。
- **已确认的真实缺陷（本轮修复）**：`finishing` 是叠加在 `download` 上的布尔值，
  收尾期间「返回」按钮只在 `downloadingBundle` 时禁用、「手动下载」入口完全没禁。
  用户点「跳过」开始收尾后，仍可点返回或手动下载跳到别的屏幕，
  而 `finishOnboarding()` 的 await 结束后会无条件 `setScreen('done')`——
  用户被从手动下载页**硬拽到完成页**，中间填的路径/选择全部白做。
  慢 IPC（本地引擎探测可达数秒）把这个窗口拉得很宽。
- **本次处理**：
  - `OnboardingScreen` 增加 `'finishing'` 成员，`finishing` 不再是独立布尔。
  - 转移表 `TRANSITIONS` 是唯一一份合法转移定义，`transitionOnboardingScreen`
    对非法事件返回 `null`，`dispatch` 直接忽略。收尾中只接受
    `FINISH_OK` / `FINISH_FAILED`，导航事件全部被拒。
  - 收尾期间保留下载页的视觉位置并给 `role="status"` 反馈，
    避免「点了没反应 → 重复点击」。
- **测试**：`lib/__tests__/onboarding-screen.test.ts`（8 例），
  覆盖主路径、手动下载旁支、收尾失败回退、完成页终态、非法事件矩阵、
  以及「收尾中拒绝一切导航」的回归断言。
  变异验证：给 `finishing` 加回 `BACK` / `OPEN_MANUAL` 两条边 → 回归用例转红。

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

### 第四轮：P0 调度器收敛（本轮）

把 #2 从「建议」落成实现，同时顺带查出一个静默少翻译的契约缺陷。

| 项目 | 结论 |
|---|---|
| 三集合反推同一状态 | **结构性风险**（非当前故障）：`in-flight` 清理只在一处，新增失败路径漏清理即静默少翻译 |
| `knownBatchStarts` 跳过新增坐标 | **确认为契约缺陷**：探针测试复现「3 句扩到 5 句只译前 3 句」；当前无增量转录写入路径，故非线上故障 |
| 失败去向判定顺序 | 原本散在 3 个 `if` 里，收敛为纯函数并加断言 |

验证：`pnpm run test:base run` → 82 个文件、624 个用例（615 通过 / 9 跳过）；
`tsc --noEmit` 无错误；`eslint` 无 error。三处变异均按预期转红。
