import { describe, expect, it } from 'vitest';
import UrlUtil, { MEDIA_URL_PREFIX } from '@/common/utils/UrlUtil';

/**
 * 从 media:// URL 里取出被编码的路径。
 * @param url media:// URL。
 * @returns 解码后的路径。
 */
const readEncodedPath = (url: string): string => {
    const queryIndex = url.indexOf('?p=');
    expect(queryIndex).toBeGreaterThanOrEqual(0);
    return decodeURIComponent(url.slice(queryIndex + 3));
};

describe('URL 工具', () => {
    describe('本地路径转换为 media:// 协议 URL', () => {
        it('本地绝对路径产出 media://local/media?p=... 形态的 URL', () => {
            const url = UrlUtil.toUrl('/data/DashPlayer/videos/lesson.mp4');

            expect(url.startsWith(MEDIA_URL_PREFIX)).toBe(true);
            expect(url).toBe(`media://local/media?p=${encodeURIComponent('/data/DashPlayer/videos/lesson.mp4')}`);
        });

        it('路径经 decodeURIComponent 之后原样还原', () => {
            const source = '/data/DashPlayer/videos/lesson 01.mp4';

            expect(readEncodedPath(UrlUtil.toUrl(source))).toBe(source);
        });

        it('多个路径片段按分隔符拼接后再编码', () => {
            const url = UrlUtil.toUrl('/data/DashPlayer/videos', 'lesson.mp4');

            expect(readEncodedPath(url)).toBe('/data/DashPlayer/videos/lesson.mp4');
        });

        it('空格、#、? 与中文混排的路径可以正确往返', () => {
            const source = '/data/DashPlayer/videos/第 1 课 #片段?备用.mp4';

            const url = UrlUtil.toUrl(source);

            expect(readEncodedPath(url)).toBe(source);
            // 特殊字符必须被编码，否则会截断 URL 或被当成查询串。
            expect(url).not.toContain('#');
            expect(url.slice(url.indexOf('?p=') + 3)).not.toContain('?');
        });

        it('已经是 media:// 的 URL 原样返回，保证重复调用幂等', () => {
            const url = UrlUtil.toUrl('/data/DashPlayer/videos/lesson.mp4');

            expect(UrlUtil.toUrl(url)).toBe(url);
        });

        it('历史数据里的 file:// 路径被还原成本地路径再转换成 media://', () => {
            const url = UrlUtil.toUrl('file:///data/DashPlayer/videos/lesson%2001.mp4');

            expect(url.startsWith(MEDIA_URL_PREFIX)).toBe(true);
            expect(readEncodedPath(url)).toBe('/data/DashPlayer/videos/lesson 01.mp4');
        });
    });

    describe('远程地址与空值透传', () => {
        it('http:// 地址原样返回', () => {
            expect(UrlUtil.toUrl('http://example.com/video.mp4')).toBe('http://example.com/video.mp4');
        });

        it('https:// 地址原样返回', () => {
            expect(UrlUtil.toUrl('https://example.com/video.mp4')).toBe('https://example.com/video.mp4');
        });

        it('空字符串返回空字符串', () => {
            expect(UrlUtil.toUrl('')).toBe('');
        });

        it('不传参数时返回空字符串', () => {
            expect(UrlUtil.toUrl()).toBe('');
        });
    });
});
