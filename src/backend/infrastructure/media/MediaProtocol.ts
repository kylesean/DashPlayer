import { protocol } from 'electron';
import fs, { type ReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getMainLogger, type MainLogger } from '@/backend/infrastructure/logger';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { MEDIA_SCHEME } from '@/common/utils/UrlUtil';
import type MediaPathRegistry from '@/backend/services/MediaPathRegistry';

const logger = getMainLogger('MediaProtocol');

/**
 * 本地媒体协议的 scheme 名称。
 */
export const MEDIA_PROTOCOL_SCHEME = MEDIA_SCHEME;

/**
 * 文件扩展名到 MIME 类型的映射表。
 */
const MIME_TYPES: Record<string, string> = {
    // 视频
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.ts': 'video/mp2t',
    // 音频
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    // 字幕
    '.srt': 'text/plain; charset=utf-8',
    '.vtt': 'text/vtt; charset=utf-8',
    '.ass': 'text/plain; charset=utf-8',
    '.ssa': 'text/plain; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    // 图片
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
};

/**
 * 未知扩展名使用的默认 MIME 类型。
 */
const DEFAULT_MIME_TYPE = 'application/octet-stream';

/**
 * 解析文件路径对应的 MIME 类型。
 *
 * @param filePath 文件路径。
 * @returns 对应的 MIME 类型；扩展名未知时返回 `application/octet-stream`。
 */
export function resolveContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    return MIME_TYPES[extension] ?? DEFAULT_MIME_TYPE;
}

/**
 * 判断目标路径是否位于指定根目录之内。
 *
 * 判定规则：
 * - 使用 `path.relative` 计算相对路径，而不是字符串前缀比较：
 *   `/data/library2` 以 `/data/library` 开头，但它并不在 `/data/library` 之内；
 * - 相对路径为空表示目标就是根目录本身，算作命中；
 * - 相对路径以 `..` 开头（越出根目录）或本身是绝对路径（跨盘符）都算越界。
 *
 * @param rootPath 根目录绝对路径。
 * @param targetPath 目标绝对路径。
 * @returns 是否位于根目录之内。
 */
export function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
    const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath));
    if (relativePath === '') {
        return true;
    }
    if (relativePath.startsWith('..')) {
        return false;
    }
    return !path.isAbsolute(relativePath);
}

/**
 * 解析请求头里的字节范围。
 *
 * 支持 `bytes=<start>-<end>`、开放结尾的 `bytes=<start>-` 与后缀形式 `bytes=-<length>`。
 * 多段范围（`bytes=0-1,5-6`）与非法格式一律按「无范围」处理，返回 null。
 *
 * @param rangeHeader 原始 Range 请求头。
 * @param fileSize 文件总字节数。
 * @returns 解析出的起止位置；无法解析或范围不可满足时返回 null。
 */
export function parseRangeHeader(rangeHeader: string | null, fileSize: number): { start: number; end: number } | null {
    if (!rangeHeader) {
        return null;
    }
    const matched = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!matched) {
        return null;
    }
    const rawStart = matched[1];
    const rawEnd = matched[2];
    if (rawStart === '' && rawEnd === '') {
        return null;
    }

    let start: number;
    let end: number;
    if (rawStart === '') {
        // 后缀范围：取文件末尾若干字节。
        const suffixLength = Number(rawEnd);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            return null;
        }
        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
    } else {
        start = Number(rawStart);
        end = rawEnd === '' ? fileSize - 1 : Number(rawEnd);
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        return null;
    }
    if (start >= fileSize) {
        // 起始位置已经越过文件末尾，范围不可满足。
        return null;
    }
    if (end > fileSize - 1) {
        // 请求范围超过文件大小时按文件末尾截断。
        end = fileSize - 1;
    }
    return { start, end };
}

/**
 * 媒体协议请求处理器的构造参数。
 */
export interface MediaRequestHandlerOptions {
    /**
     * 解析当前允许的媒体根目录列表。
     *
     * @returns 允许的根目录绝对路径列表；解析失败时返回空数组，处理器将拒绝所有请求。
     */
    resolveAllowedRoots: () => Promise<string[]>;
    /**
     * 已被后端交付给渲染进程的媒体路径登记表。
     *
     * 用户的视频留在原地、不复制进媒体库，所以合法路径不全在媒体库根目录内。
     * 登记表记的正是「后端确实给过渲染层」的路径，凭它放行既不误伤正常播放，
     * 又不会把 `media://` 变成任意文件读取器。
     */
    pathRegistry?: MediaPathRegistry;
    /** 可选日志器，默认使用主进程日志。 */
    logger?: MainLogger;
}

