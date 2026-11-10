import { expect } from '@playwright/test';
import { launchAppSession, test } from '../../support/fixtures';
import { CURRENT_ONBOARDING_VERSION } from '../../../src/common/constants/onboarding';
import { ONBOARDING_COMPLETED_VERSION_KEY } from '../../../src/common/constants/systemConfigKeys';

/**
 * 首次使用引导的真实 UI 链路。
 *
 * 其它用例由 fixture 通过 IPC 越过引导，保证设置页场景独立；这一条必须从
 * 引导页本身走完「选择位置 → 资源下载页 → 跳过 → 完成 → 进入主界面」，
 * 否则引导页的按钮、状态机与完成标记写入都没有端到端覆盖。
 */
test.describe('首次使用引导', () => {
    test('[SET-ONB-01] 从真实引导页完成跳过并进入主界面，重启后不再展示引导 @smoke', async ({ userDataDir }) => {
        let session = await launchAppSession(userDataDir, { skipOnboarding: false });
        try {
            const { page } = session;
            await expect(page.getByTestId('onboarding-view')).toBeVisible();
            await expect(page.getByRole('heading', { name: '选择保存位置' })).toBeVisible();

            await page.getByRole('button', { name: '下一步' }).click();
            await expect(page.getByRole('heading', { name: '下载运行所需资源' })).toBeVisible();

            await page.getByRole('button', { name: '跳过' }).click();
            await expect(page.getByRole('heading', { name: '一切就绪！' })).toBeVisible({ timeout: 30_000 });

            await page.getByRole('button', { name: '开始使用' }).click();
            await expect(page.getByTestId('nav-settings')).toBeVisible();

            // 完成标记存在数据库，不在 config.dev.json；先通过应用自己的读取接口确认版本，
            // 再重启验证启动门，两层都覆盖但不依赖 SQLite 表结构。
            await expect.poll(() => page.evaluate(async (key) => {
                const handler = (window as unknown as {
                    electron: { call: (path: string, param: unknown) => Promise<unknown> };
                }).electron;
                return handler.call('system/config/get', key);
            }, ONBOARDING_COMPLETED_VERSION_KEY)).toBe(CURRENT_ONBOARDING_VERSION);

            // 重启后直接进入主界面，证明标记确实跨进程持久化，而不只是当前页面 state。
            await session.close();
            session = await launchAppSession(userDataDir, { skipOnboarding: false });
            await expect(session.page.getByTestId('nav-settings')).toBeVisible();
            await expect(session.page.getByTestId('onboarding-view')).toHaveCount(0);
        } finally {
            await session.close();
        }
    });
});
