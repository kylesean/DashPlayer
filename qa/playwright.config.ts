import { defineConfig } from '@playwright/test';

/**
 * QA 用例的 Playwright 配置（唯一入口）。
 *
 * 使用方式（不要加 yarn 脚本，这里就是入口）：
 * - `npx playwright test -c qa/playwright.config.ts`：全部用例；
 * - `npx playwright test -c qa/playwright.config.ts --list`：只列用例；
 * - `npx playwright test -c qa/playwright.config.ts qa/specs/player`：只跑某个目录。
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
    // 每个用例都会真实启动一个 Electron 实例，串行执行避免窗口互相干扰
    workers: 1,
    fullyParallel: false,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    // 失败留证：真实 Electron 窗口里发生的事，事后只能靠 trace 回放。
    // 此前三项全关，失败时只剩列表报告里的堆栈和用例自己打的日志，
    // 而这套用例单轮要跑约 7 分钟，重新复现的成本很高。
    // 只在失败时保留，通过时不产生任何额外 IO。
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    reporter: [['list']],
    globalSetup: './support/globalSetup.ts',
});
