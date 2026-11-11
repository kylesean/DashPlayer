import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // 测试与脚手架本身不计入
        'src/**/*.{test,spec}.*',
        'src/test/**',
        'src/mobile/**',
        // 类型与纯常量声明
        'src/**/*.d.ts',
      ],
      // 覆盖率基线（2026-11 实测，口径为 src 全部源码含未测试文件按 0% 计入：
      // lines 28.7% / stmts 28.0% / funcs 22.4% / branches 22.3%，各留 1-2 个点余量防环境抖动）。
      // 只防倒退，不追高；核心服务的编排层测试补齐后同步上调。
      thresholds: {
        lines: 27,
        statements: 26,
        functions: 21,
        branches: 20,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
