/**
 * Playwright globalSetup：用例开跑前把「料」备齐。
 *
 * 备两样东西，全部按需（已有的不动），所以第一次跑和改了 src 之后跑都不需要手工命令：
 * 1. 应用构建产物 `.vite/`：缺失，或 `src/` 里有文件比构建产物新，就重新构建
 *    （Playwright 以 `electron .` 加载它；拿旧产物跑等于测旧代码，比不跑更糟）；
 * 2. 媒体夹具 `fixtures/media/`：SRT 或视频缺失就生成（工具在 `fixtures/make-fixtures.mjs`）。
 *
 * 两者都只写本地目录，不入库（媒体夹具已在 `qa/.gitignore` 里排除）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 仓库根目录（本文件在 `qa/support/` 下）。
 * 用 `__dirname` 而不是 `import.meta.url`：Playwright 把 TS 配置/初始化脚本按 CJS 转译，
 * `import.meta` 在 CJS 里不可用（会直接报 "Cannot use 'import.meta' outside a module"）。
 */
const projectDir = path.resolve(__dirname, '..', '..');

/**
 * 读取 package.json 的 `main`，即应用真正的启动入口。
 *
 * 为什么派生而不是手写：曾硬编码 `.vite/build/main.js`，而 forge 的实际产物是
 * `main.cjs`（package.json 的 `main` 就指向它）。于是 `existsSync` 永远为 false、
 * 构建 mtime 恒为 0，过期判断永远成立——每跑一次 QA 都白付一次约 25 秒的全量重建。
 *
 * @returns 相对仓库根入口路径。
 */
const readPackageMain = (): string => {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')) as {
        main?: string;
    };
    if (!pkg.main) {
        throw new Error('package.json 缺少 main 字段，无法定位构建产物入口');
    }
    return pkg.main;
};

/** 构建产物入口：存在且不比源码旧就认为构建可用。 */
const BUILD_ENTRY = path.join(projectDir, readPackageMain());

/**
 * 需要参与「过期」判断的源码目录。
 *
 * 只放真正进产物的目录。此前这里还包含 `qa/support`，于是改一句 QA 夹具的注释
 * 都会触发一次约 25 秒的全量重建——`qa/support/*.ts` 不参与应用构建，那个耦合是错的。
 * 构建脚本本身单独列进 `SOURCE_FILES`，精确到文件。
 */
const SOURCE_DIRS = ['src'];

/**
 * 只影响单测、不影响产物路径的命名特征。
 *
 * `src` 下同时住着 vitest 用例，它们不进 `.vite` 产物；把它们算进过期判断，
 * 等于「改一条单测就重建一次应用」。
 */
const NON_PRODUCT_PATH_RE = /(__tests__[\\/]|\.(test|spec)\.)/;

/**
 * 同样决定产物内容的单文件输入。
 *
 * 只比 src/ 的 mtime 是不够的：改 vite 别名、改 forge 配置、升级依赖、动 index.html
 * 都会改变产物，但 src/ 里没有任何文件变新，于是会拿旧产物跑新代码——比不跑更糟。
 */
const SOURCE_FILES = [
    'vite.main.config.ts',
    'vite.preload.config.ts',
    'vite.renderer.config.ts',
    'vite.mobile.config.ts',
    'forge.config.ts',
    'index.html',
    'package.json',
    'pnpm-lock.yaml',
    // 构建脚本自身：改了它，产物可能变，但 src/ 里没有任何文件变新
    'qa/support/build.mjs',
];

/** 媒体夹具目录与必需产物。 */
const MEDIA_DIR = path.join(projectDir, 'qa', 'fixtures', 'media');
const MEDIA_FILES = ['qa-bilingual.srt', 'qa-bilingual.mp4'];

/** 手机页产物入口；缺失时手机访问用例会以 20 秒超时失败且看不出原因。 */
const MOBILE_ENTRY = path.join(projectDir, 'resources', 'mobile', 'index.html');

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
    const buildMtime = fs.existsSync(BUILD_ENTRY) ? fs.statSync(BUILD_ENTRY).mtimeMs : 0;
    const sourceMtime = Math.max(
        ...SOURCE_DIRS.map((dir) => newestMtime(path.join(projectDir, dir))),
        ...SOURCE_FILES.map((file) => fileMtime(file)),
    );
    if (buildMtime > 0 && buildMtime >= sourceMtime) {
        return false;
    }
    const result = spawnSync(process.execPath, [path.join(projectDir, 'qa', 'support', 'build.mjs')], {
        cwd: projectDir,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error(`应用构建失败（exit ${result.status}）`);
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
    const sourceMtime = Math.max(newestMtime(path.join(projectDir, 'src', 'mobile')), fileMtime('vite.mobile.config.ts'));
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
