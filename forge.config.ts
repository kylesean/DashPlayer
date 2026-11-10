import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerWix } from '@electron-forge/maker-wix';
// Forge 官方没有 AppImage maker，使用社区维护的 ReForged 实现（覆盖 Arch/NixOS 等无 deb/rpm 的发行版）
import { MakerAppImage } from '@reforged/maker-appimage';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import MakerDMG from '@electron-forge/maker-dmg';
import packageJson from './package.json';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * 判断路径是否存在（fs/promises 没有 exists）。
 *
 * @param target 待检查的绝对路径。
 * @returns 路径存在时返回 true。
 */
const pathExists = async (target: string): Promise<boolean> => {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
};

/**
 * 打包时裁掉非目标平台/架构的原生库变体。
 *
 * 背景：better-sqlite3 的 prebuilds 与历史 bin 目录会把异平台/异架构的原生库
 * 一起装进 node_modules；这些异架构 ELF 会让 Linux RPM 打包阶段的 brp-strip
 * 报 "Unable to recognise the format" 而整包失败，并显著增大安装包体积。
 *
 * @param buildPath 打包暂存目录（应用根目录）。
 * @param platform 目标平台（darwin/linux/win32/mas）。
 * @param arch 目标架构（x64/arm64/ia32）。
 */
const pruneForeignNativeVariants = async (buildPath: string, platform: string, arch: string): Promise<void> => {
    // mac App Store 构建的原生库目录名与 darwin 一致
    const nativePlatform = platform === 'mas' ? 'darwin' : platform;

    const drop = async (target: string): Promise<void> => {
        if (!await pathExists(target)) return;
        await fs.rm(target, { recursive: true, force: true });
        console.log(`[prune-native] 移除 ${path.relative(buildPath, target)}`);
    };

    // better-sqlite3@13：prebuilds/<platform>-<arch>.node 只保留目标平台架构
    const sqlitePrebuildsRoot = path.join(buildPath, 'node_modules/better-sqlite3/prebuilds');
    if (await pathExists(sqlitePrebuildsRoot)) {
        const expectedPrebuild = `${nativePlatform}-${arch}.node`;
        for (const variant of await fs.readdir(sqlitePrebuildsRoot)) {
            if (variant === expectedPrebuild) continue;
            await drop(path.join(sqlitePrebuildsRoot, variant));
        }
    }

    // better-sqlite3 旧版目录结构兼容：bin/<platform>-<arch>-<abi> 只保留目标组合
    const sqliteBinRoot = path.join(buildPath, 'node_modules/better-sqlite3/bin');
    if (await pathExists(sqliteBinRoot)) {
        for (const variant of await fs.readdir(sqliteBinRoot)) {
            if (variant.startsWith(`${nativePlatform}-${arch}-`)) continue;
            await drop(path.join(sqliteBinRoot, variant));
        }
    }
};

/**
 * 把 mac 打包产物就地重签为有效的 ad-hoc 签名。
 *
 * 背景：未配置 osxSign 时，electron-packager 的产物保留 Electron 预编译二进制的
 * ad-hoc 签名（identifier=com.github.Electron），而打包阶段对 Info.plist 的改写
 * （应用名、extendInfo 用途声明）让这份签名失效（codesign --verify 报
 * invalid Info.plist）。macOS 对签名无效的应用直接拒绝麦克风等 TCC 授权：
 * 不弹授权框、系统设置里不出现条目、也不留拒绝记录，授权状态一律 denied。
 * ad-hoc 重签后系统才会正常弹授权框；identifier 会自动取 Info.plist 的 bundle id。
 *
 * @param packageResult postPackage 提供的打包结果（平台与产物目录；mac 的 .app 在目录内）。
 */
const adhocResignMacApp = async (packageResult: { platform: string; outputPaths: string[] }): Promise<void> => {
    if (packageResult.platform !== 'darwin') return;
    for (const outputPath of packageResult.outputPaths) {
        const appBundles = (await fs.readdir(outputPath)).filter((entry) => entry.endsWith('.app'));
        if (appBundles.length === 0) {
            throw new Error(`mac 产物目录里没有 .app：${outputPath}`);
        }
        for (const bundle of appBundles) {
            const appPath = path.join(outputPath, bundle);
            console.log(`[mac-sign] ad-hoc 重签 ${appPath}`);
            await execFileAsync('codesign', ['--force', '--deep', '--sign', '-', appPath]);
        }
    }
};

