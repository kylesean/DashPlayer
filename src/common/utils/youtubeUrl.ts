/**
 * 允许导入的 YouTube 主机名白名单（精确匹配）。
 *
 * 必须精确匹配而非按后缀匹配：后缀匹配会误收 evil-youtube.com、notyoutube.com
 * 这类仿冒域名，进而把链接交给 yt-dlp 下载任意站点的内容。
 * www. 前缀在解析时统一剥除，因此 www.youtube.com 天然命中。
 */
const YOUTUBE_ALLOWED_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'youtu.be']);

/** 11 位视频 ID 的字符与长度约束。 */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * 从 YouTube URL 中提取视频 ID；支持 watch?v=、youtu.be/、shorts/、embed/、live/ 五种形态。
 *
 * 前后端共用同一套 host 与 ID 规则，避免前端放行、后端拒绝的口径分裂。
 *
 * @param url 用户粘贴的地址；允许省略 https://。
 * @returns 11 位视频 ID；无法识别时返回 null。
 */
export function parseYoutubeVideoId(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
        const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
        if (!YOUTUBE_ALLOWED_HOSTS.has(host)) return null;
        if (host === 'youtu.be') {
            const id = parsed.pathname.split('/').filter(Boolean)[0];
            return id && VIDEO_ID_PATTERN.test(id) ? id : null;
        }
        const vParam = parsed.searchParams.get('v');
        if (vParam && VIDEO_ID_PATTERN.test(vParam)) return vParam;
        const segments = parsed.pathname.split('/').filter(Boolean);
        const marker = segments.findIndex((s) => s === 'shorts' || s === 'embed' || s === 'live');
        const candidate = marker >= 0 ? segments[marker + 1] : undefined;
        return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
    } catch {
        return null;
    }
}