/**
 * 媒体协议请求处理器。
 */
export type MediaRequestHandler = (request: Request) => Promise<Response>;

/**
 * 构造媒体协议请求处理器。
 *
 * 处理逻辑与 Electron 无关，可以直接用 `Request` 对象驱动，方便单测覆盖
 * 授权判定、Range 解析与响应头这些关键分支。
 *
 * @param options 处理器配置。
 * @returns 媒体协议请求处理器。
 */
export function createMediaRequestHandler(options: MediaRequestHandlerOptions): MediaRequestHandler {
    const requestLogger = options.logger ?? logger;

    return async (request: Request): Promise<Response> => {
        try {
            return await handleMediaRequest(
                request,
                options.resolveAllowedRoots,
                requestLogger,
                options.pathRegistry,
            );
        } catch (error) {
            requestLogger.error('media protocol request failed', { error });
            // 不把堆栈透给渲染端，只返回一句简短说明。
            return new Response('Internal Server Error', { status: 500 });
        }
    };
}

/**
 * 处理一次媒体协议请求。
 *
 * @param request 协议请求。
 * @param resolveAllowedRoots 允许的根目录解析器。
 * @param requestLogger 日志器。
 * @returns 协议响应。
 */
async function handleMediaRequest(
    request: Request,
    resolveAllowedRoots: () => Promise<string[]>,
    requestLogger: MainLogger,
    pathRegistry?: MediaPathRegistry,
): Promise<Response> {
    const targetPath = readTargetPath(request);
    if (targetPath === null) {
        return new Response('Bad Request', { status: 400 });
    }

    const allowedRoots = await resolveAllowedRoots();
    if (allowedRoots.length === 0) {
        requestLogger.warn('media protocol denied: no allowed root resolved', { targetPath });
        return new Response('Forbidden', { status: 403 });
    }

    // 先按字面路径判定：范围外的路径一律 403，且不区分文件是否存在，
    // 不给探测者一个「这个路径存不存在」的口子。
    // 登记表里的路径是后端亲手交给渲染层的，同样放行。
    const isRegisteredLiteral = pathRegistry?.isAllowed(targetPath) === true;
    if (!allowedRoots.some((root) => isPathInsideRoot(root, targetPath)) && !isRegisteredLiteral) {
        requestLogger.warn('media protocol denied: path outside allowed roots', { targetPath, allowedRoots });
        return new Response('Forbidden', { status: 403 });
    }

    // 再按真实路径判定：授权范围内的软链接可能指向范围外，
    // 只看字面路径会让它被当成合法文件读出去。
    // 根目录同样解析成真实路径，否则 macOS 上 /tmp → /private/tmp 这类
    // 自身就是软链接的目录会误判成越界。
    let realTargetPath: string;
    try {
        realTargetPath = await fs.promises.realpath(targetPath);
    } catch {
        return new Response('Not Found', { status: 404 });
    }
    const realRoots = await Promise.all(allowedRoots.map(async (root) => {
        try {
            return await fs.promises.realpath(root);
        } catch {
            // 根目录还不存在（例如临时目录尚未创建），退回字面路径。
            return root;
        }
    }));
    // 真实路径也必须在范围内：范围里的软链接指向范围外时不能放行。
    // 登记过的路径按登记时的样子算数——登记时记下的既有字面路径也有真实路径，
    // 软链被换掉后真实路径会对不上，从而被拒。
    const isRegisteredReal = pathRegistry?.isAllowed(realTargetPath) === true;
    if (!realRoots.some((root) => isPathInsideRoot(root, realTargetPath)) && !isRegisteredReal) {
        requestLogger.warn('media protocol denied: symlink escapes allowed roots', {
            targetPath,
            realTargetPath,
            allowedRoots,
        });
        return new Response('Forbidden', { status: 403 });
    }

    let fileSize: number;
    try {
        const stats = await fs.promises.stat(realTargetPath);
        if (!stats.isFile()) {
            return new Response('Not Found', { status: 404 });
        }
        fileSize = stats.size;
    } catch {
        return new Response('Not Found', { status: 404 });
    }

    const rangeHeader = request.headers.get('range');
    const range = parseRangeHeader(rangeHeader, fileSize);
    if (range === null && rangeHeader && isRangeSyntaxValid(rangeHeader) && fileSize > 0) {
        // 请求了合法但无法满足的范围（起点越界、结尾早于起点等），按 HTTP 语义返回 416。
        requestLogger.warn('media protocol range not satisfiable', { targetPath, range: rangeHeader });
        return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
                'Content-Range': `bytes */${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache',
            },
        });
    }

    const isHeadRequest = request.method === 'HEAD';
    const headers: Record<string, string> = {
        'Content-Type': resolveContentType(targetPath),
        'Accept-Ranges': 'bytes',
        // 媒体文件在磁盘上随时可能被替换，交给渲染端与浏览器缓存都不合适。
        'Cache-Control': 'no-cache',
    };

    if (range === null) {
        headers['Content-Length'] = String(fileSize);
        if (isHeadRequest) {
            return new Response(null, { status: 200, headers });
        }
        return new Response(toWebStream(fs.createReadStream(realTargetPath)), { status: 200, headers });
    }

    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${fileSize}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    if (isHeadRequest) {
        return new Response(null, { status: 206, headers });
    }
    return new Response(toWebStream(fs.createReadStream(realTargetPath, { start: range.start, end: range.end })), {
        status: 206,
        headers,
    });
}

/**
 * 判断 Range 头是否是语法合法的字节范围请求。
 *
 * @param rangeHeader 原始 Range 请求头。
 * @returns 是否为合法的单段字节范围。
 */
function isRangeSyntaxValid(rangeHeader: string): boolean {
    return /^bytes=\d*-\d*$/.test(rangeHeader.trim());
}

/**
 * 从协议请求中解析目标文件路径。
 *
 * @param request 协议请求。
 * @returns 目标绝对路径；缺少 `p` 参数时返回 null。
 */
function readTargetPath(request: Request): string | null {
    let url: URL;
    try {
        url = new URL(request.url);
    } catch {
        return null;
    }
    const rawPath = url.searchParams.get('p');
    if (!rawPath) {
        return null;
    }
    // 归一化绝对路径，同时消掉 `..` 之类的相对片段，避免绕过目录归属判定。
    return path.resolve(rawPath);
}

/**
 * 把 Node 可读流转换成 Web 可读流。
 *
 * @param stream Node 可读流。
 * @returns Web 可读流。
 */
function toWebStream(stream: ReadStream): ReadableStream {
    // node:stream/web 的 ReadableStream 与 DOM 类型在结构上等价但类型不同，这里做一次显式转换。
    return Readable.toWeb(stream) as unknown as ReadableStream;
}

/**
 * 解析当前允许的媒体根目录列表。
 *
 * 媒体库根目录是合法内容的唯一主根：`videos`、`favorite_clips`、`practice`、
 * `temp`、`models` 等目标目录都是它的子目录。除主根之外还要单独授权本地
 * TTS 的输出目录，否则朗读功能会因为 403 直接失效。
 *
 * @param storageDirectoryProvider 存储目录提供器。
 * @returns 允许的根目录绝对路径列表。
 */
export async function resolveAllowedRoots(storageDirectoryProvider: StorageDirectoryProvider): Promise<string[]> {
    const roots: string[] = [];
    try {
        const libraryRoot = await storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.LIBRARY_ROOT);
        roots.push(path.resolve(libraryRoot));
    } catch (error) {
        // 存储目录还没配置好时不能让请求「默认放行」，只记日志并交给上层按 403 处理。
        logger.warn('media protocol: library root unavailable', { error });
    }
    return roots;
}

/**
 * 注册 `media://` 协议处理器。
 *
 * 必须在 app ready 之后调用：协议处理器依赖 Electron 的 protocol 模块。
 *
 * @param storageDirectoryProvider 存储目录提供器，用于解析允许访问的根目录。
 * @param pathRegistry 媒体路径登记表，记录后端已交付给渲染层的路径。
 */
export function registerMediaProtocol(
    storageDirectoryProvider: StorageDirectoryProvider,
    pathRegistry: MediaPathRegistry,
): void {
    const handler = createMediaRequestHandler({
        resolveAllowedRoots: () => resolveAllowedRoots(storageDirectoryProvider),
        pathRegistry,
    });
    protocol.handle(MEDIA_PROTOCOL_SCHEME, handler);
    logger.info('media protocol registered', { scheme: MEDIA_PROTOCOL_SCHEME });
}
