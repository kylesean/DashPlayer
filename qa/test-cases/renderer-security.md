# 渲染层安全策略

用例文件：`qa/specs/app/renderer-security.spec.ts`（本范围所有自动化用例都在这里）

规范与状态含义见 [README.md](./README.md)。

## 为什么单独成页

这条策略只在构建产物里存在：注入插件是 `apply: 'build'`，开发态完全不注入。
所以「策略还在不在、内容有没有和源码漂移」只能在 e2e 里观察。它不是某个设置页的场景，
而是应用外壳的机制性约束，因此单独成页。

- 该看到：`<meta http-equiv="Content-Security-Policy">` 存在；其 `content` 与
  `DESKTOP_CONTENT_SECURITY_POLICY` 逐字一致；不含 `frame-ancestors` / `report-uri` / `sandbox`。
- 用例：**[SET-SEC-01]** 构建产物注入了桌面 CSP，且不含经 meta 投递会被忽略的指令

## 还没覆盖的场景

### 策略的实际拦截效果

- 现状：验证「内联脚本被拦下」需要主动制造一次违规，而任何探针都会往控制台写一条 CSP 报错，
  与 `qa/support/fixtures.ts` 的渲染层错误采集互相干扰——预期内的探针噪音会和真正的违规混成一类。
- 取舍：策略语法正确即由 Chromium 执行，属浏览器契约；这里只保证「我们注入了正确的策略」。
- 编号：**[SET-SEC-02]**（未覆盖）

### 开发态的策略

- 现状：开发态不注入（HMR 需要内联脚本与 websocket），因此开发时的行为不代表产物行为。
- 取舍：这是有意的 dev/prod 差异，不打算自动化；但排查「本地好好的、打包后报错」时要记得这一点。
- 编号：**[SET-SEC-03]**（手动）
