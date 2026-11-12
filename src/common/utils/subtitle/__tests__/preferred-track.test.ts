import { describe, expect, it } from 'vitest';

import {
    findBetterEnglishSubtitle,
    isEnglishSubtitleFile,
    pickPreferredEnglishSubtitle,
    rankEnglishSubtitle,
} from '../preferred-track';

describe('英语字幕轨优先级', () => {
    it('识别英语轨，排除其他语言', () => {
        expect(isEnglishSubtitleFile('video.en.srt')).toBe(true);
        expect(isEnglishSubtitleFile('video.en-orig.srt')).toBe(true);
        expect(isEnglishSubtitleFile('video.zh-Hans.srt')).toBe(false);
        expect(isEnglishSubtitleFile('video.mp4')).toBe(false);
    });

    it('作者上传轨优于 ASR 轨，ASR 优于其他英语变体', () => {
        expect(rankEnglishSubtitle('a.en.srt')).toBe(0);
        expect(rankEnglishSubtitle('a.en-orig.srt')).toBe(1);
        expect(rankEnglishSubtitle('a.en-GB.srt')).toBe(2);
        expect(rankEnglishSubtitle('a.zh.srt')).toBeNull();
    });

    /**
     * 回归：旧实现用 `find` 取第一个匹配项，顺序取决于文件系统，
     * 导致同一个视频有时挂 ASR 轨、有时挂作者轨。
     */
    it('同时存在两种轨时选作者轨，与输入顺序无关', () => {
        expect(pickPreferredEnglishSubtitle(['a.en-orig.srt', 'a.en.srt'])).toBe('a.en.srt');
        expect(pickPreferredEnglishSubtitle(['a.en.srt', 'a.en-orig.srt'])).toBe('a.en.srt');
    });

    it('只有 ASR 轨时用它', () => {
        expect(pickPreferredEnglishSubtitle(['a.en-orig.srt', 'a.zh.srt'])).toBe('a.en-orig.srt');
    });

    it('没有英语轨时返回 undefined', () => {
        expect(pickPreferredEnglishSubtitle(['a.zh.srt'])).toBeUndefined();
        expect(pickPreferredEnglishSubtitle([])).toBeUndefined();
    });
});

describe('已挂载字幕的自动纠正', () => {
    /**
     * 回归（严重）：曾经从**整个目录**里挑质量最高的字幕，导致打开 A 视频时
     * 挂上 B 视频的字幕。YouTube 目录里并排放着多个视频，每个都有自己的
     * `xxx.en.srt`，必须先按「同一视频」过滤再比质量。
     */
    it('目录里存在多个视频时，只在本视频的候选里挑，不会跨视频错配', () => {
        const siblings = [
            'A Day in The Lizard Village.en-orig.srt',
            'A Day in The Lizard Village.en.srt',
            'The ADHD Doctor.en-orig.srt',
            'The ADHD Doctor.en.srt',
        ];

        expect(findBetterEnglishSubtitle('The ADHD Doctor.en-orig.srt', siblings))
            .toBe('The ADHD Doctor.en.srt');
        expect(findBetterEnglishSubtitle('A Day in The Lizard Village.en-orig.srt', siblings))
            .toBe('A Day in The Lizard Village.en.srt');
    });

    it('本视频只有 ASR 轨、别的视频有作者轨时，也不跨视频错配', () => {
        const siblings = [
            'Talk A.en-orig.srt',
            'Talk B.en.srt',
        ];

        expect(findBetterEnglishSubtitle('Talk A.en-orig.srt', siblings)).toBeNull();
    });

    it('当前是 ASR 轨且同目录有作者轨时，建议切换到作者轨', () => {
        expect(findBetterEnglishSubtitle('a.en-orig.srt', ['a.en-orig.srt', 'a.en.srt'])).toBe('a.en.srt');
    });

    it('已经是作者轨时不做替换', () => {
        expect(findBetterEnglishSubtitle('a.en.srt', ['a.en.srt', 'a.en-orig.srt'])).toBeNull();
    });

    it('没有更优轨时不做替换', () => {
        expect(findBetterEnglishSubtitle('a.en-orig.srt', ['a.en-orig.srt', 'a.zh.srt'])).toBeNull();
    });

    it('非英语轨不参与纠正', () => {
        expect(findBetterEnglishSubtitle('a.zh.srt', ['a.zh.srt', 'a.en.srt'])).toBeNull();
    });
});
