import { describe, expect, it } from 'vitest';
import {
    DESKTOP_CONTENT_SECURITY_POLICY,
    META_IGNORED_CSP_DIRECTIVES,
} from '@/common/constants/content-security-policy';

describe('桌面渲染进程的 CSP', () => {
    it('默认来源只允许同源', () => {
        expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    });

    it('脚本只允许同源，不放开 unsafe-inline 与 unsafe-eval', () => {
        const scriptSrc = DESKTOP_CONTENT_SECURITY_POLICY
            .split(';')
            .map((directive) => directive.trim())
            .find((directive) => directive.startsWith('script-src'));
        expect(scriptSrc).toBeDefined();
        expect(scriptSrc).toContain("'self'");
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(scriptSrc).not.toContain("'unsafe-eval'");
    });

    it('本地媒体与缩略图走 media: 协议', () => {
        const imgSrc = DESKTOP_CONTENT_SECURITY_POLICY
            .split(';')
            .map((directive) => directive.trim())
            .find((directive) => directive.startsWith('img-src'));
        expect(imgSrc).toContain('media:');
        expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain('media-src');
        expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain('media:');
    });

    it('渲染进程不直连外部网络', () => {
        const connectSrc = DESKTOP_CONTENT_SECURITY_POLICY
            .split(';')
            .map((directive) => directive.trim())
            .find((directive) => directive.startsWith('connect-src'));
        expect(connectSrc).toBe("connect-src 'self'");
    });

    it('关掉 object、base 与 form', () => {
        expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
        expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
        expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
    });

    it('不包含经 meta 投递时会被忽略的指令', () => {
        // 这份策略唯一的投递通道是构建期注入的 <meta http-equiv>，
        // 而 frame-ancestors / report-uri / sandbox 在 meta 里按规范被忽略。
        // 留着它们不会多一层防护，只会每次加载丢一条 console 错误、
        // 并让读代码的人误判这一层已经有人管了。
        for (const directive of META_IGNORED_CSP_DIRECTIVES) {
            expect(DESKTOP_CONTENT_SECURITY_POLICY).not.toContain(directive);
        }
    });

    it('不放行任何通配来源', () => {
        expect(DESKTOP_CONTENT_SECURITY_POLICY).not.toContain('*');
        expect(DESKTOP_CONTENT_SECURITY_POLICY).not.toContain('http:');
    });
});
