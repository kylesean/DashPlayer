import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import MobileWebServer from '@/backend/infrastructure/mobile/MobileWebServer';
import type { MobileWebDataSource } from '@/backend/infrastructure/mobile/MobileWebServer';

// 日志模块是系统边界：测试里静音，避免真实落盘和对 Electron app 的依赖。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

/** 测试用访问令牌。 */
const TEST_TOKEN = 'test-token-abcdefghijklmnopqrstuvwxyz012345';

/**
 * 构造一个只会回固定数据的最小数据源；本组用例只关心鉴权行为。
 */
const createSource = (): MobileWebDataSource => ({
    listRecent: async () => [],
    getWatchDetail: async () => ({ id: 'x' }) as never,
    resolveVideoFile: async () => '',
    getThumbnail: async () => '',
    saveProgress: async () => undefined,
    lookupWord: async () => null,
    translateTexts: async (texts) => texts,
});

describe('MobileWebServer 访问令牌鉴权', () => {
    let staticDirectory: string;
    let server: MobileWebServer | null = null;
    let baseUrl: string = '';

    beforeEach(async () => {
        staticDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-mobile-web-test-'));
        fs.writeFileSync(path.join(staticDirectory, 'index.html'), '<!doctype html><title>ok</title>');
        server = new MobileWebServer({
            staticDirectory,
            source: createSource(),
            token: TEST_TOKEN,
        });
        // 监听 0 号端口由系统分配空闲端口，避免测试之间抢占固定端口。
        await server.start(0);
        const port = server.boundPort();
        expect(port).not.toBeNull();
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        await server?.stop();
        server = null;
        fs.rmSync(staticDirectory, { recursive: true, force: true });
    });

    it('没有令牌时拒绝静态资源与接口', async () => {
        const page = await fetch(`${baseUrl}/`);
        expect(page.status).toBe(401);

        const api = await fetch(`${baseUrl}/api/recent`);
        expect(api.status).toBe(401);
        await expect(api.json()).resolves.toMatchObject({
            error: expect.stringContaining('访问令牌'),
        });
    });

    it('令牌错误时拒绝访问', async () => {
        const response = await fetch(`${baseUrl}/api/recent?t=wrong-token`);
        expect(response.status).toBe(401);
    });

    it('查询参数携带令牌可以访问，并在响应里下发 Cookie', async () => {
        const response = await fetch(`${baseUrl}/api/recent?t=${TEST_TOKEN}`);
        expect(response.status).toBe(200);
        const setCookie = response.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('dp_mobile_token=');
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('SameSite=Strict');
    });

    it('请求头携带令牌可以访问', async () => {
        const response = await fetch(`${baseUrl}/api/recent`, {
            headers: { 'X-DashPlayer-Token': TEST_TOKEN },
        });
        expect(response.status).toBe(200);
    });

    it('Cookie 里的令牌可以访问后续请求', async () => {
        const response = await fetch(`${baseUrl}/api/recent`, {
            headers: { Cookie: `dp_mobile_token=${TEST_TOKEN}` },
        });
        expect(response.status).toBe(200);
    });

    it('浏览器直接打开时返回可读的 HTML 提示页而不是 JSON', async () => {
        const response = await fetch(`${baseUrl}/`, {
            headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        expect(response.status).toBe(401);
        expect(response.headers.get('content-type')).toContain('text/html');
        await expect(response.text()).resolves.toContain('访问令牌');
    });

    it('重新生成令牌后旧令牌立即失效', async () => {
        server?.setToken('a-brand-new-token-value-000000000');

        const old = await fetch(`${baseUrl}/api/recent?t=${TEST_TOKEN}`);
        expect(old.status).toBe(401);

        const fresh = await fetch(`${baseUrl}/api/recent?t=a-brand-new-token-value-000000000`);
        expect(fresh.status).toBe(200);
    });
});

describe('手机页的浏览器访问链路', () => {
    let server: MobileWebServer | null = null;
    let baseUrl = '';

    beforeEach(async () => {
        // 用真实的手机页产物做静态目录：这条链路要验证的正是「页面能起来」。
        const staticDirectory = path.resolve(__dirname, '../../../../../resources/mobile');
        if (!fs.existsSync(path.join(staticDirectory, 'index.html'))) {
            throw new Error(`手机页产物缺失：${staticDirectory}`);
        }
        server = new MobileWebServer({
            staticDirectory,
            source: createSource(),
            token: TEST_TOKEN,
        });
        await server.start(0);
        baseUrl = `http://127.0.0.1:${server.boundPort()}`;
    });

    afterEach(async () => {
        await server?.stop();
        server = null;
    });

    it('带令牌打开页面会下发 Cookie，之后去令牌也能靠 Cookie 继续访问', async () => {
        // 1) 用户在手机浏览器里打开设置页展示的地址（带 ?t=）。
        const page = await fetch(`${baseUrl}/?t=${TEST_TOKEN}`, {
            headers: { Accept: 'text/html' },
        });
        expect(page.status).toBe(200);
        await expect(page.text()).resolves.toContain('id="root"');

        const setCookie = page.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('dp_mobile_token=');
        const cookie = setCookie.split(';')[0];
        expect(cookie).toContain(TEST_TOKEN);

        // 2) 前端把地址栏里的令牌抹掉后，刷新仍然可用（靠 Cookie）。
        const afterStrip = await fetch(`${baseUrl}/`, {
            headers: { Accept: 'text/html', Cookie: cookie },
        });
        expect(afterStrip.status).toBe(200);

        // 3) 静态资源与接口也靠 Cookie 走通。
        const asset = await fetch(`${baseUrl}/favicon-32.png`, { headers: { Cookie: cookie } });
        expect(asset.status).toBe(200);

        const api = await fetch(`${baseUrl}/api/recent`, { headers: { Cookie: cookie } });
        expect(api.status).toBe(200);
    });

    it('伪造的 Cookie 不会被当成有效令牌', async () => {
        const response = await fetch(`${baseUrl}/api/recent`, {
            headers: { Cookie: 'dp_mobile_token=forged-token' },
        });
        expect(response.status).toBe(401);
    });

    it('页面响应带 CSP 与防嵌套头', async () => {
        const response = await fetch(`${baseUrl}/?t=${TEST_TOKEN}`, {
            headers: { Accept: 'text/html' },
        });
        expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
        expect(response.headers.get('x-frame-options')).toBe('DENY');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });
});
