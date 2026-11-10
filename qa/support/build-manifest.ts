import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `.vite` 构建清单。
 *
 * 只比较入口文件 mtime 无法证明「这份产物就是当前源码构建的」：开发态构建、
 * 手工替换的文件、只更新了渲染端的一半产物，都可能让 e2e 对着旧代码或 dev server
 * 跑出假绿。这里把构建输入摘要与全部产物摘要一起写进清单，globalSetup 必须
 * 逐项校验通过才允许启动用例。
 */
export const BUILD_MANIFEST_FILE = '.qa-build-manifest.json';
export const BUILD_MANIFEST_SCHEMA_VERSION = 1;
export const BUILD_MODE_PRODUCTION = 'production';

/** 参与构建的源码/资源目录。 */
export const BUILD_INPUT_DIRS = ['src', 'assets'] as const;

/** 参与构建的单文件。 */
export const BUILD_INPUT_FILES = [
    'vite.main.config.ts',
    'vite.preload.config.ts',
    'vite.renderer.config.ts',
    'vite.mobile.config.ts',
    'forge.config.ts',
    'index.html',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'qa/support/build.mjs',
    'qa/support/build-manifest.ts',
] as const;

/** 单个构建输入或产物。 */
export interface BuildFileDigest {
    /** 相对 `.vite`（产物）或仓库根（输入）的 POSIX 路径。 */
    path: string;
    size: number;
    sha256: string;
}

/** 构建清单结构。 */
export interface BuildManifest {
    schemaVersion: number;
    mode: typeof BUILD_MODE_PRODUCTION;
    builtAt: string;
    /** 全部构建输入的联合摘要。 */
    inputDigest: string;
    artifacts: BuildFileDigest[];
}

/** 校验结果。 */
export interface BuildValidation {
    ok: boolean;
    reason: string;
}

/** 不进产物的单测文件；改它们不应触发应用重建。 */
const NON_PRODUCT_PATH_RE = /(__tests__[\\/]|\.(test|spec)\.)/;

/**
 * 计算文件摘要。
 *
 * @param file 文件绝对路径。
 * @returns sha256 十六进制摘要。
 */
