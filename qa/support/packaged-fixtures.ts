import { test as base, _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CURRENT_ONBOARDING_VERSION } from '../../src/common/constants/onboarding';
import { ONBOARDING_COMPLETED_VERSION_KEY } from '../../src/common/constants/systemConfigKeys';
import {
    installProcessObserver,
    isFatalProcessGone,
    observePage,
    takeProcessGone,
    type PageObservation,
    type ProcessGoneRecord,
} from './observation';
import { readPackagedApp } from './packaged-app';

/** 打包态配置文件：app.isPackaged=true 时没有 .dev 后缀。 */
const CONFIG_FILE_NAME = 'config.json';
const LAUNCH_TIMEOUT_MS = 120_000;
const ENTRY_TIMEOUT_MS = 15_000;

/** 打包应用会话。 */
export interface PackagedSession {
    app: ElectronApplication;
    page: Page;
    close: () => Promise<void>;
    pageObservation: PageObservation;
    takeProcessGone: () => Promise<ProcessGoneRecord[]>;
    stderrTail: () => string;
}

/**
 * 创建打包态隔离数据目录，并预置「已完成引导」。
 *
 * 打包冒烟不重复测引导 UI（已有 SET-ONB-01）；这里模拟回访用户，直接验证
 * 打包产物的启动、数据目录、ASAR/原生模块与设置链路。
 *
 * @returns 临时 userData 目录。
 */
async function createUserDataDir(): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dashplayer-packaged-e2e-'));
    await fs.promises.writeFile(
        path.join(dir, CONFIG_FILE_NAME),
        JSON.stringify({
            i18n: { language: 'zh-CN' },
            storage: { path: path.join(dir, 'library') },
        }),
        'utf8',
    );
    return dir;
}

/**
 * 通过应用自身的配置接口越过引导。
 *
 * 完成标记在 SQLite 的 dp_sys_conf 表里，不能像普通设置那样预置到 config.json；
 * 打包冒烟只关心打包产物，不重复覆盖引导 UI（SET-ONB-01 已覆盖）。
 *
 * @param page 启动后的主窗口页面。
 */
async function passOnboardingGate(page: Page): Promise<void> {
    await page.waitForFunction(() => Boolean((window as { electron?: unknown }).electron));
    await page.evaluate(async (params: { key: string; value: string }) => {
        const handler = (window as unknown as {
            electron: { call: (path: string, param: unknown) => Promise<unknown> };
        }).electron;
        await handler.call('system/config/set', params);
    }, { key: ONBOARDING_COMPLETED_VERSION_KEY, value: CURRENT_ONBOARDING_VERSION });
    await page.reload();
}

/**
 * 构造打包 Electron 的环境。
 *
 * 故意注入 `NODE_ENV=development`：打包应用必须使用 data/、logs/、config.json，
 * 不能因为终端里带着这个变量就退回 dev 数据目录或开启 __dpDebug。
 *
 * @returns 清理后的环境变量。
 */
function buildPackagedEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined || key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS') {
            continue;
        }
        env[key] = value;
    }
    env.NODE_ENV = 'development';
    return env;
}

/**
 * 断言打包产物从本地 ASAR 加载，而不是 dev server。
 *
 * @param page 主窗口页面。
 */
async function assertFileEntry(page: Page): Promise<void> {
    try {
        await page.waitForURL((url) => url.protocol === 'file:', { timeout: ENTRY_TIMEOUT_MS });
    } catch {
        throw new Error(`打包应用没有加载本地 file: 入口，当前 URL：${page.url()}`);
    }
}

/**
 * 启动打包应用。
 *
 * @param userDataDir 隔离的 userData 目录。
 * @returns 打包应用会话。
 */
