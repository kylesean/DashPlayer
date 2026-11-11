import path from 'path';
import fs from 'fs';
import { and, type ExtractTablesWithRelations, sql } from 'drizzle-orm';
import { SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import Database from 'better-sqlite3';
import { isDevelopmentMode } from '@/backend/utils/runtimeEnv';
import { AppStateDirectoryType, getAppStatePath } from '@/backend/infrastructure/system/AppStatePath';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { setMigrationFailure } from '@/backend/startup/migrationFailureState';
import { createDb } from './createDb';

// 当前环境的数据库文件路径，由 Electron userData 和开发/生产环境共同决定。
const file = path.join(getAppStatePath(AppStateDirectoryType.DATA), 'dp_db.sqlite3');
const enableDbLog = process.env.DP_DB_LOG === 'true';
const dbLogger = getMainLogger('database');
const slowQueryLogger = getMainLogger('db-slow-query');

type DbHandle = ReturnType<typeof createDb>;

/**
 * 惰性打开的数据库句柄。
 *
 * 为什么不在模块顶层直接打开：库文件损坏、磁盘满、权限不足时 `createDb` 会抛错，
 * 而它在模块求值期执行——那时 main 的 `try/catch` 与恢复路由都还没注册，
 * 用户只会看到 Electron 原生崩溃，精心设计的迁移失败页反而在最需要它的场景失效。
 *
 * 改成惰性后：开库失败会写进恢复状态并进入恢复模式，由 gate 页引导重试或重置。
 * 恢复模式只注册 MigrationFailureController，它不依赖数据库，因此不会被这里拖住。
 */
let handle: DbHandle | null = null;
let openError: Error | null = null;

/**
 * 打开数据库；重复调用返回同一实例。
 *
 * @returns 已打开的数据库句柄。
 * @throws 开库失败时抛出原始错误（同时已写入迁移失败状态）。
 */
const openHandle = (): DbHandle => {
    if (handle) {
        return handle;
    }
    if (openError) {
        throw openError;
    }
    try {
        handle = createDb(file, {
            logger: isDevelopmentMode() && enableDbLog,
            onSlowQuery: (sqlText, ms) => slowQueryLogger.warn('slow query', { sql: sqlText, ms }),
        });
    } catch (error) {
        openError = error instanceof Error ? error : new Error(String(error));
        // 开库失败等价于 drizzle 阶段失败：让启动流程进入恢复模式而不是直接崩溃。
        setMigrationFailure({
            phase: 'drizzle',
            migrationId: null,
            description: null,
            errorMessage: openError.message,
        });
        dbLogger.error('database open failed', { error: openError, path: file });
        throw openError;
    }
    dbLogger.info('database opened', {
        mode: isDevelopmentMode() ? 'development' : 'production',
        path: file,
    });
    return handle;
};

/**
 * 惰性代理：第一次真正被使用时才打开数据库。
 *
 * 仓储层把 `db` 当普通 drizzle 实例使用，代理把属性访问转发到真实实例，
 * 调用方无需感知打开时机。
 */
const dbProxy = new Proxy({} as DbHandle['db'], {
    get(_target, property) {
        const instance = openHandle().db as unknown as Record<PropertyKey, unknown>;
        const value = instance[property];
        return typeof value === 'function' ? value.bind(instance) : value;
    },
});


/**
 * 清空当前运行环境数据库中的所有表、索引和自增序列。
 *
 * 仅用于迁移失败后的重试或显式重置；会删除全部业务数据，调用前须明确意图。
 */
export async function clearDB() {
    // 排除 SQLite 内部保留表（如 sqlite_sequence / sqlite_stat*）。
    const tables = await dbProxy
        .select({
            name: sql<string>`name`,
        })
        .from(sql`sqlite_master`)
        .where(and(sql`type = 'table'`, sql`name NOT LIKE 'sqlite_%'`));

    // 清表期间临时关闭外键约束，避免父子表删除顺序触发 RESTRICT 错误。
    const sqlite = openHandle().sqlite;
    sqlite.pragma('foreign_keys = OFF');
    try {
        for (const { name } of tables) {
            sqlite.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
        }

        const indexes = await dbProxy
            .select({
                name: sql<string>`name`,
            })
            .from(sql`sqlite_master`)
            .where(and(sql`type = 'index'`, sql`name NOT LIKE 'sqlite_%'`));

        for (const { name } of indexes) {
            sqlite.exec(`DROP INDEX IF EXISTS "${name.replace(/"/g, '""')}"`);
        }

        const sequenceTables = await dbProxy
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

export default dbProxy;

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
    handle?.close();
    handle = null;
    openError = null;
    for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(`${file}${suffix}`, { force: true });
    }
}

export type Transaction = SQLiteTransaction<'sync', Database.RunResult, Record<string, never>, ExtractTablesWithRelations<Record<string, never>>>;
