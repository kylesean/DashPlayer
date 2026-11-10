# 打包产物冒烟

用例文件：`qa/specs/packaged/packaged-smoke.spec.ts`

源构建 e2e 跑的是 `electron .` + `.vite`，覆盖不到 ASAR、fuses、`extraResource`、
原生模块 unpack 与 `process.resourcesPath`。本文件只在 nightly / 手工执行的真实打包产物上跑。

## 场景

- 用例：**[SET-PKG-01]** 打包应用在 `NODE_ENV=development` 下仍按生产态启动，且 ASAR、原生数据库与设置页可用
