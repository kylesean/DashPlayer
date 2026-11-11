import { and, asc, desc, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    type InsertWatchHistory,
    watchHistory,
    type WatchHistory,
} from '@/backend/infrastructure/db/tables/watchHistory';
import TYPES from '@/backend/ioc/types';
import TimeUtil from '@/common/utils/TimeUtil';
import type WatchHistoryRepository from '@/backend/services/repositories/WatchHistoryRepository';
import { type WatchHistoryDistinctBasePathFileName, type WatchHistoryInsert, WatchHistoryProjectType, type WatchHistoryRecord, type WatchHistoryUpdatePatch } from '@/backend/services/repositories/WatchHistoryRepository';

/**
 * 使用 Drizzle 访问观看历史表，并将数据库行转换为业务记录。
 */
@injectable()
export default class WatchHistoryRepositoryImpl implements WatchHistoryRepository {
    /**
     * 初始化观看历史仓储实例。
     *
     * @param db 由依赖容器注入的数据库实例，测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    /**
     * 按 ID 查询观看记录。
     *
     * @param id 观看记录 ID。
     * @returns 找到的观看记录；不存在时返回 `null`。
     */
    public async findById(id: string): Promise<WatchHistoryRecord | null> {
        const rows: WatchHistory[] = await this.db
            .select()
            .from(watchHistory)
            .where(eq(watchHistory.id, id));
        return rows[0] ? this.toRecord(rows[0]) : null;
    }

    /**
     * 按目录和文件名查询观看记录。
     *
     * @param basePath 视频所在目录。
     * @param fileName 视频文件名。
     * @returns 匹配的观看记录列表。
     */
    public async findByBasePathFileName(basePath: string, fileName: string): Promise<WatchHistoryRecord[]> {
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(and(eq(watchHistory.base_path, basePath), eq(watchHistory.file_name, fileName)));
        return this.toRecords(rows);
    }

    /**
     * 按目录、文件名和记录类型查询观看记录。
     *
     * @param basePath 视频所在目录。
     * @param fileName 视频文件名。
     * @param type 记录所属类型。
     * @returns 匹配的观看记录列表。
     */
    public async findByBasePathFileNameType(
        basePath: string,
        fileName: string,
        type: WatchHistoryProjectType,
    ): Promise<WatchHistoryRecord[]> {
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(
                and(
                    eq(watchHistory.base_path, basePath),
                    eq(watchHistory.file_name, fileName),
                    eq(watchHistory.project_type, type),
                ),
            );
        return this.toRecords(rows);
    }

    /**
     * 查询指定目录、文件名和类型下的第一条记录。
     *
     * @param basePath 视频所在目录。
     * @param fileName 视频文件名。
     * @param type 记录所属类型。
     * @returns 第一条匹配记录；不存在时返回 `null`。
     */
    public async findOneByBasePathFileNameType(
        basePath: string,
        fileName: string,
        type: WatchHistoryProjectType,
    ): Promise<WatchHistoryRecord | null> {
        const rows = await this.findByBasePathFileNameType(basePath, fileName, type);
        return rows[0] ?? null;
    }

    /**
     * 查询目录中的观看记录，并按文件名升序排列。
     *
     * @param basePath 视频所在目录。
     * @param type 记录所属类型。
     * @returns 排序后的观看记录列表。
     */
    public async listByBasePathAndProjectTypeOrderedByFileName(
        basePath: string,
        type: WatchHistoryProjectType,
    ): Promise<WatchHistoryRecord[]> {
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(and(eq(watchHistory.base_path, basePath), eq(watchHistory.project_type, type)))
            .orderBy(asc(watchHistory.file_name));
        return this.toRecords(rows);
    }

    /**
     * 查询目录中的观看记录，并按更新时间倒序排列。
     *
     * @param basePath 视频所在目录。
     * @param type 记录所属类型。
     * @returns 排序后的观看记录列表。
     */
    public async listByBasePathAndProjectTypeOrderedByUpdatedAtDesc(
        basePath: string,
        type: WatchHistoryProjectType,
    ): Promise<WatchHistoryRecord[]> {
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(and(eq(watchHistory.base_path, basePath), eq(watchHistory.project_type, type)))
            .orderBy(desc(watchHistory.updated_at));
        return this.toRecords(rows);
    }

    /**
     * 查询指定类型的全部观看记录。
     *
     * @param type 记录所属类型。
     * @returns 观看记录列表。
     */
    public async listByProjectType(type: WatchHistoryProjectType): Promise<WatchHistoryRecord[]> {
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(eq(watchHistory.project_type, type));
        return this.toRecords(rows);
    }

    /**
     * 查询指定类型下去重后的目录列表。
     *
     * @param type 记录所属类型。
     * @returns 目录路径列表。
     */
    public async listDistinctFoldersByProjectType(type: WatchHistoryProjectType): Promise<string[]> {
        const rows: { folder: string }[] = await this.db
            .selectDistinct({ folder: watchHistory.base_path })
            .from(watchHistory)
            .where(eq(watchHistory.project_type, type));
        return rows.map((r) => r.folder);
    }

