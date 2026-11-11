import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MOBILE_CONTENT_SECURITY_POLICY } from '../mobile-content-security-policy';

/**
 * CSP 中的内联脚本哈希必须与 src/mobile/index.html 的首屏主题脚本一致。
 * 有人改动该脚本（哪怕只加一行注释）而忘了更新 CSP 时，这里会红——
 * 否则浏览器会静默拒绝执行脚本，浅色主题用户首帧闪深色且无任何报错。
 */
describe('手机页 CSP 与内联脚本哈希一致性', () => {
    it('index.html 首屏内联脚本的 sha256 必须在 CSP script-src 白名单内', () => {
        const htmlPath = path.resolve(process.cwd(), 'src/mobile/index.html');
        const html = readFileSync(htmlPath, 'utf8');
        const match = /<script>([\s\S]*?)<\/script>/.exec(html);
        expect(match, 'index.html 应存在内联主题脚本').not.toBeNull();
        const script = match![1];
        const hash = createHash('sha256').update(script).digest('base64');
        expect(MOBILE_CONTENT_SECURITY_POLICY).toContain(`'sha256-${hash}'`);
    });
});
