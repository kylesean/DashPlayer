import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createMemoryDb, type MemoryDb } from '@/test/database';
import { systemConfigs } from '@/backend/infrastructure/db/tables/sysConf';
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

/**
 * 把播种标记写进 SQLite 的 dp_sys_conf。
 *
 * 播种标记的真实存放位置就是这里（SystemConfigService 走 SysConfRepository），
 * 不是 electron-store；测试必须用同一通道，否则会重演"迁移读错地方"的 bug。
 *
 * @param memoryDb 内存数据库。
 */
const seedMarker = async (memoryDb: MemoryDb): Promise<void> => {
    await memoryDb.db.insert(systemConfigs).values({
        key: 'syssetup.vocabularySeedVersion',
        value: '1',
    });
};

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

        await seedMarker(memoryDb);
        await defaultVocabularySourceMigrationV1.run({
            settings: settings({}),
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

    it('已有学习证据的默认词不被清零（用户可能恰好学过词表里的词）', async () => {
        memoryDb = createMemoryDb();
        loadDefaultVocabularyMock.mockResolvedValue([{ word: 'cancel' }]);
        await memoryDb.db.insert(words).values([
            // 未学过的默认词：应被标成 starter pack
            { word: 'cancel', translate: '取消', status: 'learning', source: 'manual' },
            // 已有证据的默认词：保持用户的学习结果
            {
                word: 'explosive',
                translate: '爆炸的',
                status: 'familiar',
                source: 'manual',
                mastery: 0.7,
                confidence: 0.5,
            },
        ]);
        loadDefaultVocabularyMock.mockResolvedValue([{ word: 'cancel' }, { word: 'explosive' }]);

        await seedMarker(memoryDb);
        await defaultVocabularySourceMigrationV1.run({
            settings: settings({}),
            db: memoryDb.db,
            logger: stubLogger,
        });

        const rows = await memoryDb.db.select().from(words);
        const byWord = new Map(rows.map((row) => [row.word, row]));
        expect(byWord.get('cancel')?.source).toBe('default');
        expect(byWord.get('explosive')?.source).toBe('manual');
        expect(byWord.get('explosive')?.status).toBe('familiar');
        expect(byWord.get('explosive')?.mastery).toBeCloseTo(0.7);
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

        await seedMarker(memoryDb);
        await expect(defaultVocabularySourceMigrationV1.run({
            settings: settings({}),
            db: memoryDb.db,
            logger: stubLogger,
        })).resolves.toBeUndefined();
    });
});