    /**
     * 判断目录下是否存在指定类型的观看记录。
     *
     * @param basePath 视频所在目录。
     * @param type 记录所属类型。
     * @returns 存在匹配记录时返回 `true`。
     */
    public async existsByBasePathAndProjectType(basePath: string, type: WatchHistoryProjectType): Promise<boolean> {
        const rows: WatchHistory[] = await this.db
            .select()
            .from(watchHistory)
            .where(and(eq(watchHistory.base_path, basePath), eq(watchHistory.project_type, type)));
        return rows.length > 0;
    }

    /**
     * 新增观看记录。
     *
     * 记录 id 由 `base_path + file_name + project_type` 确定性哈希得到，两条并发链路
     * （启动清理后的 sync 与首屏 list 的 sync）可能都先查到空、再插同一个 id。
     * 这里按主键冲突忽略并回读已存在的行，让「同时建档」收敛成同一条记录，
     * 而不是把 SQLITE_CONSTRAINT_UNIQUE 抛给渲染层。
     *
     * @param values 待写入的业务记录字段。
     * @returns 写入后的观看记录。
     */
    public async insert(values: WatchHistoryInsert): Promise<WatchHistoryRecord> {
        const rows: WatchHistory[] = await this.db
            .insert(watchHistory)
            .values(values)
            .onConflictDoNothing({ target: watchHistory.id })
            .returning();
        const row = rows[0];
        if (row) {
            return this.toRecord(row);
        }
        // 冲突被忽略：说明另一条链路已经插入了同 id 的记录，回读它。
        const existing = await this.db
            .select()
            .from(watchHistory)
            .where(eq(watchHistory.id, values.id as string))
            .limit(1);
        const found = existing[0];
        if (!found) {
            throw new Error('insert watch history failed');
        }
        return this.toRecord(found);
    }

    /**
     * 按 ID 更新观看记录。
     *
     * @param id 观看记录 ID。
     * @param patch 待更新字段。
     */
    public async updateById(id: string, patch: WatchHistoryUpdatePatch): Promise<void> {
        await this.db
            .update(watchHistory)
            .set({
                ...patch,
                updated_at: patch.updated_at ?? TimeUtil.timeUtc(),
            } satisfies Partial<InsertWatchHistory>)
            .where(eq(watchHistory.id, id));
    }

    /**
     * 按目录和文件名更新观看记录。
     *
     * @param basePath 视频所在目录。
     * @param fileName 视频文件名。
     * @param patch 待更新字段。
     */
    public async updateByBasePathFileName(basePath: string, fileName: string, patch: WatchHistoryUpdatePatch): Promise<void> {
        await this.db
            .update(watchHistory)
            .set({
                ...patch,
                updated_at: patch.updated_at ?? TimeUtil.timeUtc(),
            } satisfies Partial<InsertWatchHistory>)
            .where(and(eq(watchHistory.base_path, basePath), eq(watchHistory.file_name, fileName)));
    }

    /**
     * 按 ID 删除观看记录。
     *
     * @param id 观看记录 ID。
     */
    public async deleteById(id: string): Promise<void> {
        await this.db.delete(watchHistory).where(eq(watchHistory.id, id));
    }

    /**
     * 按目录和文件名删除观看记录。
     *
     * @param basePath 视频所在目录。
     * @param fileName 视频文件名。
     */
    public async deleteByBasePathFileName(basePath: string, fileName: string): Promise<void> {
        await this.db
            .delete(watchHistory)
            .where(and(eq(watchHistory.base_path, basePath), eq(watchHistory.file_name, fileName)));
    }

    /**
     * 查询去重后的目录和文件名组合。
     *
     * @returns 去重后的路径组合列表。
     */
    public async listDistinctBasePathFileName(): Promise<WatchHistoryDistinctBasePathFileName[]> {
        return this.db
            .selectDistinct({
                base_path: watchHistory.base_path,
                file_name: watchHistory.file_name,
            })
            .from(watchHistory);
    }

    /**
     * 查询引用指定字幕文件的观看记录。
     *
     * @param srtFile 字幕文件路径。
     * @returns 引用该字幕文件的观看记录列表。
     */
    public async findBySrtFile(srtFile: string): Promise<WatchHistoryRecord[]> {
        const rows = await this.db
            .select()
            .from(watchHistory)
            .where(eq(watchHistory.srt_file, srtFile));
        return this.toRecords(rows);
    }

    /**
     * 将数据库行转换为业务层使用的观看历史记录。
     *
     * @param row Drizzle 查询返回的数据库行。
     * @returns 不暴露数据库表类型的业务记录。
     */
    private toRecord(row: WatchHistory): WatchHistoryRecord {
        return {
            ...row,
            project_type: row.project_type as WatchHistoryProjectType,
        };
    }

    /**
     * 批量转换数据库行，保持仓储方法的返回结构简单。
     *
     * @param rows Drizzle 查询返回的数据库行列表。
     * @returns 业务层使用的记录列表。
     */
    private toRecords(rows: WatchHistory[]): WatchHistoryRecord[] {
        return rows.map((row) => this.toRecord(row));
    }
}
