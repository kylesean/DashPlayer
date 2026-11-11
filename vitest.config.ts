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
        // 控制器层（薄壳 + IPC 边界）单独设更高的防倒退底线。
        // 2026-11 实测：lines 56.97% / stmts 43.26% / funcs 15.96%（routeContract
        // 覆盖注册链路、registerRoute 测试覆盖校验与日志语义，handler 体未执行属常态）。
        // 新增控制器若不接入 routeContract 契约测试，本文件 0% 覆盖会把这里拉到阈值下报红。
        'src/backend/controllers/**': {
          lines: 55,
          statements: 40,
          functions: 14,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
