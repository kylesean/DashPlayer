import fs from 'node:fs';
import path from 'node:path';

/** 打包产物清单。 */
export interface PackagedAppManifest {
    schemaVersion: number;
    builtAt: string;
    platform: string;
    arch: string;
    outputPath: string;
    appPath: string;
    executablePath: string;
}

/** 清单路径（package-app.mjs 写入）。 */
const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'out', 'qa-package', 'packaged-manifest.json');

/**
 * 读取并校验打包产物清单。
 *
 * @returns 打包产物清单。
 */
export function readPackagedApp(): PackagedAppManifest {
    if (!fs.existsSync(MANIFEST_PATH)) {
        throw new Error(
            `打包产物清单不存在：${MANIFEST_PATH}。`
            + '先运行 `pnpm run test:e2e:packaged`（它会先打包），不要直接跑 packaged 配置。',
        );
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as PackagedAppManifest;
    if (manifest.schemaVersion !== 1) {
        throw new Error(`打包产物清单版本不支持：${manifest.schemaVersion}`);
    }
    if (!fs.existsSync(manifest.executablePath)) {
        throw new Error(`打包产物可执行文件不存在：${manifest.executablePath}`);
    }
    return manifest;
}
