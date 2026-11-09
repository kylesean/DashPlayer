import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 设置页用例共用的定位与导航工具。
 *
 * 设置页表单没有「保存」按钮，改完由页面防抖自动保存，所以用例的骨架统一是
 * 「操作 → 断言配置文件真的写了 → 重新加载页面断言回显」。
 */

/**
 * 从首页进入设置中心，再切到指定栏目。
 *
 * @param page 应用主窗口页面。
 * @param section 侧边栏里的中文栏目名（如「网络代理」）。
 * @param ready 该页独有的元素，用来确认页面已经切过去并完成初始化。
 */
export async function openSettingsSection(page: Page, section: string, ready: Locator): Promise<void> {
    await page.getByRole('link', { name: '设置中心' }).click();
    await switchSettingsSection(page, section, ready);
}

/**
 * 在设置中心内部切换到指定栏目（已在设置中心时使用）。
 *
 * 与 {@link openSettingsSection} 分开是为了让「从一个设置页切到另一个」的用例
 * 只经历一次导航——切走的瞬间正是要验证的时机，不能有多余的中间跳转。
 *
 * @param page 应用主窗口页面。
 * @param section 侧边栏里的中文栏目名（如「网络代理」）。
 * @param ready 该页独有的元素，用来确认页面已经切过去并完成初始化。
 */
export async function switchSettingsSection(page: Page, section: string, ready: Locator): Promise<void> {
    // 限定在设置侧边栏内点击，避免与其它导航区的同名入口混淆
    await page.locator('aside').getByRole('link', { name: section }).click();
    await expect(ready).toBeVisible();
}

/**
 * 重新加载当前设置页，用于验证界面上的值确实来自后端回读。
 *
 * 应用用 HashRouter，刷新会停在同一个设置页；重载等同于用户重新进入该页，
 * 但能排除「值只活在页面 state 里」的假通过。
 *
 * @param page 应用主窗口页面。
 * @param ready 该页的标志性元素，重载后重新等待它出现。
 */
export async function reloadSettingsPage(page: Page, ready: Locator): Promise<void> {
    await page.reload();
    await expect(ready).toBeVisible();
}

/**
 * 设置行的稳定标识（与产品侧 `SettingField` 的 `testId` 一一对应）。
 *
 * 为什么要从文案换成标识：原实现靠「包含这段文案的最后一个 div」来缩小范围，
 * 一旦页面排版变化（例如把行拆成两层容器、或在行内再嵌一个 div），
 * `.last()` 就会指到相邻行，用例开始串台——实测把设置行改成 flex 行容器后即复现。
 * 文案是给人看的、会随产品改动；标识只给机器用，且不随排版变化。
 *
 * 键必须与界面实际显示的中文标题逐字一致（产品文案来自 i18n，改文案就要同步改这里，
 * 漏改会在下面的 `selectInRow` 里直接报错，而不是悄悄退化成模糊匹配）。
 */
const ROW_TEST_ID_BY_TEXT: Record<string, string> = {
    '字幕翻译': 'setting-row-subtitle-translation',
    '翻译风格': 'setting-row-subtitle-style',
    '词典查询': 'setting-row-dictionary',
    // 注意是「讲解」不是「学习」：产品标题取 i18n 的 sentenceLabel，zh-CN 值是「整句讲解」
    '整句讲解': 'setting-row-sentence-learning',
    '识别方式': 'setting-row-transcription',
    'API 类型': 'setting-row-api-format',
    '界面语言': 'setting-row-language',
};

/**
 * 定位某个设置行里的下拉框。
 *
 * 只认行标识，不做「文案 + 最近容器」的模糊回退：那种写法在排版变化时会静默指到相邻行，
 * 用例照样跑绿，但断言的已经不是它声称的那一行——这比直接报错危险得多。
 * 未登记的行在这里抛出明确错误，新增设置页时补一行映射即可。
 *
 * @param page 应用主窗口页面。
 * @param rowText 该行标题（必须与 {@link ROW_TEST_ID_BY_TEXT} 的键一致）。
 * @returns 该行内的下拉框触发器。
 */
export function selectInRow(page: Page, rowText: string): Locator {
    const testId = ROW_TEST_ID_BY_TEXT[rowText];
    if (!testId) {
        throw new Error(
            `未知设置行「${rowText}」：请先在 ROW_TEST_ID_BY_TEXT 里登记它的 testid`
            + '（对应产品侧 SettingField 的 testId），不要靠文案模糊匹配。',
        );
    }
    return page.getByTestId(testId).getByRole('combobox');
}

/**
 * 在某个设置行内点开下拉框并选中一项。
 *
 * @param page 应用主窗口页面。
 * @param rowText 该行独有的文案片段。
 * @param option 下拉项的中文文案。
 */
export async function chooseInRow(page: Page, rowText: string, option: string): Promise<void> {
    await selectInRow(page, rowText).click();
    await page.getByRole('option', { name: option }).click();
}
