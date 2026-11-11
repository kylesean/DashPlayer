# 播放器词汇注释

用例文件：`qa/specs/player/vocabulary-annotation.spec.ts`（本页所有自动化用例都在这里）

规范与状态含义见 [README.md](./README.md)。

这一页只验证**跨进程链路**：后端词状态 → IPC 投影 → 主字幕注释。纯函数投影规则由
`src/fronted/features/player/__tests__/vocabularyAnnotations.test.ts` 覆盖，这里不重复。

夹具字幕第一句是「The player keeps your reading position steady while the layout changes.」，
其中 `steady` 同时存在于默认词表，适合作为「默认词表不应画线」的判别词。

## 新用户打开视频不出现默认词表下划线

默认词表以 `ignored` 播种，历史上却会被当成个人生词整片画线。这条用例守住回归。

- 该看到：新库打开夹具视频后，主字幕没有任何 `learning` 注释。
- 用例：**[SET-VOC-01]** 新用户不会因默认词表出现下划线

## 状态切换实时反映到主字幕

把 `steady` 从默认的 `ignored` 改为 `learning`，再改为 `known`。

- 该看到：`learning` 时主字幕出现实线下划线；改为 `known` 后注释消失。
- 用例：**[SET-VOC-02]** 状态切换实时反映到主字幕下划线
- 说明：两次状态变更都通过真实 `vocabulary/update-state` 写入，并刷新页面后断言，
  因此同时覆盖落库与重新投影，而不是只验证前端 store。
