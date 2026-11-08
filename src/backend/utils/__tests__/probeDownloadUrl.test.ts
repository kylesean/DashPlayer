import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeReachableDownloadUrl } from '@/backend/utils/probeDownloadUrl';

const OFFICIAL_URL = 'https://official.example.com/model.bin';
const MIRROR_URL = 'https://mirror.example.com/model.bin';

/** 将全局 fetch 打桩为按清单决定地址可达性，未列入清单的地址视为网络不可达。 */
function mockHeadReachability(reachableUrls: string[]): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (!reachableUrls.includes(url)) {
            throw new Error('connection refused');
        }
        return new Response(null, { status: 200, statusText: 'OK' });
    });
}

describe('下载地址可达性探测', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('官方与镜像都可达时返回官方地址（声明顺序优先）', async () => {
        mockHeadReachability([OFFICIAL_URL, MIRROR_URL]);

        const result = await probeReachableDownloadUrl([OFFICIAL_URL, MIRROR_URL], new AbortController().signal);

        expect(result).toBe(OFFICIAL_URL);
    });

    it('官方不可达时返回镜像地址', async () => {
        mockHeadReachability([MIRROR_URL]);

        const result = await probeReachableDownloadUrl([OFFICIAL_URL, MIRROR_URL], new AbortController().signal);

        expect(result).toBe(MIRROR_URL);
    });

    it('全部地址不可达时返回 null', async () => {
        mockHeadReachability([]);

        const result = await probeReachableDownloadUrl([OFFICIAL_URL, MIRROR_URL], new AbortController().signal);

        expect(result).toBeNull();
    });

    it('单个地址探测被取消时视为不可达并返回 null', async () => {
        // 模拟探测请求已发出但随后被取消：请求收到中止信号后以异常结束
        const controller = new AbortController();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            controller.abort();
            return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
        });

        const result = await probeReachableDownloadUrl([OFFICIAL_URL], controller.signal);

        expect(result).toBeNull();
    });
});
