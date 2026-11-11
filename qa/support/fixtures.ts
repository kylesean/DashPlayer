import {
    test as base,
    _electron as electron,
    type ElectronApplication,
    type Page,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ONBOARDING_COMPLETED_VERSION_KEY } from '../../src/common/constants/systemConfigKeys';
import { CURRENT_ONBOARDING_VERSION } from '../../src/common/constants/onboarding';
import {
    installProcessObserver,
    isFatalProcessGone,
    observePage,
    takeProcessGone,
    type PageObservation,
    type ProcessGoneRecord,
} from './observation';

/** 仓库根目录（本文件在 `qa/support/` 下）；`electron .` 会读取 package.json 的 main（.vite/build/main.cjs）。 */
const projectRoot = path.resolve(__dirname, '..', '..');

/** 开发态配置文件：`electron .` 启动时 electron-store 文件名带 .dev 后缀（判定见 runtimeEnv）。 */
const CONFIG_FILE_NAME = 'config.dev.json';

/** 一次应用会话：Electron 进程 + 已越过启动引导的主窗口。 */
export interface AppSession {
    /** Electron 进程句柄；重启场景可提前 close 后再建立新会话。 */
    app: ElectronApplication;
    /** 主窗口页面，处于主界面而非引导页。 */
    page: Page;
    /** 关闭应用进程；重复调用无副作用，便于用例内提前关闭。 */
    close: () => Promise<void>;
    /** 页面级错误观测。 */
    pageObservation: PageObservation;
    /** 取走主进程记录的进程退出事件。 */
    takeProcessGone: () => Promise<ProcessGoneRecord[]>;
    /** 主进程 stderr 尾部（最多 20KB）。 */
    stderrTail: () => string;
}

/** 启动选项。 */
export interface LaunchAppOptions {
    /** 是否由 fixture 越过引导；默认 true。测引导本身时传 false。 */
    skipOnboarding?: boolean;
}

/**
 * 读取 userData 中的开发态配置文件，用于断言设置是否真正落盘。
 *
 * 注意 electron-store 默认按点号访问嵌套属性，文件里是嵌套结构：
 * appearance.theme 实际存为 {"appearance":{"theme":"dark"}}。
 *
 * @param userDataDir 用例独占的 userData 目录。
 * @returns 解析后的配置对象。
 */
export function readConfig(userDataDir: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(userDataDir, CONFIG_FILE_NAME), 'utf8')) as Record<string, unknown>;
}

/**
 * 按点号路径读取配置值。
 *
 * @param userDataDir 用例独占的 userData 目录。
 * @param key 形如 appearance.theme 的点号路径。
 * @returns 对应值；路径不存在时为 undefined。
 */
export function readConfigValue(userDataDir: string, key: string): unknown {
    return key.split('.').reduce<unknown>((node, segment) => {
        if (node === null || typeof node !== 'object') {
            return undefined;
        }
        return (node as Record<string, unknown>)[segment];
    }, readConfig(userDataDir));
}

/**
 * 判断凭据类设置是否已经持久化。
 *
 * 凭据在 `safeStorage` 可用时以 `dp-enc:` 密文落盘（macOS / Windows 默认可用，
 * Linux 取决于有没有系统密钥环），不可用时才是明文。断言不该绑定某一种编码：
 * 绑定明文会让同一份用例在 macOS 上必红，绑定密文则在无密钥环的 Linux 上必红。
 *
 * 真正的「用户可见」验证是重进页面后密钥回显，各用例都另有断言。
 *
 * @param userDataDir 用例独占的 userData 目录。
 * @param key 形如 apiKeys.openAi.key 的点号路径。
 * @param plaintext 期望的明文值。
 * @returns 已写入（明文或密文）时为 true。
 */
export function isSecretPersisted(userDataDir: string, key: string, plaintext: string): boolean {
    const raw = readConfigValue(userDataDir, key);
    if (typeof raw !== 'string' || raw.length === 0) {
        return false;
    }
    return raw === plaintext || raw.startsWith('dp-enc:');
}

/**
 * 创建用例独占的 userData 目录，并预置配置让运行环境确定且不污染真实数据：
 * - i18n.language 固定为中文，断言依赖的界面文案不随宿主系统语言漂移；
 * - storage.path 指向临时目录，避免应用在文档目录下创建媒体库。
 *
 * @returns 临时 userData 目录绝对路径。
 */
