import path from 'node:path';
import { expect, type Page } from '@playwright/test';

import { test } from '../../support/fixtures';

/** 媒体夹具：真实视频 + 双语 SRT。 */
const FIXTURE_VIDEO = path.resolve(__dirname, '..', '..', 'fixtures', 'media', 'qa-bilingual.mp4');

/**
 * 夹具字幕第一句中的内容词，且存在于默认词表。
 *
 * 默认词表以 `ignored` 播种，因此它同时覆盖两条规则：新用户不应看到下划线；
 * 用户显式改为 `learning` 后才出现。
 */
const TARGET_WORD = 'steady';

/**
 * 通过应用自身的后端接口更新词状态。
 *
 * 这里不直接改数据库，也不 mock IPC：用例要验证的是真实「状态切换 → 注释重算」链路。
 */
async function setWordStatus(page: Page, status: 'learning' | 'known') {
    return page.evaluate(async ({ word, next }) => {
        const handler = (window as unknown as {
            electron: { call: (route: string, params: unknown) => Promise<unknown> };
        }).electron;
        return handler.call('vocabulary/update-state', { word, status: next });
    }, { word: TARGET_WORD, next: status });
}

/** 打开播放器并等待第一句字幕可交互。 */
async function openFixture(page: Page) {
    await page.evaluate((file) => {
        window.location.hash = `#/player/qa?file=${encodeURIComponent(file)}&seek=0&lang=zh`;
    }, FIXTURE_VIDEO);
    await expect(page.getByText('The player keeps').first()).toBeVisible({ timeout: 30_000 });
}

/** 读取主字幕里目标词的注释元素。 */
function annotationOf(page: Page) {
    return page
        .locator('[data-vocab-annotation]')
        .filter({ hasText: new RegExp(`^${TARGET_WORD}$`, 'i') })
        .first();
}

test.describe('词汇注释状态投影', () => {
    test('[SET-VOC-01] 新用户不会因默认词表出现下划线', async ({ session }) => {
        const { page } = session;
        await openFixture(page);

        // steady 属于默认词表，播种状态是 ignored；新库不应出现任何 learning 注释。
        await expect(page.locator('[data-vocab-annotation="learning"]')).toHaveCount(0);
    });

    test('[SET-VOC-02] 状态切换实时反映到主字幕下划线', async ({ session }) => {
        const { page } = session;
        await openFixture(page);

        const learning = await setWordStatus(page, 'learning');
        expect(learning).toMatchObject({ success: true });
        await page.reload();
        await expect(page.getByText('The player keeps').first()).toBeVisible({ timeout: 30_000 });
        await expect(annotationOf(page)).toHaveAttribute('data-vocab-annotation', 'learning');

        const known = await setWordStatus(page, 'known');
        expect(known).toMatchObject({ success: true });
        await page.reload();
        await expect(page.getByText('The player keeps').first()).toBeVisible({ timeout: 30_000 });
        await expect(annotationOf(page)).toHaveCount(0);
    });
});
