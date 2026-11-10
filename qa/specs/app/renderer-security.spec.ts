/**
 * 渲染层安全策略的运行时校验。
 *
 * 为什么这条必须放在 e2e：`DESKTOP_CONTENT_SECURITY_POLICY` 由 `vite.renderer.config.ts`
 * 在构建期注入 `<meta http-equiv>`，而那个插件是 `apply: 'build'`——开发态完全不注入
 * （HMR 需要内联脚本与 websocket）。也就是说这条策略在任何开发运行里都不会出现，
 * 唯一能观察到它的地方就是构建产物。
 *
 * 没有这条用例，「注入插件被删/改错」和「常量与产物漂移」都只会表现为
 * 「安全策略静默消失」：页面照常工作，没人会发现少了一层闸。
 *
 * 只断言「注入了什么」，不主动制造违规去验证拦截效果：任何主动探针
 * （内联脚本、new Function）都会往控制台写一条 CSP 报错，与 fixtures 里的
 * 渲染层错误采集互相干扰，把「预期内的探针噪音」和「真正的违规」混成一类。
 * 策略语法正确即由 Chromium 执行，属浏览器契约。
 */
import { expect } from '@playwright/test';
import { test } from '../../support/fixtures';
import {
    DESKTOP_CONTENT_SECURITY_POLICY,
    META_IGNORED_CSP_DIRECTIVES,
} from '../../../src/common/constants/content-security-policy';

test.describe('渲染层安全策略', () => {
    test('[SET-SEC-01] 构建产物注入了桌面 CSP，且不含经 meta 投递会被忽略的指令 @smoke', async ({ session }) => {
        const content = await session.page.evaluate(
            () => document
                .querySelector('meta[http-equiv="Content-Security-Policy"]')
                ?.getAttribute('content') ?? null,
        );

        expect(
            content,
            '构建产物里没有 CSP meta：检查 vite.renderer.config.ts 的注入插件是否还在、是否被改成 apply: serve',
        ).not.toBeNull();
        // 与常量逐字比对：注入路径没坏，产物内容也没和源码漂移
        expect(content).toBe(DESKTOP_CONTENT_SECURITY_POLICY);

        for (const directive of META_IGNORED_CSP_DIRECTIVES) {
            expect(
                content,
                `经 meta 投递时 ${directive} 会被规范忽略，写进桌面 CSP 只会每次加载丢一条错误`,
            ).not.toContain(directive);
        }
    });
});
