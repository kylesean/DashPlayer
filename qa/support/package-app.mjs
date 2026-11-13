#!/usr/bin/env node
/**
 * 用 QA 专用 Forge 配置打包一次，并写下游标清单。
 *
 * 为什么直接调 `@electron-forge/core` API 而不是 CLI：Forge CLI 没有 `--config` 参数，
 * 只能读固定文件名 `forge.config.ts`。这里用 `registerForgeConfigForDirectory` 注册
 * 虚拟配置，不改 package.json，也不在正式配置里塞 QA 分支。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { api, utils } from '@electron-forge/core';

const projectDir = fileURLToPath(new URL('../../', import.meta.url));
const requireTs = createRequire(path.join(projectDir, 'package.json'));
requireTs('ts-node').register({
    transpileOnly: true,
    compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
});
const qaConfig = requireTs(path.join(projectDir, 'forge.qa.config.ts')).default;

const outDir = path.join(projectDir, 'out', 'qa-package');
utils.registerForgeConfigForDirectory(projectDir, qaConfig);
// 清掉上次的产物与清单：打包失败时不能让旧清单把 packaged 用例指向一份过期应用。
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

/**
 * 在 packager 输出目录里找可执行文件。
 *
 * @param outputPath packager 输出目录。
 * @param platform 目标平台。
 * @param executableName 可执行文件名（Linux/mac 不带扩展名）。
 * @returns 可执行文件绝对路径。
 */
function findExecutable(outputPath, platform, executableName) {
    if (platform === 'darwin') {
        const appPath = outputPath.endsWith('.app')
            ? outputPath
            : (() => {
                const appBundle = fs.readdirSync(outputPath).find((entry) => entry.endsWith('.app'));
                if (!appBundle) {
                    throw new Error(`mac 输出目录里没有 .app：${outputPath}`);
                }
                return path.join(outputPath, appBundle);
            })();
        const macDir = path.join(appPath, 'Contents', 'MacOS');
        const binary = fs.readdirSync(macDir)[0];
        if (!binary) {
            throw new Error(`mac .app 的 Contents/MacOS 为空：${macDir}`);
        }
        return path.join(macDir, binary);
    }
    const fileName = platform === 'win32'
        ? (executableName.endsWith('.exe') ? executableName : `${executableName}.exe`)
        : executableName;
    const candidate = path.join(outputPath, fileName);
    if (!fs.existsSync(candidate)) {
        throw new Error(`打包产物里找不到可执行文件：${candidate}`);
    }
    return candidate;
}

const results = await api.package({
    dir: projectDir,
    interactive: false,
    outDir,
});
const result = results[0];
if (!result?.packagedPath) {
    throw new Error('Forge package 没有返回 packagedPath');
}

const executableName = qaConfig.packagerConfig?.executableName ?? 'refrain';
const executablePath = findExecutable(result.packagedPath, result.platform, executableName);
const manifest = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    platform: result.platform,
    arch: result.arch,
    outputPath: result.packagedPath,
    appPath: result.packagedPath,
    executablePath,
};
fs.writeFileSync(
    path.join(outDir, 'packaged-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
);
console.log(`[qa] 打包完成：${executablePath}`);
