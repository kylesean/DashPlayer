import path from 'path';

import type MediaService from '@/backend/services/MediaService';
import type { WatchHistoryRecord } from '@/backend/services/repositories/WatchHistoryRepository';
import type WatchHistoryExtRepository from '@/backend/services/repositories/WatchHistoryExtRepository';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import MatchSrt from '@/backend/utils/MatchSrt';
import MediaUtil from '@/common/utils/MediaUtil';
import StrUtil from '@/common/utils/str-util';
import TimeUtil from '@/common/utils/TimeUtil';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type { SubtitleResolution } from '@/common/contracts/subtitle-resolution';
import { findBetterEnglishSubtitle } from '@/common/utils/subtitle/preferred-track';

/**
 * 将观看历史数据库记录转换为 renderer 使用的展示数据。
 *
 * basic 构建只读取数据库字段；完整构建额外读取视频时长并匹配字幕。
 */
export default class WatchHistoryViewBuilder {
    /**
     * 创建观看历史展示数据构建器。
     *
     * @param mediaService 媒体信息服务。
     * @param watchHistoryExtRepository 观看历史扩展信息仓储。
     * @param storageDirectoryProvider 存储目录与访问权限提供器。
     * @param fileSystemGateway 文件系统访问入口。
     */
    public constructor(
        private readonly mediaService: MediaService,
        private readonly watchHistoryExtRepository: WatchHistoryExtRepository,
        private readonly storageDirectoryProvider: StorageDirectoryProvider,
        private readonly fileSystemGateway: FileSystemGateway,
    ) {
    }

    /**
     * 构建包含视频时长和字幕匹配结果的完整展示数据。
     *
     * @param history 观看历史数据库记录。
     * @returns 完整展示数据；视频文件不存在时返回 `null`。
     */
    public async buildFull(history: WatchHistoryRecord): Promise<WatchHistoryVO | null> {
        const resolution = await this.resolveSubtitleForPlayback(history);
        if (resolution === null) {
            return null;
        }

        const filePath = path.join(history.base_path, history.file_name);
        const duration = await this.mediaService.duration(filePath);
        return this.buildBase(history, duration, resolution.subtitlePath);
    }

    /**
     * 构建播放页启动所需的轻量详情。
     *
     * 该方法只校验媒体文件并读取数据库字段，不探测媒体时长，也不扫描字幕目录，
     * 从而让 renderer 可以尽早设置视频源。
     *
     * @param history 观看历史数据库记录。
     * @returns 轻量播放详情；媒体文件不存在时返回 `null`。
     */
    public async buildPlayerDetail(history: WatchHistoryRecord): Promise<WatchHistoryVO | null> {
        const filePath = path.join(history.base_path, history.file_name);
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(filePath);
        if (!await this.fileSystemGateway.fileExists(filePath)) {
            return null;
        }
        return this.buildBase(history, 0, history.srt_file ?? '');
    }

    /**
     * 构建不读取媒体时长和字幕目录的轻量展示数据。
     *
     * @param history 观看历史数据库记录。
     * @returns basic 展示数据。
     */
    public async buildBasic(history: WatchHistoryRecord): Promise<WatchHistoryVO> {
        return this.buildBase(history, 0, history.srt_file ?? '');
    }

    /**
     * 构建 full/basic 共用的展示字段。
     *
     * @param history 观看历史数据库记录。
     * @param duration 视频时长，basic 数据固定为 0。
     * @param srtFile 字幕文件路径。
     * @returns renderer 使用的展示数据。
     */
    private async buildBase(
        history: WatchHistoryRecord,
        duration: number,
        srtFile: string,
    ): Promise<WatchHistoryVO> {
        const ext = await this.watchHistoryExtRepository.findByWatchHistoryId(history.id);
        return {
            id: history.id,
            basePath: history.base_path,
            fileName: history.file_name,
            isFolder: false,
            updatedAt: TimeUtil.isoToDate(history.updated_at),
            duration,
            current_position: history.current_position,
            srtFile,
            playing: false,
            podcastModeUserSet: ext?.podcast_mode_user_set ?? null,
            podcastModeManual: ext?.podcast_mode_manual ?? null,
        };
    }

