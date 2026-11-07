import type { CustomMigration } from '../types';

/**
 * 计算轻量翻译引擎下线的迁移写入项（纯函数，便于单测）。
 *
 * OPUS-MT 轻量翻译管线已整体移除，字幕翻译引擎枚举不再含 'local-mt'；
 * 存储值仍为 'local-mt' 的安装迁移到 'local'（本地大模型）——两者同为
 * 本地离线翻译，不落到 'none' 是为了避免用户静默失去字幕翻译。
 *
 * @param stored 存储的引擎值；未持久化过时为 null。
 * @returns 需要写入的引擎值；无需迁移时为 null。
 */
export const resolveLocalMtEngineMigrationOutput = (stored: string | null): string | null =>
    stored === 'local-mt' ? 'local' : null;

export const storeSchemaSubtitleEngineLocalMtMigrationV1: CustomMigration = {
    id: 'store-schema-subtitle-engine-local-mt-v1',
    description: 'Migrate removed local-mt subtitle translation engine to local LLM engine',
    /**
     * 把字幕翻译引擎存储值 'local-mt' 改写为 'local'。
     *
     * 条件写、重复执行无害：仅当存储值恰为 'local-mt' 时写入。
     */
    run: async (ctx) => {
        const stored = ctx.settings.getPersisted('providers.subtitleTranslation');
        const next = resolveLocalMtEngineMigrationOutput(stored);
        if (next === null) return;
        ctx.settings.set('providers.subtitleTranslation', next);
        ctx.logger.info('local-mt subtitle engine migrated to local', { stored, next });
    },
};
