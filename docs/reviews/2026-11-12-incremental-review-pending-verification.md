# 增量审查遗留：4 项「待验证」清单

> 来源：6762c074..HEAD 增量对抗审查（并行子代理分域审查产出 ~24 条，其中 6 P1 + 15 P2 已修复并分 6 个提交落地：f9012396 / f9532705 / 0fb2b3d4 / 5839e644 / 69f58471 / ef1aa374）。
> 本文件补记当时只在对话里交付、未落盘的「待验证」清单，含静态补查后的精确机制与运行时验证步骤。
> 状态更新：③ 已在 f9532705 修复；①② 的相邻面已被并行进程的 integration-verify 报告交叉覆盖（见文末「交叉参考」）。
>
> **处置结果（2026-11-12 第二轮，全部收口）**：① 已修复两层（store 门控收紧 + PlayerEngine 切源作废旧契约）并补 3 条回归测试；② 落定 4 条 store 级回归测试，playRequestId 归零与 sentenceLoop 剩余遍数语义保持开放；③ 维持已修复结论；④ 修复已随并行进程的 da10ba0d 落地（判重加入 fileHash），并补 2 条跨视频回归测试。真机清单只剩「1500ms 在慢介质上是否真会被超过」一项观察，其余可从清单划掉。详见文末「处置结果」。

## ① seek 结算兜底 1500ms 的时长适性

- **位置**：`src/fronted/features/player/components/PlayerEngine.tsx:26`（`SEEK_RESOLVE_TIMEOUT_MS = 1500`）、`:253-262`（兜底计时器登记）、`settleSeek`（`:152-162`，以结算时刻的 `video.currentTime` 兜底）。
- **机制**：正常路径由原生 `seeked` 事件结算 seek 契约；目标时间与当前位置相同时浏览器不派发 `seeked`，靠 1500ms 兜底收尾。风险场景：慢介质（大文件冷读、HDD、网络流）上真实 seek 超过 1.5s，兜底先触发，`resolveSeek(actualTime, requestId)` 以**seek 前的旧位置**结算——`seekInFlight` 被解除，时间驱动恢复裁决，`exactPlayTime` 短暂错误，字幕高亮/句末判定可能用错位置一次。
- **相邻面（并行审查补充）**：该兜底计时器在 `src` 切换时未显式清理；极端情况下（切视频前 1.5s 内有 seek）可能以**新视频**的 `currentTime` 结算一次旧请求。影响仅为一次 `exactPlayTime` 抖动，`loadSubtitles` 会重置 `seekInFlight`。
- **验证环境**：`pnpm dev` 真机播放大体积视频（或网络流），跨远距离拖动进度条并观察 DevTools 里 `video.seeking` 持续时长是否逼近/超过 1.5s。
- **建议处置**：先加单测（fake timers + mock video element：seeked 永不派发 → 兜底以 currentTime 结算；src 切换 → pending 计时器清理），把行为固化后再决定是否需要把兜底改为「seeking 状态优先」而非纯时长。

## ② setSource 切源的状态残留

- **位置**：`src/fronted/features/player/playerStore.ts:1158`（`setSource`）。
- **机制**：`setSource` 已清理 `currentLockTimer`、影子跟读计时器、瞬态计划、internal 全量（currentLock/tailPreview/timeOverride/seekInFlight 等）。残留风险集中在两处：
  1. `playRequestId: 0` 归零——旧源的 `video.play()` promise 仍在途时归零，新一轮 play 再次从 1 起号，旧请求可能与新请求同号；播放意图由元素级 effect 按 id 守卫，切源后元素本身重建，实际影响需运行时确认。
  2. 训练模式计数残留——`sentenceLoop`（剩余遍数/倍率）不在 `setSource` 清理范围内；换视频后若单句循环仍开着，第一句会带着旧视频剩下的遍数开循环。
- **验证环境**：`pnpm dev`，播放视频 A（开启单句循环、播到中途）→ 直接切换到视频 B → 观察 B 的第一句是否按剩余遍数循环、高亮/播放意图是否正确。
- **建议处置**：`sentenceLoop` 剩余计数是否随换源重置属产品语义（用户可能有意保留），需先与维护者确认意图再改；`playRequestId` 归零可改为不复位（自增取模或保持单调），避免同号复用。

## ③ LocalEmbeddingRuntime shutdown/start 复活竞态 —— ✅ 已修复

