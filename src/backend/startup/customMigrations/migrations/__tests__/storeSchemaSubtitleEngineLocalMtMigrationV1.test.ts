import { describe, expect, it, vi } from 'vitest';

import type { CustomMigrationContext } from '../../types';
import { resolveLocalMtEngineMigrationOutput, storeSchemaSubtitleEngineLocalMtMigrationV1 } from '../storeSchemaSubtitleEngineLocalMtMigrationV1';

/** 本迁移只读写配置存储，db 与 logger 用可调用的空桩。 */
const buildContext = (persisted: Record<string, string>) => {
    const sets: Array<{ key: string; value: string }> = [];
    const store: Record<string, string> = { ...persisted };
    const ctx: CustomMigrationContext = {
        settings: {
            getPersisted: (key) => store[key] ?? null,
            hasPersisted: (key) => key in store,
            set: (key, value) => {
                if (value === null || value === undefined) return true;
                store[key] = value;
                sets.push({ key, value });
                return true;
            },
            delete: (key) => {
                delete store[key];
            },
        },
        db: {} as CustomMigrationContext['db'],
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    return { ctx, sets };
};

describe('storeSchemaSubtitleEngineLocalMtMigrationV1 迁移', () => {
    describe('resolveLocalMtEngineMigrationOutput', () => {
        it("存量 'local-mt' 迁移为 'local'", () => {
            expect(resolveLocalMtEngineMigrationOutput('local-mt')).toBe('local');
        });

        it("其余值（未持久化 / 'local' / 'openai'）不需要迁移", () => {
            expect(resolveLocalMtEngineMigrationOutput(null)).toBeNull();
            expect(resolveLocalMtEngineMigrationOutput('local')).toBeNull();
            expect(resolveLocalMtEngineMigrationOutput('openai')).toBeNull();
        });
    });

    describe('run', () => {
        it("存储值恰为 'local-mt' 时改写为 'local'", async () => {
            const { ctx, sets } = buildContext({ 'providers.subtitleTranslation': 'local-mt' });

            await storeSchemaSubtitleEngineLocalMtMigrationV1.run(ctx);

            expect(sets).toEqual([{ key: 'providers.subtitleTranslation', value: 'local' }]);
        });

        it("其他引擎值不产生写入", async () => {
            const { ctx, sets } = buildContext({ 'providers.subtitleTranslation': 'openai' });

            await storeSchemaSubtitleEngineLocalMtMigrationV1.run(ctx);

            expect(sets).toEqual([]);
        });

        it("幂等：重复执行收敛，第二次不再写入", async () => {
            const { ctx, sets } = buildContext({ 'providers.subtitleTranslation': 'local-mt' });

            await storeSchemaSubtitleEngineLocalMtMigrationV1.run(ctx);
            await storeSchemaSubtitleEngineLocalMtMigrationV1.run(ctx);

            expect(sets).toEqual([{ key: 'providers.subtitleTranslation', value: 'local' }]);
        });
    });
});
