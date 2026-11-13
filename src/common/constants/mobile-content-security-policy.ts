/**
 * 手机页（局域网 Web 服务）的 Content-Security-Policy。
 *
 * 手机页只跟同源的后端接口打交道，不加载任何外部资源，因此可以收得很紧。
 * `style-src` 允许 unsafe-inline 是因为页面大量使用行内 style 属性。
 *
 * `script-src` 中的 sha256 对应 `src/mobile/index.html` 的首屏主题内联脚本
 * （防止浅色用户首帧闪深色）。修改该内联脚本必须同步更新哈希——
 * `mobile-content-security-policy.test.ts` 会对源文件重新计算并兜底校验。
 */
export const MOBILE_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'sha256-LeCQc9kiUm2ivPLx7zGnbe+zkyXMqG6TY21qGEnOic4='",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');
