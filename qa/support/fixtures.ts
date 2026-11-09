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

/** 仓库根目录（本文件在 `qa/support/` 下）；`electron .` 会读取 package.json 的 main（.vite/build/main.js）。 */
const projectRoot = path.resolve(__dirname, '..', '..');

/** 开发态配置文件：`electron .` 时 app.isPackaged 为 false，electron-store 文件名带 .dev 后缀。 */
const CONFIG_FILE_NAME = 'config.dev.json';

/** 一次应用会话：Electron 进程 + 已越过启动引导的主窗口。 */
export interface AppSession {
    /** Electron 进程句柄；重启场景可提前 close 后再建立新会话。 */
    app: ElectronApplication;
    /** 主窗口页面，处于主界面而非引导页。 */
    page: Page;
    /** 关闭应用进程；重复调用无副作用，便于用例内提前关闭。 */
    close: () => Promise<void>;
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
    // 主界面（首页）导航里的「设置中心」入口，是引导页不会出现的内容
    await page.getByRole('link', { name: '设置中心' }).waitFor();
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

/**
 * 启动一次应用会话，并等待进入主界面。
 *
 * @param userDataDir 用例独占的 userData 目录。
 * @returns 应用会话；重启场景需先 close 再对同一目录调用本函数。
 */
export async function launchAppSession(userDataDir: string): Promise<AppSession> {
    let app: ElectronApplication;
    try {
        app = await electron.launch({
            args: ['.', `--user-data-dir=${userDataDir}`],
            cwd: projectRoot,
            timeout: LAUNCH_TIMEOUT_MS,
        });
    } catch (error) {
        throw new Error(
            `Electron 启动失败或超时（上限 ${LAUNCH_TIMEOUT_MS / 1000} 秒）。`
            + '若日志卡在 "Debugger listening" 之后迟迟不出现 "DevTools listening"，'
            + '先按 qa/README.md 第 7 节排查环境（显示器切换器会让启动停顿几十秒到几分钟），'
            + '不要先怀疑用例本身。',
            { cause: error },
        );
    }
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
        // 首窗口出现时启动迁移已完成，数据库落在隔离目录还是真实目录此时可判定
        await assertUserDataIsolated(userDataDir);
        await passOnboardingGate(page);
        return { app, page, close };
    } catch (error) {
        // 启动半途失败时先收掉进程，避免用例失败后残留 Electron 进程
        await close();
        throw error;
    }
}

/**
 * 收集渲染层的未捕获异常与 `console.error`。
 *
 * 为什么要收：这套 e2e 的价值主张是「真进程」，但断言只覆盖显式检查的那几条链路——
 * 渲染层抛异常、React 报错只要没影响断言就是静默的，用例照样绿。
 * trace 因 4 倍劣化被关掉（见 `qa/playwright.config.ts`），这里用零成本的方式补上观测。
 *
 * @param page 应用主窗口页面。
 * @returns 取出并清空已收集内容的函数。
 */
function collectRendererErrors(page: Page): () => string[] {
    const messages: string[] = [];
    page.on('pageerror', (error) => {
        messages.push(`[pageerror] ${error.message}`);
    });
    page.on('console', (message) => {
        if (message.type() === 'error') {
            messages.push(`[console.error] ${message.text()}`);
        }
    });
    return () => messages;
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
        const takeRendererErrors = collectRendererErrors(session.page);
        try {
            await use(session);
        } finally {
            const errors = takeRendererErrors();
            if (errors.length > 0) {
                const body = errors.join('\n');
                if (testInfo.status === testInfo.expectedStatus) {
                    // 通过但有渲染层错误：只提示、不制造红。
                    // 直接判红会让历史遗留噪音把门禁变成「狼来了」，那比不报更糟。
                    console.warn(`[qa] 渲染层出现 ${errors.length} 条错误（未影响断言）：\n${body}`);
                } else {
                    // 失败时把现场挂到报告上，省掉「只有截图、看不出哪一步炸了」的排查成本
                    await testInfo.attach('renderer-errors.txt', {
                        body,
                        contentType: 'text/plain',
                    });
                }
            }
            // 放在 finally 里：用例失败也必须收掉进程，否则残留的 Electron 会污染后续用例
            await session.close();
        }
    },
});
