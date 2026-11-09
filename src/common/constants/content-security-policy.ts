/**
 * 桌面渲染进程的 Content-Security-Policy。
 *
 * 为什么需要它：渲染进程跑在 `file://` 页面上，preload 把 132 条 IPC 路由挂在
 * webContents 上。渲染层只要出现一次 XSS，就能直接调用这些路由——包括读出云端
 * API 凭据的 `settings/service-credentials/detail`。CSP 把「渲染层能加载什么、
 * 能连到哪里」钉死，是这层失守之后的最后一道闸。
 *
 * 各条目的来历（都对着实际用法核过）：
 * - `script-src 'self'`：打包产物只有外链的 `<script type="module">`，没有内联脚本。
 *   `file://` 页面下 `'self'` 按同目录匹配，已经在 Electron 45 上实测通过。
 * - `style-src 'self' 'unsafe-inline'`：framer-motion 与 Astryx 大量使用行内
 *   style 属性（约 20 处），行内 style 属性需要 `'unsafe-inline'`。
 * - `img-src 'self' data: blob:`：图表与占位图用 data: URL（约 55 处）。
 * - `font-src 'self' data:`：字体全部随包分发在本地 woff2。
 * - `media-src 'self' media: blob:`：本地媒体走自定义的 `media://` 协议。
 * - `connect-src 'self'`：渲染进程不直接发起任何网络请求，一律走 IPC。
 * - `object-src 'none'`、`base-uri 'none'`、`form-action 'none'`：应用不需要这些能力，直接关掉。
 *
 * 为什么**没有** `frame-ancestors 'none'`（别以为是漏了）：
 * 1. 这条策略是构建期注入 `<meta http-equiv>` 的（见 `vite.renderer.config.ts`），
 *    而按 CSP3 规范，经 meta 投递时 `frame-ancestors`、`report-uri`、`sandbox` 三条**一律被忽略**。
 *    写在这里不会生效，只会在每次加载往控制台丢一条错误。
 * 2. 它防的是「本页面被第三方页面用 iframe 嵌套」。桌面端页面来自 `file://`，
 *    没有任何远端页面能框套它；应用内「被嵌套」由 `webviewTag` 默认关闭
 *    与 `RendererSecurityGuard` 的 `will-navigate` / `setWindowOpenHandler` 管住。
 *
 * 也就是说它既无效、又无对应威胁模型。真要 header 投递（连带启用这三条），
 * 得把渲染页迁到自定义 scheme 并在 `protocol.handle` 返回的 Response 上设头，
 * 那是另一件事；在此之前，一条永远不会生效的安全指令比没有更糟——它会让 review 的人
 * 以为这一层已经有人管了。
 */
export const DESKTOP_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' media: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join('; ');

/**
 * 经 `<meta http-equiv>` 投递时会被规范忽略的指令（CSP3）。
 *
 * 单独导出是为了让单测与 e2e 都能引用同一份清单，而不是各自手抄：
 * 这份策略唯一的投递通道就是 meta，所以这些指令出现在这里必然是无效配置。
 */
export const META_IGNORED_CSP_DIRECTIVES = ['frame-ancestors', 'report-uri', 'sandbox'] as const;
