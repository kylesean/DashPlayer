import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * 打包产物冒烟配置。
 *
 * 与主配置分开：主配置的 globalSetup 会重建 `.vite` 并驱动 `electron .`（未打包），
 * 这里必须驱动 `out/qa-package` 里的真实产物，且不能先跑主配置的构建流程。
 */
export default defineConfig({
    testDir: './specs/packaged',
    workers: 1,
    fullyParallel: false,
    timeout: 180_000,
    expect: { timeout: 10_000 },
    retries: process.env.CI ? 1 : 0,
    forbidOnly: Boolean(process.env.CI),
    outputDir: path.join(__dirname, 'test-results-packaged'),
    use: {
        screenshot: 'only-on-failure',
        trace: process.env.CI ? 'on-first-retry' : 'off',
    },
    reporter: process.env.CI
        ? [
            ['list'],
            ['junit', { outputFile: path.join(__dirname, 'test-results-packaged', 'junit.xml') }],
            ['html', { outputFolder: path.join(__dirname, 'playwright-report-packaged'), open: 'never' }],
        ]
        : [['list']],
    globalSetup: './support/packagedGlobalSetup.ts',
});
