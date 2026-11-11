import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createMemoryDb, type MemoryDb } from '@/test/database';
import { systemConfigs } from '@/backend/infrastructure/db/tables/sysConf';
import { words } from '@/backend/infrastructure/db/tables/words';
import {
    DEFAULT_VOCABULARY_VERSION,
    writeDefaultVocabularyInTransaction,
} from '../defaultVocabularySeed';

describe('writeDefaultVocabularyInTransaction', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    /**
     * 新库首次启动必须在同步事务内完成播种。
     *
     * 回归背景：回调曾被写成 async，better-sqlite3 直接抛
     * 「Transaction function cannot return a promise」，启动流程中断，主窗口不出现。
     */
    it('同步事务写入默认词与播种标记', async () => {
        memoryDb = createMemoryDb();
        const rows = Array.from({ length: 650 }, (_, index) => ({
            word: `word-${index}`,
            translate: `释义-${index}`,
            status: 'ignored' as const,
            source: 'default' as const,
        }));

        writeDefaultVocabularyInTransaction((callback) => memoryDb!.db.transaction(callback), rows);

        const stored = await memoryDb.db.select().from(words);
        expect(stored).toHaveLength(rows.length);
        expect(stored.every((row) => row.source === 'default')).toBe(true);
        expect(stored.every((row) => row.status === 'ignored')).toBe(true);

        const marker = await memoryDb.db
            .select()
            .from(systemConfigs)
            .where(eq(systemConfigs.key, 'syssetup.vocabularySeedVersion'));
        expect(marker[0]?.value).toBe(DEFAULT_VOCABULARY_VERSION);
    });

    it('重复播种不会产生重复词或重复标记', async () => {
        memoryDb = createMemoryDb();
        const rows = [
            { word: 'cancel', translate: '取消', status: 'ignored' as const, source: 'default' as const },
        ];

        writeDefaultVocabularyInTransaction((callback) => memoryDb!.db.transaction(callback), rows);
        writeDefaultVocabularyInTransaction((callback) => memoryDb!.db.transaction(callback), rows);

        expect(await memoryDb.db.select().from(words)).toHaveLength(1);
        expect(await memoryDb.db.select().from(systemConfigs)).toHaveLength(1);
    });
});