export async function launchPackagedSession(userDataDir: string): Promise<PackagedSession> {
    const packaged = readPackagedApp();
    const args = [`--user-data-dir=${userDataDir}`];
    // 与源构建 fixture 保持一致：默认关闭 GPU，避免 Linux/Wayland NVIDIA egl-gbm
    // 上游崩溃和系统通知干扰；需要验证 GPU 硬件路径时设置 QA_DISABLE_GPU=0。
    if (process.env.QA_DISABLE_GPU !== '0') {
        args.push('--disable-gpu');
    }
    if (process.env.QA_ELECTRON_NO_SANDBOX === '1') {
        args.push('--no-sandbox');
    }

    let app: ElectronApplication;
    try {
        app = await electron.launch({
            executablePath: packaged.executablePath,
            args,
            env: buildPackagedEnv(),
            timeout: LAUNCH_TIMEOUT_MS,
        });
    } catch (error) {
        throw new Error(
            `打包应用启动失败或超时（${packaged.executablePath}）。`
            + '确认使用 QA 打包配置（EnableNodeCliInspectArguments=true），且产物与当前平台匹配。',
            { cause: error },
        );
    }

    await installProcessObserver(app);
    let stderr = '';
    app.process().stderr?.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-20_000);
    });

    let closed = false;
    const close = async (): Promise<void> => {
        if (closed) {
            return;
        }
        closed = true;
        await app.close();
    };

    try {
        const page = await app.firstWindow();
        const pageObservation = observePage(page);
        await assertFileEntry(page);

        // app.isPackaged=true 时数据库落在 data/，配置落在 config.json；
        // 若 NODE_ENV 仍能解锁 dev 环境，这两个断言会直接指出污染路径。
        await expect.poll(
            () => fs.existsSync(path.join(userDataDir, 'data', 'dp_db.sqlite3')),
            { timeout: 15_000 },
        ).toBe(true);
        if (fs.existsSync(path.join(userDataDir, 'data-dev'))) {
            throw new Error('打包应用创建了 data-dev：NODE_ENV 仍在影响运行环境判定');
        }
        if (fs.existsSync(path.join(userDataDir, 'config.dev.json'))) {
            throw new Error('打包应用创建了 config.dev.json：NODE_ENV 仍在影响运行环境判定');
        }

        await passOnboardingGate(page);
        await page.getByTestId('nav-settings').waitFor();
        return {
            app,
            page,
            close,
            pageObservation,
            takeProcessGone: () => takeProcessGone(app),
            stderrTail: () => stderr,
        };
    } catch (error) {
        await close();
        throw error;
    }
}

type Fixtures = {
    userDataDir: string;
    session: PackagedSession;
};

export const test = base.extend<Fixtures>({
    userDataDir: async ({}, use) => {
        const dir = await createUserDataDir();
        await use(dir);
        await fs.promises.rm(dir, { recursive: true, force: true });
    },
    session: async ({ userDataDir }, use, testInfo) => {
        const session = await launchPackagedSession(userDataDir);
        let useError: unknown = null;
        try {
            await use(session);
        } catch (error) {
            useError = error;
        }
        let observationError: Error | null = null;
        try {
            const passed = testInfo.status === testInfo.expectedStatus;
            const pageErrors = session.pageObservation.takePageErrors();
            const consoleErrors = session.pageObservation.takeConsoleErrors();
            const processGone = await session.takeProcessGone();
            const fatalProcessGone = processGone.filter(isFatalProcessGone);
            const evidence = {
                pageErrors,
                consoleErrors,
                processGone,
                stderr: session.stderrTail(),
            };
            if (!passed || pageErrors.length > 0 || fatalProcessGone.length > 0) {
                await testInfo.attach('runtime-evidence.json', {
                    body: JSON.stringify(evidence, null, 2),
                    contentType: 'application/json',
                });
            }
            const failures = [
                ...pageErrors.map((message) => `渲染层未捕获异常：${message}`),
                ...fatalProcessGone.map((record) => `渲染进程异常退出：${JSON.stringify(record)}`),
            ];
            if (passed && failures.length > 0) {
                observationError = new Error(`用例通过但运行期观测到故障：\n${failures.join('\n')}`);
            }
            if (passed && (consoleErrors.length > 0 || processGone.length > 0)) {
                console.warn(
                    `[qa] 打包冒烟出现非致命错误/进程退出：`
                    + `${consoleErrors.length} 条 console.error，${processGone.length} 条进程退出`,
                );
            }
        } catch (error) {
            observationError = error instanceof Error ? error : new Error(String(error));
        } finally {
            await session.close();
        }
        if (useError) {
            throw useError;
        }
        if (observationError) {
            throw observationError;
        }
    },
});
