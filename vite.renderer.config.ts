import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

import { DESKTOP_CONTENT_SECURITY_POLICY } from './src/common/constants/content-security-policy';

const reactCompilerEnv = process.env.REACT_COMPILER?.toLowerCase();
const enableReactCompiler =
    reactCompilerEnv !== '0' && reactCompilerEnv !== 'false' && reactCompilerEnv !== 'off';

/**
 * 生产构建时给页面注入 CSP。
 *
 * 只在 build 生效（apply: 'build'）：开发模式的页面由 Vite dev server 提供，
 * 热更新需要内联脚本与 websocket 连接，套上生产策略会直接跑不起来。
 */
const contentSecurityPolicy = () => ({
    name: 'dashplayer-content-security-policy',
    apply: 'build' as const,
    transformIndexHtml: () => ({
        tags: [
            {
                tag: 'meta',
                attrs: {
                    'http-equiv': 'Content-Security-Policy',
                    content: DESKTOP_CONTENT_SECURITY_POLICY,
                },
                injectTo: 'head-prepend' as const,
            },
        ],
    }),
});

// https://vitejs.dev/config
export default defineConfig({
    plugins: [
        tailwindcss(),
        contentSecurityPolicy(),
        react(
            enableReactCompiler
                ? {
                    babel: {
                        plugins: ['babel-plugin-react-compiler'],
                    },
                }
                : undefined
        ),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
