# 测试辅助目录

本目录存放测试基建。单测侧的分层与 mock 边界见下方各文件说明（服务层测试统一用 `createMemoryDb()`，禁止 mock 仓储）；与 E2E 共通的测试原则见 `qa/README.md` 第 6 节「红线」。

- `setup.ts`：vitest 全局 setup（DOM globals、Electron API mock 等），由 `vitest.config.ts` 的 `setupFiles` 加载。
- `database.ts`：`createMemoryDb()` 内存 SQLite 工厂，跑完全部 drizzle 迁移，服务层测试的统一数据层方案，禁止在服务测试中 mock 仓储。
- `aiSdkTestConfig.ts`：AI SDK 集成测试的环境变量门控配置，默认跳过 live 测试。

运行方式见项目根 `package.json` scripts（`yarn test:run` / `yarn test:watch` / `yarn test:coverage`）。