async function createUserDataDir(): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dashplayer-e2e-'));
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
 * 越过首次使用引导，让应用进入主界面。
 *
 * 引导完成标记存在数据库里，无法在启动前预置；这里通过应用自身的配置接口
 * （与引导页「跳过」同一个后端入口）写入标记后刷新页面，不使用任何 mock。
 *
 * @param page 启动后的窗口页面（此时可能还在引导页或加载态）。
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
    // 主界面（首页）导航里的设置入口，是引导页不会出现的内容
    await page.getByTestId('nav-settings').waitFor();
}

/**
 * 确认应用确实把状态写进了本轮用例的临时目录。
 *
 * 用例会真实建库、改设置，一旦 `--user-data-dir` 失效就会写坏本机真实数据，
 * 因此这里必须尽早失败，而不是让用例带着污染继续跑。
 *
 * @param userDataDir 用例独占的 userData 目录。
 */
async function assertUserDataIsolated(userDataDir: string): Promise<void> {
    // 开发态（electron .）的数据库位于 <userData>/data-dev，由启动迁移创建
    const databaseFile = path.join(userDataDir, 'data-dev', 'dp_db.sqlite3');
    if (!fs.existsSync(databaseFile)) {
        throw new Error(`应用未在隔离目录内建库，userData 可能没有切到 ${userDataDir}`);
    }
}

/**
 * 启动超时（毫秒）。
 *
 * Playwright 默认 30 秒。但 `qa/README.md` 第 7 节记录过「启动偶发停顿几十秒到几分钟」
 * 的环境级问题（显示器切换器会让 Chromium 迟迟不 fork GPU 进程、不建 profile）。
 * 用默认值，一次环境停顿就会被报成「启动超时」，而它既不是用例的问题也不是产品的问题。
 * 这里放宽到 120 秒，并在超时时把归因写进错误信息，避免下一个人从错误方向开始排查。
 */
const LAUNCH_TIMEOUT_MS = 120_000;

/** 首窗口必须加载本地生产 bundle 的超时（毫秒）。 */
const ENTRY_TIMEOUT_MS = 15_000;

/**
 * 解析启动参数。
 *
 * 默认追加 `--disable-gpu`，从启动入口规避 Linux/Wayland 下 NVIDIA egl-gbm
 * 的上游崩溃（NVIDIA/egl-gbm#9）与启动等待；某些用例要显式验证 GPU 硬件路径时，
 * 设置 `QA_DISABLE_GPU=0` 关闭该优化。no-sandbox 仍保持显式 opt-in。
 *
 * @param userDataDir 用例独占的 userData 目录。
 * @returns Electron 参数列表。
 */
function buildLaunchArgs(userDataDir: string): string[] {
    const args = ['.', `--user-data-dir=${userDataDir}`];
    if (process.env.QA_DISABLE_GPU !== '0') {
        args.push('--disable-gpu');
    }
    if (process.env.QA_ELECTRON_NO_SANDBOX === '1') {
        args.push('--no-sandbox');
    }
    return args;
}

/**
 * 构造 Electron 子进程环境。
 *
 * `ELECTRON_RUN_AS_NODE` 会让 Electron 以纯 Node 启动，`--no-sandbox` 等 Chromium
 * 参数会被当成 Node 参数直接报错；`NODE_OPTIONS` 则可能被宿主的调试配置带进来。
 *
 * @returns 清理后的环境变量。
 */
function buildLaunchEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined || key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS') {
            continue;
        }
        env[key] = value;
    }
    return env;
}

/**
 * 把 Playwright 的启动失败翻译成可归因的错误。
 *
 * @param error 原始错误。
 * @returns 带排查提示的错误。
 */
function describeLaunchFailure(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    let hint: string;
    if (/bad option|unknown option|not allowed in NODE_OPTIONS|invalid value/i.test(message)) {
        hint = 'Electron 把 Chromium 参数当成了 Node 参数：检查 ELECTRON_RUN_AS_NODE/NODE_OPTIONS，'
            + 'fixture 已主动清理；若手工启动，先 unset 这两个变量。';
    } else if (/Process failed to launch|spawn .* ENOENT|ENOENT/i.test(message)) {
        hint = 'Electron 二进制不可执行或路径不存在：确认 node_modules/electron 已安装完成。';
    } else if (/timeout|timed out/i.test(message)) {
        hint = '启动超时。若日志卡在 "Debugger listening" 之后，先按 qa/README.md 第 7 节排查'
            + '显示器切换器/GPU 进程停顿，不要先怀疑用例。';
    } else {
        hint = '检查 Electron 版本、显示环境与 qa/README.md 第 7 节的已知环境问题。';
    }
    return new Error(`Electron 启动失败或超时（上限 ${LAUNCH_TIMEOUT_MS / 1000} 秒）。${hint}\n${message}`, {
        cause: error,
    });
}