function hashFile(file: string): string {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 递归收集参与构建的输入文件。
 *
 * @param projectDir 仓库根目录。
 * @returns 排序后的输入摘要列表。
 */
export function collectBuildInputs(projectDir: string): BuildFileDigest[] {
    const files: BuildFileDigest[] = [];
    for (const dir of BUILD_INPUT_DIRS) {
        const root = path.join(projectDir, dir);
        if (!fs.existsSync(root)) {
            continue;
        }
        const stack = [root];
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
                const relative = path.relative(projectDir, full).split(path.sep).join('/');
                files.push({
                    path: relative,
                    size: fs.statSync(full).size,
                    sha256: hashFile(full),
                });
            }
        }
    }
    for (const relative of BUILD_INPUT_FILES) {
        const full = path.join(projectDir, relative);
        if (!fs.existsSync(full)) {
            throw new Error(`构建输入缺失：${relative}`);
        }
        files.push({
            path: relative,
            size: fs.statSync(full).size,
            sha256: hashFile(full),
        });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * 计算构建输入的联合摘要。
 *
 * @param projectDir 仓库根目录。
 * @returns sha256 十六进制摘要。
 */
export function computeBuildInputDigest(projectDir: string): string {
    const hash = createHash('sha256');
    for (const input of collectBuildInputs(projectDir)) {
        hash.update(`${input.path}\0${input.size}\0${input.sha256}\n`);
    }
    return hash.digest('hex');
}

/**
 * 递归收集构建产物。
 *
 * @param root `.vite` 目录。
 * @returns 排序后的产物摘要列表（不含清单自身）。
 */
export function collectBuildArtifacts(root: string): BuildFileDigest[] {
    const artifacts: BuildFileDigest[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (entry.name === BUILD_MANIFEST_FILE) {
                continue;
            }
            artifacts.push({
                path: path.relative(root, full).split(path.sep).join('/'),
                size: fs.statSync(full).size,
                sha256: hashFile(full),
            });
        }
    }
    return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * 读取构建清单。
 *
 * @param buildRoot `.vite` 目录。
 * @returns 清单；缺失或 JSON 非法时返回 null。
 */
export function readBuildManifest(buildRoot: string): BuildManifest | null {
    const file = path.join(buildRoot, BUILD_MANIFEST_FILE);
    if (!fs.existsSync(file)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as BuildManifest;
    } catch {
        return null;
    }
}

/**
 * 生成构建清单。
 *
 * @param projectDir 仓库根目录。
 * @param buildRoot 构建根目录（`.vite` 或临时目录）。
 * @returns 清单对象。
 */
export function createBuildManifest(projectDir: string, buildRoot: string): BuildManifest {
    return {
        schemaVersion: BUILD_MANIFEST_SCHEMA_VERSION,
        mode: BUILD_MODE_PRODUCTION,
        builtAt: new Date().toISOString(),
        inputDigest: computeBuildInputDigest(projectDir),
        artifacts: collectBuildArtifacts(buildRoot),
    };
}

/**
 * 写入构建清单。
 *
 * @param projectDir 仓库根目录。
 * @param buildRoot 构建根目录（`.vite` 或临时目录）。
 */
export function writeBuildManifest(projectDir: string, buildRoot: string): void {
    const manifest = createBuildManifest(projectDir, buildRoot);
    fs.writeFileSync(
        path.join(buildRoot, BUILD_MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
    );
}

/**
 * 读取 package.json 的 `main` 入口。
 *
 * @param projectDir 仓库根目录。
 * @returns 相对仓库根的入口路径。
 */
function readPackageMain(projectDir: string): string {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')) as {
        main?: string;
    };
    if (!pkg.main) {
        throw new Error('package.json 缺少 main 字段，无法定位构建产物入口');
    }
    return pkg.main;
}

/**
 * 校验构建产物确实来自当前源码、且是生产模式构建。
 *
 * 任何一项不满足都必须重建，不能「有 main.cjs 就继续跑」：那份 main.cjs 可能
 * 正加载 `http://localhost:5173` 的 dev server，测试会对着另一套代码跑。
 *
 * @param projectDir 仓库根目录。
 * @returns 校验结果。
 */
export function validateProductionBuild(projectDir: string): BuildValidation {
    const buildRoot = path.join(projectDir, '.vite');
    const manifest = readBuildManifest(buildRoot);
    if (!manifest) {
        return { ok: false, reason: '构建清单缺失（可能是开发态构建或旧产物）' };
    }
    if (
        typeof manifest.inputDigest !== 'string'
        || !Array.isArray(manifest.artifacts)
        || manifest.artifacts.some((artifact) => (
            !artifact
            || typeof artifact.path !== 'string'
            || typeof artifact.size !== 'number'
            || typeof artifact.sha256 !== 'string'
        ))
    ) {
        return { ok: false, reason: '构建清单结构非法' };
    }
    if (manifest.schemaVersion !== BUILD_MANIFEST_SCHEMA_VERSION) {
        return { ok: false, reason: `构建清单版本不匹配：${manifest.schemaVersion}` };
    }
    if (manifest.mode !== BUILD_MODE_PRODUCTION) {
        return { ok: false, reason: `构建清单 mode=${manifest.mode}，要求 production` };
    }

    const currentDigest = computeBuildInputDigest(projectDir);
    if (currentDigest !== manifest.inputDigest) {
        return { ok: false, reason: '构建输入已变化（src/assets/构建配置）' };
    }

    const expectedMain = readPackageMain(projectDir);
    const mainFile = path.join(projectDir, expectedMain);
    if (!fs.existsSync(mainFile)) {
        return { ok: false, reason: `主进程入口不存在：${expectedMain}` };
    }

    const rendererEntry = path.join(buildRoot, 'renderer', 'main_window', 'index.html');
    if (!fs.existsSync(rendererEntry) || fs.statSync(rendererEntry).size === 0) {
        return { ok: false, reason: '渲染端入口缺失：renderer/main_window/index.html' };
    }

    let actualArtifacts: BuildFileDigest[];
    try {
        actualArtifacts = collectBuildArtifacts(buildRoot);
    } catch (error) {
        return { ok: false, reason: `产物不可读：${String(error)}` };
    }
    const expected = new Map(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
    if (expected.size !== actualArtifacts.length) {
        return {
            ok: false,
            reason: `产物数量不一致：清单 ${expected.size}，磁盘 ${actualArtifacts.length}`,
        };
    }
    for (const artifact of actualArtifacts) {
        const recorded = expected.get(artifact.path);
        if (!recorded) {
            return { ok: false, reason: `出现清单外产物：${artifact.path}` };
        }
        if (recorded.size !== artifact.size || recorded.sha256 !== artifact.sha256) {
            return { ok: false, reason: `产物内容与清单不一致：${artifact.path}` };
        }
    }

    const devServerPattern = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/;
    const buildRootForScan = path.join(buildRoot, 'build');
    let buildEntries: string[];
    try {
        buildEntries = fs.readdirSync(buildRootForScan);
    } catch (error) {
        return { ok: false, reason: `主进程产物目录不可读：${String(error)}` };
    }
    for (const name of buildEntries) {
        if (!/\.(?:c?js|html)$/.test(name)) {
            continue;
        }
        const content = fs.readFileSync(path.join(buildRootForScan, name), 'utf8');
        if (devServerPattern.test(content)) {
            return { ok: false, reason: `主进程产物含 dev server 地址：${name}` };
        }
    }
    const rendererHtml = fs.readFileSync(rendererEntry, 'utf8');
    if (devServerPattern.test(rendererHtml)) {
        return { ok: false, reason: '渲染端入口含 dev server 地址' };
    }

    return { ok: true, reason: '生产构建清单与产物校验通过' };
}