    /**
     * 解析观看记录使用的字幕文件。
     *
     * 已关联字幕有效时直接使用（用户显式挂载或转录产出，视为可信）；
     * 否则在视频目录中匹配最合适的字幕，并附带模糊兜底命中的可疑标记。
     *
     * @param history 观看历史数据库记录。
     * @param videoPath 视频文件路径。
     * @returns 字幕解析结论；未匹配到字幕时 `subtitlePath` 为空字符串。
     */
    private async resolveSubtitle(history: WatchHistoryRecord, videoPath: string): Promise<SubtitleResolution> {
        const configuredSubtitle = history.srt_file;
        if (StrUtil.isNotBlank(configuredSubtitle)) {
            await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(configuredSubtitle);
            const exists = await this.fileSystemGateway.fileExists(configuredSubtitle);
            if (exists) {
                /*
                  已挂字幕存在，但可能挂错了轨：旧版本导入时用 `find` 取第一个匹配项，
                  顺序取决于文件系统，于是不少视频挂上了 ASR 轨（`xxx.en-orig.srt`），
                  而质量更好的作者轨（`xxx.en.srt`）一直躺在同一目录里。

                  这里做「ASR → 作者轨」的单向升级；升级结果通过
                  `upgradedFrom` 告知调用方，由它决定是否回写数据库。
                */
                const upgraded = await this.findUpgradedSubtitle(configuredSubtitle);
                return {
                    subtitlePath: upgraded ?? configuredSubtitle,
                    mismatchSuspected: false,
                    ...(upgraded ? { upgradedFrom: configuredSubtitle } : {}),
                };
            }
        }

        const subtitleFiles = await this.listSubtitleFiles(history.base_path);
        const detail = MatchSrt.matchOneDetail(videoPath, subtitleFiles);
        if (detail === null) {
            return { subtitlePath: '', mismatchSuspected: false };
        }
        return { subtitlePath: detail.path, mismatchSuspected: detail.suspicious };
    }

    /**
     * 在当前字幕所在目录里寻找质量更高的英语轨。
     *
     * 只处理「当前是 ASR 轨、同目录有作者轨」这一种情况；其余一律返回 null。
     *
     * @param currentSubtitlePath 当前挂载的字幕绝对路径。
     * @returns 更优字幕的绝对路径；无需升级时返回 null。
     */
    private async findUpgradedSubtitle(currentSubtitlePath: string): Promise<string | null> {
        try {
            const folder = path.dirname(currentSubtitlePath);
            const names = await this.fileSystemGateway.listFileNames(folder);
            const better = findBetterEnglishSubtitle(path.basename(currentSubtitlePath), names);
            return better ? path.join(folder, better) : null;
        } catch {
            // 目录读不到时保持原字幕：升级属于增强，不能因此让播放失败
            return null;
        }
    }

    /**
     * 独立解析播放记录应使用的字幕文件。
     *
     * 已关联字幕有效时直接返回；否则扫描视频目录并匹配最合适的字幕。
     * 返回 `null` 表示媒体文件本身不存在，`subtitlePath` 为空字符串表示媒体存在但没有匹配字幕。
     *
     * @param history 观看历史数据库记录。
     * @returns 字幕解析结论或媒体不存在时的 `null`。
     */
    public async resolveSubtitleForPlayback(history: WatchHistoryRecord): Promise<SubtitleResolution | null> {
        const videoPath = path.join(history.base_path, history.file_name);
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(videoPath);
        if (!await this.fileSystemGateway.fileExists(videoPath)) {
            return null;
        }
        return this.resolveSubtitle(history, videoPath);
    }

    /**
     * 按 SRT、其他字幕格式的顺序列出目录中的字幕文件。
     *
     * @param folder 视频所在目录。
     * @returns 字幕文件绝对路径列表。
     */
    private async listSubtitleFiles(folder: string): Promise<string[]> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(folder);
        const fileNames = await this.fileSystemGateway.listFileNames(folder);
        const subtitlePaths = fileNames
            .filter((fileName) => MediaUtil.isSubtitle(fileName))
            .map((fileName) => path.join(folder, fileName));

        const srtFiles = subtitlePaths.filter((subtitlePath) => MediaUtil.isSrt(subtitlePath));
        const otherSubtitleFiles = subtitlePaths.filter((subtitlePath) => !MediaUtil.isSrt(subtitlePath));
        return [...srtFiles, ...otherSubtitleFiles];
    }
}
