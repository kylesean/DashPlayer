import { readPackagedApp } from './packaged-app';

/**
 * 打包冒烟的 globalSetup：只校验产物存在，不做构建。
 *
 * 真正的打包由 `pnpm run test:e2e:packaged` 的前置脚本完成；这里失败时给出明确提示，
 * 避免 Playwright 报一个「找不到 Electron」的泛化错误。
 */
export default function packagedGlobalSetup(): void {
    const packaged = readPackagedApp();
    console.log(`[qa] 打包冒烟使用：${packaged.executablePath}`);
}