const config: ForgeConfig = {
    packagerConfig: {
        // `@electron-forge/plugin-vite` defaults to packaging only `/.vite/**`.
        // DashPlayer has runtime deps (incl. native modules) that must ship with the app.
        // Keep the package small by still ignoring everything else.
        ignore: (file: string) => {
            if (!file) return false;
            if (file.startsWith('/.vite')) return false;
            if (file === '/node_modules') return false;

            // 仅保留 Vite externalized 的原生依赖与运行时网络代理传递依赖，其余由 Vite 打入 /.vite
            const keptNodeModulePrefixes = [
                '/node_modules/better-sqlite3',
                '/node_modules/node-addon-api',
                '/node_modules/undici',
                '/node_modules/fetch-socks',
                '/node_modules/socks',
                '/node_modules/smart-buffer',
                '/node_modules/ip-address',
                '/node_modules/ipaddr.js',
            ];

            // ignore 返回 true 时 electron-packager 会连整棵子树一起跳过，
            // 所以除了白名单路径自身，还必须放行它的所有祖先目录（兼容 scoped 包）。
            for (const prefix of keptNodeModulePrefixes) {
                const normalized = prefix.replace(/\/+$/, '');
                if (file === normalized
                    || file.startsWith(`${normalized}/`)
                    || normalized.startsWith(`${file}/`)) {
                    return false;
                }
            }

            return true;
        },
        asar: {
            // 原生库必须解到 app.asar.unpacked：dyld/ld.so 读不了 asar 内部，
            // 原生 .node 绑定按自身目录解析动态库（@rpath / 导入表），只解包
            // .node 会导致 dlopen/LoadLibrary 找不到依赖库而启动即崩。
            unpack: '**/*.{wasm,node,dylib,dll,so,so.*}',
        },
        icon: './assets/icons/icon',
        // macOS 10.15+ 的 TCC 隐私授权：应用 Info.plist 里声明了用途说明，系统才会在
        // 首次 getUserMedia 时弹出麦克风授权框；缺这一条时不弹框、请求直接被拒，
        // 打包版配音录音会报"麦克风权限被拒绝"（开发环境用的是 Electron 壳自身的授权，
        // 所以只在安装包里复现）。用途文案会原样显示在系统弹框里。
        extendInfo: {
            NSMicrophoneUsageDescription: 'DashPlayer 需要使用麦克风录制配音音频。',
        },
        // extraResource 的内容落在 app.asar 之外（安装目录下 <app>/resources/），因此**不受**
        // asar 完整性校验（EnableEmbeddedAsarIntegrityValidation）与 OnlyLoadAppFromAsar 保护：
        // 这里只放运行时确实要用的东西。
        // - ./drizzle：数据库迁移 SQL（src/backend/infrastructure/db/migrate.ts 读它）。
        // - ./resources：随包静态资源（预置词典、移动端页面、默认词表等）。
        // - ./lib：ffmpeg / ffprobe 等**运行时会被 spawn 执行的二进制**。asar 内部的路径
        //   没法被 dyld / ld.so 加载（可执行文件必须真实存在于文件系统上），所以这些二进制
        //   只能留在 asar 之外。代价是它们不在 asar 完整性校验的覆盖范围内，供应链安全要靠
        //   scripts/download.mjs 下载时的 SHA-256 校验来保证（见 scripts/ffmpeg-runtime-meta.mjs）。
        // 刻意**不**再打包 ./scripts：那里只有构建期工具（download.mjs、build-dictionary.mjs、
        // download-fonts.mjs、build-mobile-icons.mjs、network-retry.mjs、whisper-runtime-meta.mjs），
        // 运行时没有任何代码读取或执行它们（唯一的跨文件引用是 CI 工作流 whisper-runtime.yml 在
        // **构建期**读仓库里的 whisper-runtime-meta.mjs，CI 从源码仓库跑，不读安装包）。
        // 继续打包只会徒增安装包体积，并把构建期工具暴露在用户的安装目录里。
        extraResource: ['./drizzle', './lib', './resources'],
        // Linux 命名统一为不带横杠的 dashplayer：此处 executableName、各 Linux maker 的
        // name/bin 与 package.json 的 desktopName 必须一致，桌面环境才能把窗口（Wayland
        // app_id / X11 WM_CLASS）匹配到安装包里的 dashplayer.desktop，否则 Dock 只显示通用占位图标。
        executableName: 'dashplayer',
        name: 'DashPlayer',
    },
    rebuildConfig: {},
    makers: [
        new MakerSquirrel({
            name: 'DashPlayer',
            // 安装动画只在安装耗时超过 4 秒（且非静默安装）时才弹出；窗口尺寸等于 GIF 的像素尺寸，
            // 且窗口全透明，所以素材必须是自带白色圆角卡片、圆角外全透明的图（详见 Squirrel 的 AnimatedGifWindow）。
            // install.gif 即按此约定生成：8 帧 × 250ms，325×339，四角透明。
            loadingGif: './assets/icons/install.gif',
            setupIcon: './assets/icons/icon.ico',
            iconUrl: 'https://raw.githubusercontent.com/kylesean/DashPlayer/main/assets/icons/icon.ico',
        }),
        // DMG 窗口尺寸由 1x 背景图的像素尺寸决定（appdmg 读 background.png 的宽高当窗口大小，
        // background@2x.png 仅用于 retina 渲染），因此下面两个图标坐标用的就是背景图那套 640x500 坐标，
        // 必须与图上箭头对齐：箭头中心约 (341, 226)，两个图标各留一段间距对称摆在箭头两侧。
        new MakerDMG({
            icon: './assets/icons/icon.icns',
            format: 'ULFO',
            background: './assets/dmg/background.png',
            iconSize: 96,
            contents: (opts) => [
                { x: 160, y: 226, type: 'file', path: opts.appPath },
                { x: 480, y: 226, type: 'link', path: '/Applications' },
            ],
        }),
        new MakerRpm({
            options: {
                name: 'dashplayer',
                bin: 'dashplayer',
                productName: 'DashPlayer',
                icon: './assets/icons/icon.png',
            },
        }),
        new MakerDeb({
            options: {
                name: 'dashplayer',
                bin: 'dashplayer',
                productName: 'DashPlayer',
                icon: './assets/icons/icon.png',
            },
        }),
        // AppImage：单文件免安装格式，产物命名 DashPlayer-<version>-<arch>.AppImage。
        // bin 必须与 packagerConfig.executableName 一致，maker 会按它校验打包产物内的可执行文件。
        // icon 给出 hicolor 多尺寸集合，maker 自动把最大尺寸作为 .DirIcon 默认图标。
        new MakerAppImage({
            options: {
                name: 'dashplayer',
                bin: 'dashplayer',
                productName: 'DashPlayer',
                icon: {
                    '16x16': './assets/icons/16x16.png',
                    '24x24': './assets/icons/24x24.png',
                    '32x32': './assets/icons/32x32.png',
                    '48x48': './assets/icons/48x48.png',
                    '64x64': './assets/icons/64x64.png',
                    '128x128': './assets/icons/128x128.png',
                    '256x256': './assets/icons/256x256.png',
                },
                categories: ['AudioVideo', 'Video'],
            },
        }),
        new MakerWix({
            name: 'DashPlayer',
            description: 'A video player for English learning',
            manufacturer: 'kylesean',
            version: packageJson.version,
            icon: './assets/icons/icon.ico',
            exe: 'dashplayer.exe',
            ui: {
                chooseDirectory: true,
            },
        }),
    ],
    plugins: [
        new VitePlugin({
            build: [
                { entry: 'src/main.ts', config: 'vite.main.config.ts' },
                { entry: 'src/preload.ts', config: 'vite.preload.config.ts' },
            ],
            renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
        }),
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            // 刻意**不**启用 EnableEmbeddedAsarIntegrityValidation：
            // 1) 该 fuse 依赖有效的代码签名——macOS 需要 Developer ID 签名、Windows 需要
            //    Authenticode 签名。Electron 的 asar 完整性元数据（resources 里的
            //    ElectronAsarIntegrity）由签名/资源元数据承载，没有签名就没有可校验的 blob。
            // 2) 本项目当前没有任何正式签名：packagerConfig 里没有 osxSign，Windows 也没有
            //    certificateFile / sign，release.yml 里同样没有签名步骤；macOS 只有
            //    postPackage 里的 ad-hoc 重签（codesign --force --deep --sign -）。
            // 3) 因此该 fuse 在当前发布流程下无法生效：macOS 的 ad-hoc 重签会破坏 resources
            //    元数据（ElectronAsarIntegrity 就在里面），签名一变校验必然失败；Windows 更
            //    是没有 Authenticode 签名，一旦开启，启动阶段的完整性校验会直接失败、应用起不来。
            // 4) 未来接入正式签名（macOS Developer ID + notarization、Windows Authenticode）后，
            //    应把 EnableEmbeddedAsarIntegrityValidation 重新设为 true，并确认签名/重签
            //    发生在 fuses 翻转之后且不会破坏 resources 元数据。
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
    publishers: [
        {
            name: '@electron-forge/publisher-github',
            config: {
                repository: { owner: 'kylesean', name: 'DashPlayer' },
            },
        },
    ],
    hooks: {
        // 在 asar 打包前：裁掉异平台/异架构原生库（同时避免 Linux RPM 的 brp-strip 失败）
        packageAfterCopy: async (_forgeConfig, buildPath, _electronVersion, platform, arch) => {
            await pruneForeignNativeVariants(buildPath, platform, arch);
        },
        // 把 mac 产物重签为有效 ad-hoc 签名（否则 TCC 麦克风授权静默失败，见函数注释）
        postPackage: async (_forgeConfig, packageResult) => {
            await adhocResignMacApp(packageResult);
        },
        postMake: async (_forgeConfig, makeResults) => {
            const version = packageJson.version;
            for (const result of makeResults) {
                if (result.platform !== 'win32') continue;
                for (let i = 0; i < result.artifacts.length; i++) {
                    const oldPath = result.artifacts[i];
                    if (!oldPath.toLowerCase().endsWith('.msi')) continue;
                    const dir = path.dirname(oldPath);
                    const arch = result.arch; // 'x64' | 'ia32' | 'arm64'
                    const newPath = path.join(dir, `DashPlayer-${version}-${arch}.msi`);
                    if (oldPath !== newPath) {
                        await fs.rename(oldPath, newPath);
                        // 更新 artifacts，确保 Publisher 上传重命名后的文件
                        result.artifacts[i] = newPath;
                        console.log(`Renamed MSI: ${oldPath} -> ${newPath}`);
                    }
                }
            }
            return makeResults;
        },
    },
};

export default config;
