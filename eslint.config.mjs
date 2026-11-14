import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'vite.*.config.ts',
            'src/frontend/components/ui/**',
            // astryx theme build 的产物（.js / .d.ts / variants），由主题源文件编译生成，不参与源码 lint
            'src/themes/**/*.js',
            'src/themes/**/*.d.ts',
            'node_modules/**',
            '.vite/**',
            'out/**',
            '**/*.md',
            'dist/**',
            'build/**',
            // Playwright 运行产物（trace viewer 等打包脚本），由 E2E 自动生成，不参与源码 lint
            'qa/playwright-report/**',
            'qa/playwright-report-packaged/**',
            'qa/test-results/**',
            'qa/test-results-packaged/**',
            'qa/fixtures/media/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    importX.flatConfigs.recommended,
    importX.flatConfigs.electron,
    importX.flatConfigs.typescript,
    reactPlugin.configs.flat.recommended,
    reactPlugin.configs.flat['jsx-runtime'],
    reactHooks.configs.flat.recommended,
    jsxA11y.flatConfigs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2025,
            },
        },
        settings: {
            'import-x/resolver-next': [
                createTypeScriptImportResolver({
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                }),
                importX.createNodeResolver(),
            ],
            react: {
                version: 'detect',
            },
        },
        rules: {
            'no-mixed-spaces-and-tabs': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            'react/react-in-jsx-scope': 'off',
            'react/jsx-uses-react': 'off',
            'jsx-a11y/anchor-is-valid': 'warn',
            'jsx-a11y/click-events-have-key-events': 'warn',
            'jsx-a11y/mouse-events-have-key-events': 'warn',
            'jsx-a11y/no-static-element-interactions': 'warn',
            'jsx-a11y/no-noninteractive-tabindex': 'warn',
            'jsx-a11y/label-has-associated-control': 'warn',
            'jsx-a11y/alt-text': 'warn',
        },
    },
    {
        // 功能模块内禁止直接调用底层跨进程客户端，也不允许引入测试资产。
        files: ['src/frontend/features/**/*.{ts,tsx}'],
        ignores: ['src/frontend/features/**/*Api.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@/frontend/infrastructure/electron/backendClient',
                            message: '业务调用请收口到当前 feature 的 *Api.ts 文件。',
                        },
                    ],
                    patterns: [
                        {
                            group: ['qa/**', '../qa/**', '../../qa/**', '../../../qa/**'],
                            message: '产品代码不许 import qa/ 下的用例资产。',
                        },
                    ],
                },
            ],
        },
    },
    {
        // 非功能模块源码禁止引入端到端测试目录下的文件。
        files: ['src/**/*.{ts,tsx}'],
        ignores: ['src/frontend/features/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['qa/**', '../qa/**', '../../qa/**', '../../../qa/**'],
                            message: '产品代码不许 import qa/ 下的用例资产。',
                        },
                    ],
                },
            ],
        },
    },
    {
        // 端到端测试只能引用公共层类型与常量，不允许耦合产品内部实现。
        files: ['qa/**/*.{ts,tsx,mjs,js}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@/frontend',
                                '@/frontend/**',
                                '@/backend',
                                '@/backend/**',
                                '@/app',
                                '@/app/**',
                                '@/test',
                                '@/test/**',
                            ],
                            message:
                                'qa/ 只依赖 @/common 的类型与常量：运行期契约走 window.__dpDebug 与 URL 参数，不许直接读产品内部实现（产品一重构，用例就跟着烂）。',
                        },
                        {
                            group: [
                                '**/src/frontend/**',
                                '**/src/backend/**',
                                '**/src/app/**',
                                '**/src/test/**',
                            ],
                            message: 'qa/ 不许用相对路径绕到 src 的内部实现；只允许 ../../src/common/**。',
                        },
                    ],
                },
            ],
            'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
            'react-hooks/rules-of-hooks': 'off',
        },
    },
    {
        // 单元测试禁止遗留独占聚焦调用或无条件跳过。
        files: ['src/**/__tests__/**/*.{ts,tsx,js,jsx}', 'src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "CallExpression[callee.object.name=/^(describe|it|test)$/][callee.property.name='only']",
                    message: '禁止提交 describe.only / it.only / test.only，调试完请移除。',
                },
                {
                    selector:
                        "CallExpression[callee.object.name=/^(describe|it|test)$/][callee.property.name='skip']",
                    message: '禁止无条件 describe.skip / it.skip / test.skip；环境门控请使用 skipIf(condition)。',
                },
            ],
        },
    },
);
