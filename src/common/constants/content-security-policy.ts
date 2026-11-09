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
 * - `object-src 'none'`、`base-uri 'none'`、`form-action 'none'`、
 *   `frame-ancestors 'none'`：应用不需要这些能力，直接关掉。
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
    "frame-ancestors 'none'",
].join('; ');
