import { describe, expect, it } from 'vitest';
import { parseYoutubeVideoId } from '../youtubeUrl';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('parseYoutubeVideoId', () => {
    it('解析 watch、youtu.be、shorts、embed、live 地址', () => {
        expect(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
        expect(parseYoutubeVideoId(`https://youtu.be/${VIDEO_ID}`)).toBe(VIDEO_ID);
        expect(parseYoutubeVideoId(`https://www.youtube.com/shorts/${VIDEO_ID}`)).toBe(VIDEO_ID);
        expect(parseYoutubeVideoId(`https://www.youtube.com/embed/${VIDEO_ID}`)).toBe(VIDEO_ID);
        expect(parseYoutubeVideoId(`https://www.youtube.com/live/${VIDEO_ID}`)).toBe(VIDEO_ID);
    });

    it('允许省略协议并忽略额外查询参数', () => {
        expect(parseYoutubeVideoId(`youtube.com/watch?v=${VIDEO_ID}&t=42s`)).toBe(VIDEO_ID);
        expect(parseYoutubeVideoId(`  m.youtube.com/watch?v=${VIDEO_ID}  `)).toBe(VIDEO_ID);
    });

    it('拒绝仿冒域名与非 YouTube 链接', () => {
        expect(parseYoutubeVideoId(`https://evil-youtube.com/watch?v=${VIDEO_ID}`)).toBeNull();
        expect(parseYoutubeVideoId(`https://youtube.com.evil.com/watch?v=${VIDEO_ID}`)).toBeNull();
        expect(parseYoutubeVideoId(`https://www.bilibili.com/video/BV1xx411c7mD`)).toBeNull();
        expect(parseYoutubeVideoId(`file:///etc/passwd`)).toBeNull();
        expect(parseYoutubeVideoId('')).toBeNull();
    });

    it('拒绝非法长度的视频 ID', () => {
        expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
        expect(parseYoutubeVideoId('https://youtu.be/')).toBeNull();
    });
});
