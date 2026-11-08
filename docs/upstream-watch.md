# 上游同步流水账

> 记录每次评估上游更新的处置结论。格式：日期 | 上游版本/提交 | 三分类结论 | 动作。
> 三分类：**吸收**（手工重放）/ **参考**（只看思路不搬码）/ **跳过**（不适用，多为已删模块）。

## 2026-11-09 | v6.18.0 ~ v6.19.1（33 commits，分叉后第一批）

| 上游改动 | 提交 | 结论 | 动作 |
|---|---|---|---|
| 移动端 Dock 悬浮风格重构 | ce9fa0f0 | 吸收（移动端跟随策略） | 整目录对齐 src/mobile/（5a085b75） |
| 移动端首页下拉刷新 + iOS 手感 | f987130b | 吸收（同上） | 同上 |
| 移动端暂停按钮动效移除 | 9aa1ee9a / e1aad216 | 吸收（同上） | 同上 |
| prismjs/linkify-it/uuid 安全公告清理 | 7c8a9488 | 部分吸收 | fork 的 prismjs/linkify-it 感染源已随死依赖清理；uuid 走 pnpm override（b2c113e3） |
| react-hooks 59 处修复 | 952f2f28 + d3b489b0 | 参考 | 分支镜像 origin/fix/react-hooks-lint-errors 已含等价补丁（patch-id 一致），待下次主分支整理时评估合入 |
| 依赖升级火车（TS 6.0.3 / react-router 7 / drizzle 0.45 / inversify 8 / i18next 26 / electron-store 12 / @ai-sdk provider 4.x） | 05ede590 等一列 | 参考 | 未吸收。pnpm 下需手工重放逐包验证；drizzle 升级需重新 generate 迁移并核对 diff。后续单独排期 |
| Linux RPM 修复（better-sqlite3 异架构预编译裁剪） | 0650461f | 参考 | fork 已删 onnxruntime/sharp，better-sqlite3 prebuilds 裁剪本就有；可借鉴其「缺预编译产物显式 throw」的 fail-fast |
| 移动端 react-hooks 相关（WatchPage/RecentPage 大改） | 952f2f28 内 | 吸收（移动端跟随策略） | 已随 src/mobile/ 整目录对齐带入 |
