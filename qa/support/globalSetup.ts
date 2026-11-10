/**
 * Playwright globalSetup：用例开跑前把「料」备齐。
 *
 * 备三样东西，全部按需（已有的不动），所以第一次跑和改了 src 之后跑都不需要手工命令：
 * 1. 应用构建产物 `.vite/`：缺失、输入摘要变化、产物摘要不一致或不是生产模式，
 *    就重新构建（Playwright 以 `electron .` 加载它；拿旧产物或 dev server 跑
 *    等于测另一套代码，比不跑更糟）；
 * 2. 手机页产物 `resources/mobile/`：缺失或源码变化就构建；
 * 3. 媒体夹具 `fixtures/media/`：SRT 或视频缺失就生成（工具在 `fixtures/make-fixtures.mjs`）。
 *
 * 三者都只写本地目录，不入库（媒体夹具已在 `qa/.gitignore` 里排除）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateProductionBuild } from './build-manifest';

/**
 * 仓库根目录（本文件在 `qa/support/` 下）。
 * 用 `__dirname` 而不是 `import.meta.url`：Playwright 把 TS 配置/初始化脚本按 CJS 转译，
 * `import.meta` 在 CJS 里不可用（会直接报 "Cannot use 'import.meta' outside a module"）。
 */
const projectDir = path.resolve(__dirname, '..', '..');

/** 媒体夹具目录与必需产物。 */
const MEDIA_DIR = path.join(projectDir, 'qa', 'fixtures', 'media');
const MEDIA_FILES = ['qa-bilingual.srt', 'qa-bilingual.mp4'];

/** 手机页产物入口；缺失时手机访问用例会以 20 秒超时失败且看不出原因。 */
const MOBILE_ENTRY = path.join(projectDir, 'resources', 'mobile', 'index.html');

/** 只影响单测、不影响产物的命名特征。 */
const NON_PRODUCT_PATH_RE = /(__tests__[\\/]|\.(test|spec)\.)/;

/**
 * 递归取目录下最新的 mtime（毫秒），跳过不进产物的单测文件。
 *
 * @param dir 目录绝对路径。
 * @returns 最新 mtime；目录不存在时为 0。
 */
const newestMtime = (dir: string): number => {
    if (!fs.existsSync(dir)) {
        return 0;
    }
    let newest = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (NON_PRODUCT_PATH_RE.test(full)) {
                continue;
            }
            newest = Math.max(newest, fs.statSync(full).mtimeMs);
        }
    }
    return newest;
};

/**
 * 需要时重新构建 `.vite` 产物。
 *
 * @returns 构建发生时为 true。
 */
const ensureBuild = (): boolean => {
    const validation = validateProductionBuild(projectDir);
    if (validation.ok) {
        console.log(`[qa] .vite 校验通过：${validation.reason}`);
        return false;
    }
    console.log(`[qa] .vite 需要重建：${validation.reason}`);
    const result = spawnSync(process.execPath, [path.join(projectDir, 'qa', 'support', 'build.mjs')], {
        cwd: projectDir,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error(`应用构建失败（exit ${result.status}）`);
    }
    const rebuilt = validateProductionBuild(projectDir);
    if (!rebuilt.ok) {
        throw new Error(`应用构建完成后校验仍失败：${rebuilt.reason}`);
    }
    return true;
};

/**
 * 取单个文件的最新 mtime。
 *
 * @param file 相对项目根的路径。
 * @returns mtime 毫秒；文件不存在时为 0。
 */
const fileMtime = (file: string): number => {
    const absolute = path.join(projectDir, file);
    return fs.existsSync(absolute) ? fs.statSync(absolute).mtimeMs : 0;
};

/**
 * 需要时构建手机页产物。
 *
 * resources/mobile 在 .gitignore 里，新克隆的仓库没有它；而手机访问用例会真实请求
 * 这个静态目录，缺失时服务直接启动失败，用例停在「等访问地址出现」的 20 秒超时上，
 * 看不出根因。这里按需构建，让「刚 clone 只需要一条命令」成立。
 *
 * @returns 构建发生时为 true。
 */
const ensureMobileWeb = (): boolean => {
    const builtMtime = fs.existsSync(MOBILE_ENTRY) ? fs.statSync(MOBILE_ENTRY).mtimeMs : 0;
    const sourceMtime = Math.max(
        newestMtime(path.join(projectDir, 'src', 'mobile')),
        newestMtime(path.join(projectDir, 'assets')),
        fileMtime('vite.mobile.config.ts'),
    );
    if (builtMtime > 0 && builtMtime >= sourceMtime) {
        return false;
    }
    const result = spawnSync(
        process.execPath,
        [path.join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.mobile.config.ts'],
        { cwd: projectDir, stdio: 'inherit' },
    );
    if (result.status !== 0) {
        throw new Error(`手机页构建失败（exit ${result.status}）`);
    }
    return true;
};

/**
 * 需要时生成媒体夹具。
 *
 * @returns 生成发生时为 true。
 */
const ensureFixtures = (): boolean => {
    const missing = MEDIA_FILES.filter((name) => !fs.existsSync(path.join(MEDIA_DIR, name)));
    if (missing.length === 0) {
        // 只判缺失是不够的：改了生成脚本（句数、时间轴、分辨率）而产物还在，
        // 用例会继续对着与文档契约不符的旧夹具跑。
        const generatorMtime = fileMtime(path.join('qa', 'fixtures', 'make-fixtures.mjs'));
        const fixtureMtime = fileMtime(path.join('qa', 'fixtures', 'media', 'qa-bilingual.srt'));
        if (fixtureMtime >= generatorMtime) {
            return false;
        }
    }
    const result = spawnSync(process.execPath, [path.join(projectDir, 'qa', 'fixtures', 'make-fixtures.mjs')], {
        cwd: projectDir,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error(`媒体夹具生成失败（exit ${result.status}）：缺 ${missing.join('、')}`);
    }
    return true;
};

/**
 * Playwright globalSetup 入口。
 *
 * @returns 备料完成后结束。
 */
export default function globalSetup(): void {
    const built = ensureBuild();
    const mobile = ensureMobileWeb();
    const fixtures = ensureFixtures();
    console.log(
        `[qa] 备料完成：${built ? '已重建 .vite' : '.vite 是最新的'}，`
        + `${mobile ? '已重建手机页' : '手机页是最新的'}，`
        + `${fixtures ? '已生成媒体夹具' : '媒体夹具已存在'}`,
    );
}
