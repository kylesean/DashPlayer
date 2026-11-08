import { defineConfig } from 'vite';
import path from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
    build: {
        // https://github.com/electron/forge/issues/3398
        sourcemap: true,
        target: 'node20',
        rollupOptions: {
            external: [
                // 原生模块与不可直接打包的运行时依赖（通过 Forge 打包进 node_modules 目录）
                'better-sqlite3',
                // 网络代理基础设施（运行时从 node_modules 加载）
                'undici',
                'fetch-socks',
                'ipaddr.js',
            ],
            output: {
                strict: false,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
