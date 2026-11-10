import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { test } from '../../support/packaged-fixtures';
import { SENTENCE_CARD_TESTID } from '../../../src/common/constants/player-scroll-protocol';

/** 媒体夹具：用来验证打包态忽略 `?file=` dev 入口。 */
const FIXTURE_VIDEO = path.resolve(__dirname, '..', '..', 'fixtures', 'media', 'qa-bilingual.mp4');

/**
 * 打包产物冒烟：ASAR、fuse、原生模块与 dev/prod 边界。
 *
 * 这一条只在 nightly / 手工 `pnpm run test:e2e:packaged` 跑；正式发布包关闭了
 * inspect fuse，Playwright 无法驱动，所以 QA 专用打包配置只打开这一个 fuse，
 * 其余安全配置与发布包一致。
 */
test.describe('打包产物', () => {
    test('[SET-PKG-01] 打包应用在 NODE_ENV=development 下仍按生产态启动，ASAR/资源/设置链路可用', async ({ session, userDataDir }) => {
        const { app, page } = session;
        const runtime = await app.evaluate(({ app: electronApp }) => ({
            isPackaged: electronApp.isPackaged,
            resourcesPath: process.resourcesPath,
        }));
        expect(runtime.isPackaged).toBe(true);
        expect(runtime.resourcesPath).toContain('resources');

        // NODE_ENV=development 不得把数据目录切回 dev 形态
        expect(fs.existsSync(path.join(userDataDir, 'data', 'dp_db.sqlite3'))).toBe(true);
        expect(fs.existsSync(path.join(userDataDir, 'data-dev'))).toBe(false);
        expect(fs.existsSync(path.join(userDataDir, 'config.json'))).toBe(true);
        expect(fs.existsSync(path.join(userDataDir, 'config.dev.json'))).toBe(false);

        // 打包态忽略 ?file=，也不暴露 __dpDebug
        await page.evaluate((file) => {
            window.location.hash = `#/player/qa?file=${encodeURIComponent(file)}&seek=0&lang=zh`;
        }, FIXTURE_VIDEO);
        // 这里必须给 dev 入口一个实际观察窗口：它若生效会在几秒内完成入库并渲染字幕
        await page.waitForTimeout(2000);
        expect(await page.evaluate(() => Boolean(
            (window as { __dpDebug?: unknown }).__dpDebug,
        ))).toBe(false);
        await expect(page.getByTestId(SENTENCE_CARD_TESTID)).toHaveCount(0);

        // 设置页仍可用：ASAR 内 renderer、preload、原生数据库模块与 extraResource 均已加载
        await page.evaluate(() => {
            window.location.hash = '#/settings/about';
        });
        await expect(page.getByRole('heading', { name: '关于与更新' })).toBeVisible();
    });
});
