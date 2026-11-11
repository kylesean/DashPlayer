import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateCheckResult } from '@/common/types/update-check';

// 日志基建依赖 electron app（AppStatePath → app.isPackaged），测试替换为空实现。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// 更新检查只在打包环境发生，测试固定为非开发模式以走进真实分支。
vi.mock('@/backend/utils/runtimeEnv', () => ({ isDevelopmentMode: () => false }));

/** 加载全新的 CheckUpdate 模块：其缓存状态挂在模块级，每个用例重置隔离。 */
const loadCheckUpdate = async () => {
    vi.resetModules();
    return await import('../CheckUpdate');
};

describe('CheckUpdate', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('仓库尚未发布稳定版（/latest 404）时按「无更新」处理而不是报错', async () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
        vi.stubGlobal('fetch', fetchMock);

        const { checkUpdate } = await loadCheckUpdate();
        const result = await checkUpdate('0.1.0');

        expect(result).toEqual({ status: 'ok', releases: [] });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('404 的「无更新」结果进入正常缓存，TTL 内不重复请求', async () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
        vi.stubGlobal('fetch', fetchMock);

        const { checkUpdate } = await loadCheckUpdate();
        const first: UpdateCheckResult = await checkUpdate('0.1.0');
        const second = await checkUpdate('0.1.0');

        expect(first).toEqual({ status: 'ok', releases: [] });
        expect(second).toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
