import { defineConfig } from '@playwright/test';
import path from 'node:path';

/**
 * QA 用例的 Playwright 配置（唯一入口）。
 *
 * 使用方式：
 * - `pnpm run test:e2e`：全部用例；
 * - `pnpm run test:e2e:smoke`：PR 门禁的 @smoke 子集；
 * - `pnpm exec playwright test -c qa/playwright.config.ts --list`：只列用例；
 * - `pnpm exec playwright test -c qa/playwright.config.ts qa/specs/player`：只跑某个目录。
 *
 * 说明：
 * - `testDir` 指向 `qa/specs`，所以 `src/` 与 `qa/specs` 之间没有任何文件系统巧合式依赖；
 * - 用例通过 Playwright 的 Electron 支持驱动本地 Electron 二进制（`electron .` 读 `.vite/` 产物），
 *   不使用 Playwright 自带浏览器，安装依赖时已跳过浏览器下载；
 * - `globalSetup` 负责备料：`.vite` 产物缺失/过期时重新构建，媒体夹具缺失时生成，
 *   因此「刚 clone 或改了 src」都不需要手工跑构建命令。
 */
export default defineConfig({
    testDir: './specs',
    // 打包冒烟依赖 out/qa-package（由 test:e2e:packaged 生成），必须由
    // playwright.packaged.config.ts 单独驱动；源构建全量不能顺手把它收进来，
    // 否则 fresh CI 会在没有打包产物时误报。
    testIgnore: '**/packaged/**',
    // 每个用例都会真实启动一个 Electron 实例，串行执行避免窗口互相干扰
    workers: 1,
    fullyParallel: false,
    // 单条用例要启动真实 Electron；fixture 的 launch 超时是 120s，
    // 全局测试超时必须大于它，否则启动还在等、Playwright 先把用例判超时，
    // teardown 再去 close 一个尚未启动完的进程，错误归因会完全错位。
    timeout: 180_000,
    expect: { timeout: 10_000 },
    // CI 上偶发环境抖动允许重试一次；本地不重试，避免把真实回归藏起来
    retries: process.env.CI ? 1 : 0,
    forbidOnly: Boolean(process.env.CI),
    // 失败留证只开截图。
    //
    // 实测过 trace: 'retain-on-failure'：它会在用例运行期间持续录制 DOM 快照，
    // 代价是手机访问三条用例从 9.8 / 9.7 / 10.6 秒变成 10.6 / 39.6 / 40.4 秒
    // （关掉 trace 复跑又回到 9.9 / 9.8 / 10.7），整轮约 7 分钟会明显拉长。
    // 截图本身开销可忽略，且已经能在失败时给出画面证据。
    // 需要完整回放时临时加 --trace=on，不必为常态付出这个代价。
    outputDir: path.join(__dirname, 'test-results'),
    use: {
        screenshot: 'only-on-failure',
        // trace 常态关闭（见上）；CI 只在重试时开，既保留回放又不拖慢正常轮次
        trace: process.env.CI ? 'on-first-retry' : 'off',
    },
    reporter: process.env.CI
        ? [
            ['list'],
            ['junit', { outputFile: path.join(__dirname, 'test-results', 'junit.xml') }],
            ['html', { outputFolder: path.join(__dirname, 'playwright-report'), open: 'never' }],
        ]
        : [['list']],
    globalSetup: './support/globalSetup.ts',
});
