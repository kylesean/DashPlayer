import { systemConfigs } from '@/backend/infrastructure/db/tables/sysConf';
import { words } from '@/backend/infrastructure/db/tables/words';
import type { Db } from '@/backend/infrastructure/db/createDb';
import TimeUtil from '@/common/utils/TimeUtil';

/** 默认词表播种版本；升级词表内容时递增。 */
export const DEFAULT_VOCABULARY_VERSION = '1';

/** 播种标记在 dp_sys_conf 中的键。 */
export const SEED_VERSION_KEY = 'syssetup.vocabularySeedVersion';

const SEED_BATCH_SIZE = 300;

/** 待写入的默认词行。 */
export interface DefaultVocabularySeedRow {
    word: string;
    translate: string | null;
    status: 'ignored';
    source: 'default';
}

const chunk = <T>(items: T[], size: number): T[][] => {
    if (size <= 0) return [items];
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size));
    }
    return result;
};

/**
 * 把默认词与播种标记作为一个原子批次写入。
 *
 * better-sqlite3 的事务是同步 API：回调必须是同步函数，语句也要显式 `.run()`。
 * 导出此函数是为了让测试能用真实内存库验证词表与标记确实在同一事务内提交。
 *
 * @param transaction 与生产环境同形的同步事务执行器。
 * @param rows 待写入的默认词。
 */
export const writeDefaultVocabularyInTransaction = (
    transaction: (callback: Parameters<Db['transaction']>[0]) => void,
    rows: DefaultVocabularySeedRow[],
): void => {
    transaction((tx) => {
        for (const batch of chunk(rows, SEED_BATCH_SIZE)) {
            tx
                .insert(words)
                .values(batch)
                .onConflictDoNothing()
                .run();
        }
        tx
            .insert(systemConfigs)
            .values({ key: SEED_VERSION_KEY, value: DEFAULT_VOCABULARY_VERSION })
            .onConflictDoUpdate({
                target: systemConfigs.key,
                set: { value: DEFAULT_VOCABULARY_VERSION, updated_at: TimeUtil.timeUtc() },
            })
            .run();
    });
};