/**
 * 断言首窗口加载的是本地生产 bundle，而不是 dev server。
 *
 * `.vite` 里如果是开发态构建，`main.cjs` 会加载 `http://localhost:5173`；本机恰好
 * 开着 Vite dev server 时用例会对着另一套代码跑出假绿。globalSetup 校验构建清单，
 * 这里再从进程实际加载的 URL 兜一层。
 *
 * @param page 主窗口页面。
 */
async function assertProductionEntry(page: Page): Promise<void> {
    try {
        await page.waitForURL((url) => url.protocol === 'file:', { timeout: ENTRY_TIMEOUT_MS });
    } catch {
        throw new Error(
            `应用没有加载本地生产 bundle，当前 URL：${page.url()}。`
            + '这说明 `.vite` 是开发态构建或 dev server 冒充了应用入口；'
            + '请删除 `.vite` 后重跑，globalSetup 会重新生成带清单的生产构建。',
        );
    }
}

/**
 * 启动一次应用会话，并等待进入主界面。
 *
 * @param userDataDir 用例独占的 userData 目录。
 * @returns 应用会话；重启场景需先 close 再对同一目录调用本函数。
 */
export async function launchAppSession(
    userDataDir: string,
    options: LaunchAppOptions = {},
): Promise<AppSession> {
    let app: ElectronApplication;
    try {
        app = await electron.launch({
            args: buildLaunchArgs(userDataDir),
            cwd: projectRoot,
            env: buildLaunchEnv(),
            timeout: LAUNCH_TIMEOUT_MS,
        });
    } catch (error) {
        throw describeLaunchFailure(error);
    }
    // 必须在 firstWindow 之前挂监听：启动阶段的渲染进程崩溃同样要留证
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
        await assertProductionEntry(page);
        // 首窗口出现时启动迁移已完成，数据库落在隔离目录还是真实目录此时可判定
        await assertUserDataIsolated(userDataDir);
        if (options.skipOnboarding !== false) {
            await passOnboardingGate(page);
        }
        return {
            app,
            page,
            close,
            pageObservation,
            takeProcessGone: () => takeProcessGone(app),
            stderrTail: () => stderr,
        };
    } catch (error) {
        // 启动半途失败时先收掉进程，避免用例失败后残留 Electron 进程
        await close();
        throw error;
    }
}

type Fixtures = {
    /** 用例独占的 userData 目录，测试结束后自动删除。 */
    userDataDir: string;
    /** 已启动并处于主界面的应用会话。 */
    session: AppSession;
};

export const test = base.extend<Fixtures>({
    userDataDir: async ({}, use) => {
        const dir = await createUserDataDir();
        await use(dir);
        await fs.promises.rm(dir, { recursive: true, force: true });
    },
    session: async ({ userDataDir }, use, testInfo) => {
        const session = await launchAppSession(userDataDir);
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
            const evidenceBody = JSON.stringify(evidence, null, 2);
            if (!passed) {
                await testInfo.attach('runtime-evidence.json', {
                    body: evidenceBody,
                    contentType: 'application/json',
                });
            }

            const failures = [
                ...pageErrors.map((message) => `渲染层未捕获异常：${message}`),
                ...fatalProcessGone.map((record) => `渲染进程异常退出：${JSON.stringify(record)}`),
            ];
            if (passed && failures.length > 0) {
                await testInfo.attach('runtime-evidence.json', {
                    body: evidenceBody,
                    contentType: 'application/json',
                });
                observationError = new Error(`用例通过但运行期观测到故障：\n${failures.join('\n')}`);
            }
            if (passed && (consoleErrors.length > 0 || processGone.length > 0)) {
                const processSummary = processGone
                    .map((record) => `${record.processType ?? record.event}:${record.reason}:${record.exitCode ?? '-'}`)
                    .join(', ');
                console.warn(
                    `[qa] 运行期出现非致命错误/进程退出（未影响断言）：`
                    + `${consoleErrors.length} 条 console.error，${processGone.length} 条进程退出`
                    + `${processSummary ? `（${processSummary}）` : ''}；`
                    + '非致命事件不单独 attach，失败时统一写入 runtime-evidence.json。',
                );
            }
        } catch (error) {
            observationError = error instanceof Error ? error : new Error(String(error));
        } finally {
            // 用例失败也必须收掉进程，否则残留的 Electron 会污染后续用例
            await session.close();
        }
        // 不把 throw 放在 finally 里：那会覆盖测试体本身的错误，导致第一现场丢失
        if (useError) {
            throw useError;
        }
        if (observationError) {
            throw observationError;
        }
    },
});
