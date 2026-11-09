import PathUtil from '@/common/utils/PathUtil';

/**
 * 本地媒体协议 scheme。
 *
 * 渲染端不再直接读取 `file://` 资源（`webSecurity` 打开后同源策略会拦截），
 * 统一通过主进程注册的 `media://` 协议读取媒体库里的媒体、字幕与图片文件。
 */
export const MEDIA_SCHEME = 'media';

/**
 * 本地媒体 URL 前缀。
 *
 * 绝对路径放在 `p` 查询参数里而不是 URL 路径段里：
 * 路径可以包含空格、`#`、`?`、中文等字符，`encodeURIComponent` 之后
 * 用 `new URL(...).searchParams.get('p')` 可以原样取回，任意绝对路径都能无损往返。
 */
export const MEDIA_URL_PREFIX = `${MEDIA_SCHEME}://local/media?p=`;

export default class UrlUtil {
    public static toUrl(...paths: string[]) {
        const url = PathUtil.join(...paths);
        if (!url) {
            return '';
        }
        if (/^https?:\/\//i.test(url)) {
            return url;
        }
        return UrlUtil.media(url);
    }

    /**
     * 把本地绝对路径转换成 `media://` 协议 URL。
     *
     * 行为说明：
     * - 已经是 `media://` 的 URL 原样返回，保证重复调用幂等；
     * - 历史数据里遗留的 `file://` 路径会被还原成本地绝对路径再转换，不再产出 `file://`；
     * - 其余路径按本地绝对路径处理。
     *
     * @param paths 待转换的路径片段。
     * @returns `media://local/media?p=<编码后的绝对路径>`；输入为空时返回空字符串。
     */
    public static media(...paths: string[]): string {
        const rawPath = PathUtil.join(...paths);
        if (!rawPath) {
            return '';
        }
        if (new RegExp(`^${MEDIA_SCHEME}://`, 'i').test(rawPath)) {
            return rawPath;
        }
        return `${MEDIA_URL_PREFIX}${encodeURIComponent(UrlUtil.toLocalPath(rawPath))}`;
    }

    /**
     * 把 `file://` 形式的路径还原成本地绝对路径。
     *
     * @param rawPath 原始路径。
     * @returns 本地绝对路径；非 `file://` 输入原样返回。
     */
    private static toLocalPath(rawPath: string): string {
        if (!/^file:\/\//i.test(rawPath)) {
            return rawPath;
        }
        const withoutScheme = rawPath.slice('file://'.length);
        const pathPart = withoutScheme.startsWith('/') ? withoutScheme : `/${withoutScheme}`;
        try {
            return decodeURIComponent(pathPart);
        } catch {
            // 历史数据里存在未编码的非法百分号序列，解码失败时按原样路径处理。
            return pathPart;
        }
    }

    public static joinWebUrl(...paths: string[]): string {
        // 移除空字符串
        const cleanPaths = paths.filter(path => path !== '');

        // 处理第一个部分（可能包含协议）
        let result = cleanPaths[0] || '';

        // 处理剩余部分
        for (let i = 1; i < cleanPaths.length; i++) {
            const segment = cleanPaths[i];

            if (result.endsWith('/')) {
                result += segment.startsWith('/') ? segment.slice(1) : segment;
            } else {
                result += segment.startsWith('/') ? segment : '/' + segment;
            }
        }

        // 处理协议后的双斜杠
        result = result.replace(/^(https?:)\/+/, '$1//');

        // 移除URL参数和锚点之前的多余斜杠
        result = result.replace(/\/+([?#])/, '$1');

        // 移除中间的多余斜杠
        result = result.replace(/([^:]\/)\/+/g, '$1');

        return result;
    }
}
