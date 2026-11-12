import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import WatchHistoryViewBuilder from '@/backend/services/WatchHistoryViewBuilder';
import type { WatchHistoryRecord } from '@/backend/services/repositories/WatchHistoryRepository';
import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';

const FOLDER = '/storage/videos/YouTube';
const VIDEO = 'talk.mp4';

/** 构造一条最小可用的观看记录。 */
const record = (srtFile: string | null): WatchHistoryRecord => ({
    id: 'wh-1',
    base_path: FOLDER,
    file_name: VIDEO,
    project_type: 0,
    current_position: 0,
    srt_file: srtFile,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
} as unknown as WatchHistoryRecord);

/** 装配一个只关心字幕解析的构建器。 */
const build = (files: string[]) => {
    const fs = new MemoryFileSystemGateway();
    fs.files.set(path.normalize(path.join(FOLDER, VIDEO)), 'video');
    for (const name of files) {
        fs.files.set(path.normalize(path.join(FOLDER, name)), 'srt');
    }
    return new WatchHistoryViewBuilder(
        { duration: vi.fn().mockResolvedValue(0) } as never,
        {} as never,
        { ensurePathAccessPermissionIfExists: vi.fn().mockResolvedValue(undefined) } as never,
        fs,
    );
};

describe('播放字幕解析：自动升级到作者轨', () => {
    /**
     * 回归：旧版本给不少视频挂上了 ASR 轨，而作者轨一直躺在同目录没被用上。
     * 播放时应当自动升级，并告知调用方回写数据库。
     */
    it('当前是 ASR 轨、同目录有作者轨时升级，并返回 upgradedFrom', async () => {
        const builder = build(['talk.en.srt', 'talk.en-orig.srt']);

        const result = await builder.resolveSubtitleForPlayback(
            record(path.join(FOLDER, 'talk.en-orig.srt')),
        );

        expect(result?.subtitlePath).toBe(path.join(FOLDER, 'talk.en.srt'));
        expect(result?.upgradedFrom).toBe(path.join(FOLDER, 'talk.en-orig.srt'));
    });

    it('已经是作者轨时不升级，也不返回 upgradedFrom', async () => {
        const builder = build(['talk.en.srt', 'talk.en-orig.srt']);

        const result = await builder.resolveSubtitleForPlayback(
            record(path.join(FOLDER, 'talk.en.srt')),
        );

        expect(result?.subtitlePath).toBe(path.join(FOLDER, 'talk.en.srt'));
        expect(result?.upgradedFrom).toBeUndefined();
    });

    /**
     * 回归（严重）：目录里并排放着多个视频时，不能把别的视频的字幕挂过来。
     */
    it('同目录存在其他视频的字幕时，不会被错配过去', async () => {
        const builder = build([
            'talk.en.srt',
            'talk.en-orig.srt',
            'other.en.srt',
        ]);

        const result = await builder.resolveSubtitleForPlayback(
            record(path.join(FOLDER, 'talk.en-orig.srt')),
        );

        expect(result?.subtitlePath).toBe(path.join(FOLDER, 'talk.en.srt'));
    });

    it('本视频只有 ASR 轨时，不会借用同目录其他视频的作者轨', async () => {
        const builder = build(['talk.en-orig.srt', 'other.en.srt']);

        const result = await builder.resolveSubtitleForPlayback(
            record(path.join(FOLDER, 'talk.en-orig.srt')),
        );

        expect(result?.subtitlePath).toBe(path.join(FOLDER, 'talk.en-orig.srt'));
        expect(result?.upgradedFrom).toBeUndefined();
    });

    it('没有更优轨时保持原字幕', async () => {
        const builder = build(['talk.en-orig.srt']);

        const result = await builder.resolveSubtitleForPlayback(
            record(path.join(FOLDER, 'talk.en-orig.srt')),
        );

        expect(result?.subtitlePath).toBe(path.join(FOLDER, 'talk.en-orig.srt'));
        expect(result?.upgradedFrom).toBeUndefined();
    });

    it('目录读取失败时保持原字幕，不让播放失败', async () => {
        const fs = new MemoryFileSystemGateway();
        fs.files.set(path.normalize(path.join(FOLDER, VIDEO)), 'video');
        fs.files.set(path.normalize(path.join(FOLDER, 'talk.en-orig.srt')), 'srt');
        const builder = new WatchHistoryViewBuilder(
            { duration: vi.fn().mockResolvedValue(0) } as never,
            {} as never,
            { ensurePathAccessPermissionIfExists: vi.fn().mockResolvedValue(undefined) } as never,
            {
                fileExists: fs.fileExists.bind(fs),
                listFileNames: vi.fn().mockRejectedValue(new Error('EACCES')),
            } as never,
        );

        const result = await builder.resolveSubtitleForPlayback(
            record(path.join(FOLDER, 'talk.en-orig.srt')),
        );

        expect(result?.subtitlePath).toBe(path.join(FOLDER, 'talk.en-orig.srt'));
    });
});
