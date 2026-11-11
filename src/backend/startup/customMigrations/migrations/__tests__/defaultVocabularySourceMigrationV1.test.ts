import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createMemoryDb, type MemoryDb } from '@/test/database';
import { words } from '@/backend/infrastructure/db/tables/words';
import type { MainLogger } from '@/backend/infrastructure/logger';
import type { CustomMigrationContext } from '../../types';
import { defaultVocabularySourceMigrationV1 } from '../defaultVocabularySourceMigrationV1';

const loadDefaultVocabularyMock = vi.hoisted(() => vi.fn());

vi.mock('@/backend/utils/defaultVocabulary', () => ({
    loadDefaultVocabulary: loadDefaultVocabularyMock,
}));

const stubLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
} as unknown as MainLogger;

const settings = (persisted: Record<string, string>): CustomMigrationContext['settings'] => ({
    getPersisted: (key) => persisted[key] ?? null,
    hasPersisted: (key) => key in persisted,
    set: (key, value) => {
        if (value === null || value === undefined) {
            delete persisted[key];
        } else {
            persisted[key] = value;
        }
        return true;
    },
    delete: (key) => {
        delete persisted[key];
    },
});

describe('defaultVocabularySourceMigrationV1', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
        loadDefaultVocabularyMock.mockReset();
    });

    it('把已播种的默认词标记为 starter pack，不碰用户自己的词', async () => {
        memoryDb = createMemoryDb();
        loadDefaultVocabularyMock.mockResolvedValue([
            { word: 'Cancel' },
            { word: 'explosive' },
        ]);
        await memoryDb.db.insert(words).values([
            { word: 'cancel', translate: '取消', status: 'learning', source: 'manual' },
            { word: 'explosive', translate: '爆炸的', status: 'learning', source: 'manual' },
            { word: 'custom', translate: '自定义', status: 'learning', source: 'manual' },
        ]);

        await defaultVocabularySourceMigrationV1.run({
            settings: settings({ 'syssetup.vocabularySeedVersion': '1' }),
            db: memoryDb.db,
            logger: stubLogger,
        });

        const rows = await memoryDb.db.select().from(words);
        const byWord = new Map(rows.map((row) => [row.word, row]));
        expect(byWord.get('cancel')?.source).toBe('default');
        expect(byWord.get('cancel')?.status).toBe('ignored');
        expect(byWord.get('explosive')?.source).toBe('default');
        expect(byWord.get('custom')?.source).toBe('manual');
        expect(byWord.get('custom')?.status).toBe('learning');
    });

    it('从未播种过默认词表时跳过，避免误伤用户词', async () => {
        memoryDb = createMemoryDb();
        loadDefaultVocabularyMock.mockResolvedValue([{ word: 'cancel' }]);
        await memoryDb.db.insert(words).values({
            word: 'cancel',
            translate: '取消',
            status: 'learning',
            source: 'manual',
        });

        await defaultVocabularySourceMigrationV1.run({
            settings: settings({}),
            db: memoryDb.db,
            logger: stubLogger,
        });

        const row = await memoryDb.db.select().from(words).where(eq(words.word, 'cancel'));
        expect(row[0]?.source).toBe('manual');
        expect(row[0]?.status).toBe('learning');
    });

    it('资源文件读取失败时跳过而不是阻断启动', async () => {
        memoryDb = createMemoryDb();
        loadDefaultVocabularyMock.mockRejectedValue(new Error('missing resource'));

        await expect(defaultVocabularySourceMigrationV1.run({
            settings: settings({ 'syssetup.vocabularySeedVersion': '1' }),
            db: memoryDb.db,
            logger: stubLogger,
        })).resolves.toBeUndefined();
    });
});
