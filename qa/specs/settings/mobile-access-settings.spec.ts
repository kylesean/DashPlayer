import { expect, type Page } from '@playwright/test';
import { readConfigValue, test } from '../../support/fixtures';
import { openSettingsSection } from '../../support/settings-page';

/**
 * 手机访问设置的用例。
 *
 * 这一页的产出是「一条带访问令牌的局域网地址」——令牌是这个功能的安全边界，
 * 所以用例直接用 HTTP 请求去戳服务，断言「没令牌进不去」「旧令牌立刻失效」，
 * 而不是只看界面上的文字。
 */

/** 设置中心侧边栏栏目键。 */
const SECTION_NAME = 'mobile' as const;

/** 启用开关的无障碍名。 */
const ENABLE_SWITCH_NAME = '启用手机访问';

/**
 * 进入手机访问设置页。
 *
 * @param page 应用主窗口页面。
 */
async function openMobileAccess(page: Page): Promise<void> {
    await openSettingsSection(page, SECTION_NAME, page.getByRole('switch', { name: ENABLE_SWITCH_NAME }));
}

/**
 * 打开手机访问服务，并等页面把访问地址列出来。
 *
 * @param page 应用主窗口页面。
 */
async function enableMobileAccess(page: Page): Promise<void> {
    const toggle = page.getByRole('switch', { name: ENABLE_SWITCH_NAME });
    // Astryx 的 Switch 渲染成原生 checkbox，勾选状态在 checked 属性上而不是 aria-checked。
    if (!(await toggle.isChecked())) {
        await toggle.click();
    }
    // 地址区块要等服务真的起来才有内容，这里等第一条带令牌的地址出现。
    await expect(page.getByTestId('mobile-access-url').first()).toBeVisible({ timeout: 20_000 });
}

/**
 * 读取页面上展示的第一条访问地址。
 *
 * @param page 应用主窗口页面。
 * @returns 完整访问地址（含令牌）。
 */
async function readAccessUrl(page: Page): Promise<string> {
    const text = await page.getByTestId('mobile-access-url').first().textContent();
    expect(text).toBeTruthy();
    return (text ?? '').trim();
}

test.describe('手机访问设置', () => {
    test('[SET-MOB-01] 开启后访问地址带令牌，没有令牌的请求被拒绝', async ({ session }) => {
        const page = session.page;
        await openMobileAccess(page);
        await enableMobileAccess(page);

        const accessUrl = await readAccessUrl(page);
        expect(accessUrl).toContain('?t=');
        const token = new URL(accessUrl).searchParams.get('t');
        expect(token).toBeTruthy();
        expect((token ?? '').length).toBeGreaterThanOrEqual(32);

        // 同一个地址去掉令牌就该进不去：这是这个功能的安全边界，
        // 只断言「地址里有令牌」证明不了服务真的在校验。
        const withoutToken = new URL(accessUrl);
        withoutToken.searchParams.delete('t');
        const anonymous = await fetch(withoutToken.toString());
        expect(anonymous.status).toBe(401);

        // 带令牌的地址则要能正常打开手机页。
        const authorized = await fetch(accessUrl);
        expect(authorized.status).toBe(200);
    });

    test('[SET-MOB-02] 重新生成令牌后旧地址立刻失效，新地址可用', async ({ session, userDataDir }) => {
        const page = session.page;
        await openMobileAccess(page);
        await enableMobileAccess(page);

        const oldUrl = await readAccessUrl(page);
        const oldToken = new URL(oldUrl).searchParams.get('t');

        await page.getByRole('button', { name: '重新生成令牌' }).click();

        // 新令牌要落到配置里，并且与旧令牌不同。
        await expect.poll(() => readConfigValue(userDataDir, 'mobileAccess.token')).not.toBe(oldToken);

        await page.getByRole('button', { name: '刷新' }).click();
        const newUrl = await readAccessUrl(page);
        const newToken = new URL(newUrl).searchParams.get('t');
        expect(newToken).toBeTruthy();
        expect(newToken).not.toBe(oldToken);

        // 旧地址要真的打不开了，而不只是界面上换了个字符串。
        const stale = await fetch(oldUrl);
        expect(stale.status).toBe(401);

        const fresh = await fetch(newUrl);
        expect(fresh.status).toBe(200);
    });

    test('[SET-MOB-03] 关闭后不再展示访问地址', async ({ session, userDataDir }) => {
        const page = session.page;
        await openMobileAccess(page);
        await enableMobileAccess(page);
        await expect.poll(() => readConfigValue(userDataDir, 'mobileAccess.enabled')).toBe('true');

        await page.getByRole('switch', { name: ENABLE_SWITCH_NAME }).click();

        await expect.poll(() => readConfigValue(userDataDir, 'mobileAccess.enabled')).toBe('false');
        // 关闭后地址区块应回到空态文案，不再列出任何带令牌的地址。
        await expect(page.getByText('开启服务后，这里会列出可以访问的地址。')).toBeVisible();
        await expect(page.getByTestId('mobile-access-url')).toHaveCount(0);
    });
});
