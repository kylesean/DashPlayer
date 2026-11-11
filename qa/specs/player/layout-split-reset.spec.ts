/**
 * 分栏双击复位回归用例。
 *
 * 产品约定：双击**任意**分隔条，同时恢复左右（视频 / 字幕文稿）与上下
 * （舞台 / 主字幕）两组比例。此前两个分隔条各管一轴，用户拖动过其中一组、
 * 却双击了另一组分隔条时，看起来就像复位完全没生效。
 */
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test } from '../../support/fixtures';
import { SENTENCE_CARD_TESTID } from '../../../src/common/constants/player-scroll-protocol';

const FIXTURE_VIDEO = path.resolve(__dirname, '..', '..', 'fixtures', 'media', 'qa-bilingual.mp4');

const INNER_HANDLE = 'playback-split-handle-inner';
const OUTER_HANDLE = 'playback-split-handle-outer';

interface SplitSizes {
    video: number;
    transcript: number;
    stage: number;
    subtitle: number;
}

async function openPlayer(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((file) => {
        window.location.hash = `#/player/qa?file=${encodeURIComponent(file)}&seek=0&lang=zh`;
    }, FIXTURE_VIDEO);
    await expect(page.getByTestId(SENTENCE_CARD_TESTID).first()).toBeVisible({ timeout: 30_000 });
}

async function readSplitSizes(page: Page): Promise<SplitSizes> {
    return page.evaluate(() => {
        const read = (key: string) => Number.parseFloat(localStorage.getItem(key) ?? 'NaN');
        return {
            video: read('split-size-oa'),
            transcript: read('split-size-ob'),
            stage: read('split-size-ia'),
            subtitle: read('split-size-ib'),
        };
    });
}

async function dragHandle(page: Page, testId: string, dx: number, dy: number): Promise<void> {
    const handle = page.getByTestId(testId);
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) {
        throw new Error(`${testId} 不可见，无法构造拖动前提`);
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
}

async function doubleClickHandle(page: Page, testId: string): Promise<void> {
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) {
        throw new Error(`${testId} 不可见，无法双击`);
    }
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
}

/** 左右复位是固定值；上下复位会随字号与整句模式在 25%~32% 之间浮动。 */
async function expectBothAxesReset(page: Page): Promise<void> {
    await expect
        .poll(async () => {
            const sizes = await readSplitSizes(page);
            return Math.abs(sizes.video - 75) < 0.01 && Math.abs(sizes.transcript - 25) < 0.01;
        })
        .toBe(true);
    const sizes = await readSplitSizes(page);
    expect(sizes.subtitle).toBeGreaterThanOrEqual(25);
    expect(sizes.subtitle).toBeLessThanOrEqual(32);
    expect(sizes.stage + sizes.subtitle).toBeCloseTo(100, 5);
}

test('[SET-PLY-02] 双击任一分隔条都会同时复位两组比例', async ({ session }) => {
    const { page } = session;
    await openPlayer(page);

    await dragHandle(page, OUTER_HANDLE, -160, 0);
    await dragHandle(page, INNER_HANDLE, 0, 120);
    const dragged = await readSplitSizes(page);
    expect(dragged.transcript).toBeGreaterThan(25);
    expect(dragged.subtitle).toBeLessThan(25);

    await doubleClickHandle(page, INNER_HANDLE);
    await expectBothAxesReset(page);

    await dragHandle(page, OUTER_HANDLE, 120, 0);
    await dragHandle(page, INNER_HANDLE, 0, -80);
    const draggedAgain = await readSplitSizes(page);
    expect(draggedAgain.transcript).toBeLessThan(25);
    expect(draggedAgain.subtitle).toBeGreaterThan(25);

    await doubleClickHandle(page, OUTER_HANDLE);
    await expectBothAxesReset(page);
});

test('[SET-PLY-03] 字幕文稿收起后双击主字幕分隔条仍能复位且不抛错', async ({ session }) => {
    const { page } = session;
    await openPlayer(page);

    await page.getByLabel('收起字幕文稿').first().click();
    await expect(page.getByTestId(OUTER_HANDLE)).toHaveCount(0);

    await dragHandle(page, INNER_HANDLE, 0, 120);
    const dragged = await readSplitSizes(page);
    expect(dragged.subtitle).toBeLessThan(25);

    await doubleClickHandle(page, INNER_HANDLE);
    const reset = await readSplitSizes(page);
    expect(reset.subtitle).toBeGreaterThanOrEqual(25);
    expect(reset.subtitle).toBeLessThanOrEqual(32);
    expect(reset.stage + reset.subtitle).toBeCloseTo(100, 5);
});

test('[SET-PLY-04] 大字号下复位后双语字幕仍完整落在默认面板内', async ({ session }) => {
    const { page } = session;
    await page.evaluate(async () => {
        const electron = (window as unknown as {
            electron: { call: (path: string, param: unknown) => Promise<unknown> };
        }).electron;
        await electron.call('system/config/set', {
            key: 'appearance.fontSize',
            value: 'fontSizeLarge',
        });
    });
    await page.reload();
    await page.getByTestId('nav-settings').waitFor();
    await openPlayer(page);

    await doubleClickHandle(page, INNER_HANDLE);
    const sizes = await readSplitSizes(page);
    expect(sizes.subtitle).toBeGreaterThanOrEqual(28);

    const subtitle = await page.getByTestId('main-subtitle-scroller').evaluate((scroller) => {
        const content = scroller.querySelector<HTMLElement>('[data-testid="main-subtitle-content"]');
        if (!content) {
            throw new Error('主字幕内容容器不存在');
        }
        const scale = getComputedStyle(content).getPropertyValue('--sub-scale') || '1';
        return {
            clientHeight: scroller.clientHeight,
            scrollHeight: scroller.scrollHeight,
            scale: Number.parseFloat(scale),
            text: scroller.textContent ?? '',
        };
    });

    expect(subtitle.text).toContain('The player keeps your reading position steady');
    expect(subtitle.text).toContain('界面重新排版时');
    // 长句在 31% 面板里允许温和缩放，但不得低于产品设定的 0.75 可读下限。
    expect(subtitle.scale).toBeGreaterThanOrEqual(0.85);
    expect(subtitle.scale).toBeLessThanOrEqual(1);
    expect(subtitle.scrollHeight).toBeLessThanOrEqual(subtitle.clientHeight + 1);
});
