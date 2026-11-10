#!/usr/bin/env node
/**
 * 生成 e2e 运行所需的生产构建产物（.vite/build 与 .vite/renderer/main_window）。
 *
 * 为什么不用 `electron-forge package`：
 * - 打包产物会被 FusesPlugin 关闭 `--inspect` 等 Node 调试参数（EnableNodeCliInspectArguments: false），
 *   Playwright 驱动 Electron 依赖主进程 inspector，无法接管打包版；
 * - 打包还要求 extraResource 里的 lib/ 已由 `pnpm run download` 生成，
 *   而 e2e 用例不需要 ffmpeg/whisper 运行时，不应为跑用例触发大体积下载。
 *
 * 因此这里复用 forge Vite 插件的构建逻辑（与 `electron-forge package` 的
 * prePackage 构建同源），只产出 .vite 产物，由 Playwright 以开发态（electron .）启动。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as vite from 'vite';

const require = createRequire(import.meta.url);
const projectDir = fileURLToPath(new URL('../../', import.meta.url));

// forge.config.ts 与 build-manifest.ts 都是 TS，用 ts-node 以 CJS 方式加载
// （与 forge CLI 的加载方式一致）
require('ts-node').register({
    transpileOnly: true,
    compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
});
const {
    BUILD_MANIFEST_FILE,
    writeBuildManifest,
    computeBuildInputDigest,
} = require(path.join(projectDir, 'qa/support/build-manifest.ts'));

// plugin-vite 的构建入口不在包 exports 里，只能按文件路径加载；
// plugin-vite 升级导致内部结构变化时这里会直接失败，不会静默产出错误产物。
const vitePluginDist = path.dirname(require.resolve('@electron-forge/plugin-vite'));
const ViteConfigGenerator = require(path.join(vitePluginDist, 'ViteConfig.js')).default;

const forgeConfig = require(path.join(projectDir, 'forge.config.ts')).default;
const vitePlugin = forgeConfig.plugins.find((plugin) => plugin.name === 'vite');
if (!vitePlugin) {
    throw new Error('forge.config.ts 中未找到 VitePlugin');
}

const outDir = path.join(projectDir, '.vite');
const tempDir = path.join(projectDir, `.vite.tmp-${process.pid}`);
const backupDir = path.join(projectDir, `.vite.old-${process.pid}`);
await fs.rm(tempDir, { recursive: true, force: true });
await fs.mkdir(tempDir, { recursive: true });

// isProd = true 与打包时的构建完全一致：渲染端不再注入 dev server 地址，
// 主进程会从 .vite/renderer/main_window/index.html 加载页面。
const generator = new ViteConfigGenerator(vitePlugin.config, projectDir, true);
const configs = [...(await generator.getBuildConfigs()), ...(await generator.getRendererConfig())];

try {
    const inputDigestBeforeBuild = computeBuildInputDigest(projectDir);
    for (const config of configs) {
        const relativeOutDir = config.build?.outDir
            ? path.relative(outDir, path.resolve(projectDir, config.build.outDir))
            : '';
        if (!relativeOutDir || relativeOutDir.startsWith('..')) {
            throw new Error(`无法把 Vite 输出目录重定向到临时目录：${String(config.build?.outDir)}`);
        }
        await vite.build({
            ...config,
            build: {
                ...config.build,
                outDir: path.join(tempDir, relativeOutDir),
                emptyOutDir: false,
            },
            // 防止再次加载用户 vite 配置造成递归
            configFile: false,
            logLevel: 'warn',
            clearScreen: false,
        });
    }
    writeBuildManifest(projectDir, tempDir);
    const manifestPath = path.join(tempDir, BUILD_MANIFEST_FILE);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.inputDigest !== inputDigestBeforeBuild) {
        throw new Error('构建期间源码发生变化，产物与输入摘要不一致，请重试');
    }

    // 先备份旧产物，全部成功后一次性换上新产物；任一步失败都保留旧 `.vite`，
    // 避免「构建到一半把可用产物删了」。
    await fs.rm(backupDir, { recursive: true, force: true });
    if (await fs.stat(outDir).then(() => true).catch(() => false)) {
        await fs.rename(outDir, backupDir);
    }
    await fs.rename(tempDir, outDir);
    await fs.rm(backupDir, { recursive: true, force: true });
} catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    // 旧产物已经搬到 backup、但新产物还没换上去时，必须把旧产物还原；
    // 否则一次构建失败会把原本可用的 `.vite` 直接弄丢。
    if (await fs.stat(backupDir).then(() => true).catch(() => false)) {
        if (!(await fs.stat(outDir).then(() => true).catch(() => false))) {
            await fs.rename(backupDir, outDir);
        } else {
            await fs.rm(backupDir, { recursive: true, force: true });
        }
    }
    throw error;
}

console.log('[qa] 构建完成：.vite/build + .vite/renderer/main_window');
