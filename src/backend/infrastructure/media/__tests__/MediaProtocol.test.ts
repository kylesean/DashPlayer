import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => path.join(os.tmpdir(), 'dp-media-protocol-test-userdata'),
        getVersion: () => '1.0.0',
    },
    protocol: {
        handle: vi.fn(),
    },
}));

import { createMediaRequestHandler } from '@/backend/infrastructure/media/MediaProtocol';
import MediaPathRegistry from '@/backend/services/MediaPathRegistry';

const FILE_CONTENT = '0123456789';

let tempRoot = '';
let mediaFilePath = '';

/**
 * 构造指向指定文件的协议请求。
 * @param filePath 目标文件绝对路径。
 * @param init 请求初始化参数。
 * @returns 协议请求对象。
 */
const buildRequest = (filePath: string | null, init: RequestInit = {}): Request => {
    const url = filePath === null
        ? 'media://local/media'
        : `media://local/media?p=${encodeURIComponent(filePath)}`;
    return new Request(url, init);
};

/**
 * 读取响应体字节。
 * @param response 响应对象。
 * @returns 响应体字节数组。
 */
const readBody = async (response: Response): Promise<Uint8Array> => {
    return new Uint8Array(await response.arrayBuffer());
};

beforeAll(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-media-'));
    mediaFilePath = path.join(tempRoot, 'clip.mp4');
    fs.writeFileSync(mediaFilePath, FILE_CONTENT, 'utf8');
});

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('media:// 协议处理器', () => {
    describe('请求校验', () => {
        it('缺少 p 参数时返回 400', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(null));

            expect(response.status).toBe(400);
        });

        it('路径不在允许的根目录内时返回 403', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });
            const outsidePath = path.join(os.tmpdir(), 'dp-media-outside.txt');

            const response = await handler(buildRequest(outsidePath));

            expect(response.status).toBe(403);
        });

        it('登记表里登记过的路径可以放行，即使它在媒体库根目录之外', async () => {
            // 用户的视频留在原地、不复制进媒体库，只认根目录就会读不出来；
            // 但登记过的路径是后端亲手交给渲染层的，可以放行。
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-media-outside-'));
            const outsideFile = path.join(outsideDir, 'picked-by-user.mp4');
            fs.writeFileSync(outsideFile, 'user media');
            const registry = new MediaPathRegistry();
            registry.allowFile(outsideFile);

            try {
                const handler = createMediaRequestHandler({
                    resolveAllowedRoots: async () => [tempRoot],
                    pathRegistry: registry,
                });

                const response = await handler(buildRequest(outsideFile));

                expect(response.status).toBe(200);
                await expect(response.text()).resolves.toContain('user media');
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });

        it('登记表里登记过的文件被换成指向外部的软链接后仍然拒绝', async () => {
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-media-outside-'));
            const secret = path.join(outsideDir, 'secret.txt');
            fs.writeFileSync(secret, 'top secret');
            const target = path.join(tempRoot, 'swapped.mp4');
            fs.writeFileSync(target, 'original');
            const registry = new MediaPathRegistry();
            registry.allowFile(target);
            // 登记之后文件被换成指向别处的软链接。
            fs.rmSync(target);
            fs.symlinkSync(secret, target);

            try {
                const handler = createMediaRequestHandler({
                    resolveAllowedRoots: async () => [tempRoot],
                    pathRegistry: registry,
                });

                const response = await handler(buildRequest(target));

                expect(response.status).toBe(403);
                await expect(response.text()).resolves.not.toContain('top secret');
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });

        it('根目录无法解析时拒绝请求而不是放行全部', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [] });

            const response = await handler(buildRequest(mediaFilePath));

            expect(response.status).toBe(403);
        });

        it('授权目录内的软链接指向外部时同样被拒绝', async () => {
            // 软链接的**字面**路径在授权目录内，但真实目标在目录外。
            // 只按字面路径判定会把它当成合法文件读出去。
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-media-outside-'));
            const outsideFile = path.join(outsideDir, 'secret.txt');
            fs.writeFileSync(outsideFile, 'top secret');
            const linkPath = path.join(tempRoot, 'escape-link.txt');
            fs.symlinkSync(outsideFile, linkPath);

            try {
                const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

                const response = await handler(buildRequest(linkPath));

                expect(response.status).toBe(403);
                await expect(response.text()).resolves.not.toContain('top secret');
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });

        it('与根目录仅共享字符串前缀的路径同样被拒绝', async () => {
            // /tmp/dp-media-xxx 与 /tmp/dp-media-xxx-sibling 互不包含，
            // 字符串前缀比较会把后者误判成命中，必须用 path.relative 判定。
            const prefixRoot = path.join(tempRoot, 'lib');
            const siblingRoot = path.join(tempRoot, 'library2');
            fs.mkdirSync(prefixRoot, { recursive: true });
            fs.mkdirSync(siblingRoot, { recursive: true });
            const siblingFile = path.join(siblingRoot, 'x.txt');
            fs.writeFileSync(siblingFile, 'nope', 'utf8');

            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [prefixRoot] });

            const response = await handler(buildRequest(siblingFile));

            expect(response.status).toBe(403);
            fs.rmSync(prefixRoot, { recursive: true, force: true });
            fs.rmSync(siblingRoot, { recursive: true, force: true });
        });

        it('文件不存在时返回 404', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(path.join(tempRoot, 'missing.mp4')));

            expect(response.status).toBe(404);
        });
    });

    describe('完整响应', () => {
        it('普通 GET 返回 200 与正确的 Content-Type 和文件内容', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(mediaFilePath));

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('video/mp4');
            expect(response.headers.get('accept-ranges')).toBe('bytes');
            expect(response.headers.get('cache-control')).toBe('no-cache');
            expect(response.headers.get('content-length')).toBe(String(FILE_CONTENT.length));
            expect(await response.text()).toBe(FILE_CONTENT);
        });

        it('未知扩展名回落到 application/octet-stream', async () => {
            const unknownFile = path.join(tempRoot, 'data.unknown-ext');
            fs.writeFileSync(unknownFile, 'x', 'utf8');
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(unknownFile));

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('application/octet-stream');
            fs.rmSync(unknownFile, { force: true });
        });

        it('HEAD 请求只返回响应头不带响应体', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(mediaFilePath, { method: 'HEAD' }));

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe('video/mp4');
            expect(response.headers.get('content-length')).toBe(String(FILE_CONTENT.length));
            expect(await response.text()).toBe('');
        });
    });

    describe('Range 请求', () => {
        it('bytes=0-3 返回 206 与 4 个字节', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(mediaFilePath, { headers: { Range: 'bytes=0-3' } }));

            expect(response.status).toBe(206);
            expect(response.headers.get('content-range')).toBe(`bytes 0-3/${FILE_CONTENT.length}`);
            expect(response.headers.get('content-length')).toBe('4');
            expect(response.headers.get('accept-ranges')).toBe('bytes');
            const body = await readBody(response);
            expect(body.length).toBe(4);
            expect(Buffer.from(body).toString('utf8')).toBe('0123');
        });

        it('bytes=2- 开放结尾返回从第 2 字节到文件末尾', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(mediaFilePath, { headers: { Range: 'bytes=2-' } }));

            expect(response.status).toBe(206);
            expect(response.headers.get('content-range')).toBe(`bytes 2-${FILE_CONTENT.length - 1}/${FILE_CONTENT.length}`);
            expect(response.headers.get('content-length')).toBe(String(FILE_CONTENT.length - 2));
            const body = await readBody(response);
            expect(body.length).toBe(FILE_CONTENT.length - 2);
            expect(Buffer.from(body).toString('utf8')).toBe('23456789');
        });

        it('请求范围超过文件大小时把结尾收敛到 size - 1', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(mediaFilePath, { headers: { Range: 'bytes=0-999' } }));

            expect(response.status).toBe(206);
            expect(response.headers.get('content-range')).toBe(`bytes 0-${FILE_CONTENT.length - 1}/${FILE_CONTENT.length}`);
            expect(response.headers.get('content-length')).toBe(String(FILE_CONTENT.length));
        });

        it('起点越界时返回 416', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(mediaFilePath, { headers: { Range: 'bytes=999-1000' } }));

            expect(response.status).toBe(416);
            expect(response.headers.get('content-range')).toBe(`bytes */${FILE_CONTENT.length}`);
        });

        it('Range 语法非法时忽略范围并返回完整文件', async () => {
            const handler = createMediaRequestHandler({ resolveAllowedRoots: async () => [tempRoot] });

            const response = await handler(buildRequest(mediaFilePath, { headers: { Range: 'bytes=abc' } }));

            expect(response.status).toBe(200);
            expect(await response.text()).toBe(FILE_CONTENT);
        });
    });
});
