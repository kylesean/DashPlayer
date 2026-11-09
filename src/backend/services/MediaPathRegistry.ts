import fs from 'node:fs';
import path from 'node:path';
import { injectable } from 'inversify';

/**
 * 已被后端交付给渲染进程的媒体路径登记表。
 *
 * 为什么需要它：应用会播放用户用系统文件框挑中的视频，而这些视频**留在原地**，
 * 并不复制进媒体库根目录。`media://` 协议如果只认媒体库根目录，这些视频就读不出来；
 * 如果改成「任意路径都放行」，`media://` 就退化成一个任意文件读取器，渲染层一旦出
 * 问题就能把它当读盘后门用。
 *
 * 这张表记的是**后端已经亲手交给渲染进程的那些路径**：观看历史、视频、字幕、
 * 片段原片。换句话说，路径能出现在 `media://` 里，是因为后端确实把它给过渲染层，
 * 而不是渲染层随口编出来的。
 *
 * 生命周期：纯内存，随进程结束而消失。重启后由应用重新读取观看历史并再次登记。
 */
@injectable()
export default class MediaPathRegistry {
    /** 已登记的单个文件（绝对路径）。 */
    private readonly files = new Map<string, true>();
    /** 已登记的目录（绝对路径），目录下的文件都算在内。 */
    private readonly directories = new Map<string, true>();

    /** 单个文件条目的上限；超出后淘汰最早的登记。 */
    private static readonly MAX_FILES = 4096;
    /** 目录条目的上限；超出后淘汰最早的登记。 */
    private static readonly MAX_DIRECTORIES = 256;

    /**
     * 登记一个文件路径。
     *
     * 同时登记字面路径与它的真实路径：用户挑中的视频本身可能是软链接，
     * 只记字面路径会让「软链指向别处」的文件读不出来；而真实路径也记一份，
     * 是为了在文件事后被换成指向别处的软链接时，真实路径对不上、请求被拒。
     *
     * @param filePath 文件绝对路径。
     */
    public allowFile(filePath: string): void {
        if (!filePath) {
            return;
        }
        const resolved = path.resolve(filePath);
        this.add(this.files, resolved, MediaPathRegistry.MAX_FILES);
        const real = MediaPathRegistry.realPath(resolved);
        if (real !== resolved) {
            this.add(this.files, real, MediaPathRegistry.MAX_FILES);
        }
    }

    /**
     * 登记一个目录，目录下的文件都视为已授权。
     *
     * @param directoryPath 目录绝对路径。
     */
    public allowDirectory(directoryPath: string): void {
        if (!directoryPath) {
            return;
        }
        const resolved = path.resolve(directoryPath);
        this.add(this.directories, resolved, MediaPathRegistry.MAX_DIRECTORIES);
        const real = MediaPathRegistry.realPath(resolved);
        if (real !== resolved) {
            this.add(this.directories, real, MediaPathRegistry.MAX_DIRECTORIES);
        }
    }

    /**
     * 读取路径的真实路径；解析不了时返回原值。
     *
     * @param targetPath 目标路径。
     * @returns 真实路径。
     */
    private static realPath(targetPath: string): string {
        try {
            return fs.realpathSync(targetPath);
        } catch {
            return targetPath;
        }
    }

    /**
     * 写入一条登记并维持上限。
     *
     * @param entries 目标表。
     * @param key 路径。
     * @param limit 条目上限。
     */
    private add(entries: Map<string, true>, key: string, limit: number): void {
        entries.delete(key);
        entries.set(key, true);
        this.evict(entries, limit);
    }

    /**
     * 判断某个路径是否已获授权。
     *
     * @param filePath 文件绝对路径。
     * @returns 已登记（或位于已登记目录下）时为 true。
     */
    public isAllowed(filePath: string): boolean {
        if (!filePath) {
            return false;
        }
        const resolved = path.resolve(filePath);
        if (this.files.has(resolved)) {
            return true;
        }
        for (const directory of this.directories.keys()) {
            if (MediaPathRegistry.isInside(directory, resolved)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 已登记的条目总数。
     *
     * @returns 文件条目数 + 目录条目数。
     */
    public size(): number {
        return this.files.size + this.directories.size;
    }

    /**
     * 判断目标是否位于目录之内。
     *
     * 用 `path.relative` 而不是字符串前缀比较：`/data/library2` 以 `/data/library`
     * 开头，但它并不在 `/data/library` 之内。
     *
     * @param directoryPath 目录绝对路径。
     * @param targetPath 目标绝对路径。
     * @returns 位于目录之内时为 true。
     */
    private static isInside(directoryPath: string, targetPath: string): boolean {
        const relativePath = path.relative(directoryPath, targetPath);
        if (relativePath === '') {
            return true;
        }
        if (relativePath.startsWith('..')) {
            return false;
        }
        return !path.isAbsolute(relativePath);
    }

    /**
     * 超出上限时淘汰最早的登记。
     *
     * Map 保持插入顺序，删掉第一个键就是最老的那条。
     *
     * @param entries 待裁剪的表。
     * @param limit 条目上限。
     */
    private evict(entries: Map<string, true>, limit: number): void {
        while (entries.size > limit) {
            const oldest = entries.keys().next();
            if (oldest.done) {
                return;
            }
            entries.delete(oldest.value);
        }
    }
}