- **位置**：`src/backend/infrastructure/ai/LocalEmbeddingRuntime.ts`（`generation` 计数器：`:62`、`:430`、`:474`、`:541`、`:557`），修复落在提交 f9532705。
- **机制**：shutdown 后迟到的一次 start（旧一代异步链）会因 generation 不匹配被中止，子进程不会「复活」；shutdown 现在等待 `childExit` + 3s SIGKILL 兜底。
- **剩余验证（可选冒烟）**：真机 `pnpm dev` 触发 embedding 启用后立即退出应用，`pgrep -f llama-server` 确认无残留进程；或快速 start→shutdown→start 观察 generation 日志递增、旧链无 spawn。

## ④ useLearningRouteSync 跨视频会话错配

- **位置**：`src/fronted/features/player/hooks/useLearningRouteSync.ts:75-81`（`learningVisible` 已为真时深链进入另一视频的 `/learn` 会提前 return，不发起 `createFromCurrent`）；`src/fronted/features/chat/chatStore.ts:195-198`（`isSameLiveTopic` 仅比对 `topicKey + anchorIndex`，**不含 fileHash/videoId**）。
- **机制**：两个场景会把 A 视频的会话错配给 B 视频：
  1. 学习页可见时，通过深链/前进导航到另一视频的 `/learn`——地址→视图 effect 早退，会话仍是 A 的句子；
  2. 两部视频的同一 index 存在相同字幕文本（剧集共用 SRT、短句极常见）——`createFromCurrent` 走 `isSameLiveTopic` 命中旧会话直接 reopen。
- **验证环境**：`pnpm dev`，进入视频 A 的 `/learn` 后地址栏改到/前进到视频 B 的 `/learn`，观察会话归属；再取两部含相同字幕行的视频，分别对同一行进学习页。
- **建议处置**：`isSameLiveTopic` 把 `currentSentence.fileHash` 一并纳入比对（一行改动 + 既有回归测试补一条跨视频用例）；场景 1 在地址→视图 effect 里对「videoId 变化 + learningVisible」补一次 `createFromCurrent` 或强制退出学习页。

## 手动验证清单（约 10 分钟，pnpm dev 真机）

1. 大视频跨远距离 seek，确认无高亮错位抖动（①）。
2. A 视频开单句循环播到中途切到 B 视频，确认循环遍数与高亮表现（②）。
3. 启用 embedding 后立即退出，`pgrep -f llama-server` 无残留（③，可选）。
4. A 的 /learn 深链跳 B 的 /learn；两部视频相同字幕行分别进学习页，确认会话归属（④）。

## 交叉参考

并行进程的分域审查报告在 `2026-11-12/<domain>/outputs/report.md`（未跟踪工作区）。其中 `integration-verify/outputs/report.md` 第 85-88 行已静态验证相邻面：`useLearningRouteSync` 进入/退出/前进后退闭环无死循环、`createFromCurrent` 失败回退正常；并独立记录了 ① 的「1.5s 兜底计时器未随 src 清理」观察（与本文件 ① 相邻面一致）。

## 处置结果（2026-11-12 第二轮）

静态裁决 + 单测模拟完成后，四项全部收口；灵敏度验证（把修复翻回旧实现 → 对应用例变红）逐项确认过：

| 项 | 处置 | 回归测试 |
|----|------|----------|
| ① | 两层修复：`playerStore.resolveSeek` 门控收紧——无在途契约（setSource 已清空 seekTime）时拒绝一切带序号的迟到结算；`PlayerEngine` 切源 effect 显式清空 `pendingResolveRef` 兜底计时器，旧契约随源作废 | `PlayerEngine.test.tsx` 3 条：1500ms 兜底以元素时间结算、seeked 先到提前结算且兜底不重写、切源后旧落点绝不写进新源 |
| ② | 换源契约落定为 store 级回归（清空在途契约/瞬态计划、拒绝迟到结算、无序号结算通道保留、新一轮结算不受影响）；`playRequestId` 归零复用与 `sentenceLoop` 剩余遍数两项属产品语义，保持开放待维护者定夺 | `playerStore.set-source.test.ts` 4 条 |
| ③ | 维持已修复结论（f9532705 generation 计数器），真机冒烟可选项 | — |
| ④ | 判重加入 `anchorFileHash`（接口字段 + `empty()` 初始化 + 乐观入口/建会话两处写入 + 两处调用点）；修复由并行进程在 da10ba0d 收尾提交（其提交信息注明补全了外部改动缺的 empty() 初始化） | `chatStore.isSameLiveTopic.test.ts` 2 条：同视频同句沿用会话不重建、跨视频同文本同索引关闭旧会话并重建 |

全量 1211 测试绿 + `tsc --noEmit` 干净。真机清单仅剩一项观察：慢介质（大文件冷读/HDD/网络流）上真实 seek 是否真的超过 1500ms——若出现，下一步是「seeking 状态优先」的兜底改造（以 `video.seeking` 为准而非纯时长），但当前证据不足以支撑这个改动。
