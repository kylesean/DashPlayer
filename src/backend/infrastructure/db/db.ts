import path from 'path';
import fs from 'fs';
import { and, type ExtractTablesWithRelations, sql } from 'drizzle-orm';
import { SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import Database from 'better-sqlite3';
import { isDevelopmentMode } from '@/backend/utils/runtimeEnv';
import { AppStateDirectoryType, getAppStatePath } from '@/backend/infrastructure/system/AppStatePath';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { createDb } from './createDb';

// 当前环境的数据库文件路径，由 Electron userData 和开发/生产环境共同决定。
const file = path.join(getAppStatePath(AppStateDirectoryType.DATA), 'dp_db.sqlite3');
const enableDbLog = process.env.DP_DB_LOG === 'true';
const dbLogger = getMainLogger('database');
const slowQueryLogger = getMainLogger('db-slow-query');

// 创建当前运行环境的单例数据库；慢查询通过回调归因到日志。
const { db, sqlite, close: closeSqlite } = createDb(file, {
    logger: isDevelopmentMode() && enableDbLog,
    onSlowQuery: (sqlText, ms) => slowQueryLogger.warn('slow query', { sql: sqlText, ms }),
});
dbLogger.info('database opened', {
    mode: isDevelopmentMode() ? 'development' : 'production',
    path: file,
});

/**
 * 清空当前运行环境数据库中的所有表、索引和自增序列。
 *
 * 仅用于迁移失败后的重试或显式重置；会删除全部业务数据，调用前须明确意图。
 */
export async function clearDB() {
    // 排除 SQLite 内部保留表（如 sqlite_sequence / sqlite_stat*）。
    const tables = await db
        .select({
            name: sql<string>`name`,
        })
        .from(sql`sqlite_master`)
        .where(and(sql`type = 'table'`, sql`name NOT LIKE 'sqlite_%'`));

    // 清表期间临时关闭外键约束，避免父子表删除顺序触发 RESTRICT 错误。
    sqlite.pragma('foreign_keys = OFF');
    try {
        for (const { name } of tables) {
            sqlite.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
        }

        const indexes = await db
            .select({
                name: sql<string>`name`,
            })
            .from(sql`sqlite_master`)
            .where(and(sql`type = 'index'`, sql`name NOT LIKE 'sqlite_%'`));

        for (const { name } of indexes) {
            sqlite.exec(`DROP INDEX IF EXISTS "${name.replace(/"/g, '""')}"`);
        }

        const sequenceTables = await db
            .select({ name: sql<string>`name` })
            .from(sql`sqlite_master`)
            .where(and(sql`type = 'table'`, sql`name = 'sqlite_sequence'`));
        if (sequenceTables.length > 0) {
            sqlite.exec('DELETE FROM sqlite_sequence');
        }
    } finally {
        sqlite.pragma('foreign_keys = ON');
    }
}

export default db;

/**
 * 关闭数据库连接并删除数据库文件（含 -wal / -shm）。
 *
 * 仅供迁移失败后的「重置并重试」使用：必须先关连接（Windows 上打开中的文件
 * 无法删除），再删文件；下次启动由 runMigrate 重建全新库。
 * 有损操作——库内业务数据（生词本、收藏、翻译缓存等）全部丢失。
 *
 * @throws 文件被占用、无写权限等删除失败时原样抛出，由调用方展示给用户。
 */
export async function resetDatabaseFile(): Promise<void> {
    closeSqlite();
    for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(`${file}${suffix}`, { force: true });
    }
}

export type Transaction = SQLiteTransaction<'sync', Database.RunResult, Record<string, never>, ExtractTablesWithRelations<Record<string, never>>>;
