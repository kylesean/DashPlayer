import type { ForgeConfig } from '@electron-forge/shared-types';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options } from '@electron/fuses';
import baseConfig from './forge.config';

/**
 * QA 专用打包配置：只把 `EnableNodeCliInspectArguments` 打开。
 *
 * Playwright 驱动 Electron 必须注入 `--inspect=0`；正式发布包关闭该 fuse 是正确安全策略，
 * 因此不能为了 QA 放宽产品配置。其余 fuse、asar、extraResource、maker 配置完全继承
 * forge.config.ts，nightly 冒烟测到的仍是同一套打包形态。
 */
const qaPlugins = (baseConfig.plugins ?? []).map((plugin) => {
    if (plugin.name !== 'fuses') {
        return plugin;
    }
    const fusesPlugin = plugin as FusesPlugin;
    return new FusesPlugin({
        ...fusesPlugin.fusesConfig,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
    });
});

const qaConfig: ForgeConfig = {
    ...baseConfig,
    plugins: qaPlugins,
};

export default qaConfig;
