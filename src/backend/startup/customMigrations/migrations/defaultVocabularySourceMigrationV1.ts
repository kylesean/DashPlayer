import { and, eq, inArray, sql } from 'drizzle-orm';

import { systemConfigs } from '@/backend/infrastructure/db/tables/sysConf';
import { words } from '@/backend/infrastructure/db/tables/words';
import {
    loadDefaultVocabulary,
    type DefaultVocabularyWord,
} from '@/backend/utils/defaultVocabulary';

import type { CustomMigration, CustomMigrationContext } from '../types';

const MIGRATION_ID = 'default-vocabulary-source-v1';
const DEFAULT_SEED_VERSION_KEY = 'syssetup.vocabularySeedVersion';

/**
 * 读取默认词表的播种标记。
 *
 * 播种标记由 `seedDefaultVocabularyIfNeeded` 通过 SystemConfigService 写入
 * **SQLite 的 dp_sys_conf**，不是 electron-store。早期版本这里用
 * `ctx.settings.getPersisted` 读配置 JSON，永远拿到 null，于是整条迁移变成
 * 死代码：升级用户的默认词仍是 `learning/manual`，字幕上满屏下划线。
 *
 * @param ctx 迁移上下文。
 * @returns 播种版本；从未播种过时为 null。
 */
const readSeededVersion = async (ctx: CustomMigrationContext): Promise<string | null> => {
    const rows = await ctx.db
        .select({ value: systemConfigs.value })
        .from(systemConfigs)
        .where(eq(systemConfigs.key, DEFAULT_SEED_VERSION_KEY))
        .limit(1);
    const value = rows[0]?.value;
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

/**
 * 把历史启动时播种进 dp_words 的默认词表标记为 starter pack。
 *
 * 旧逻辑把默认词表和用户收藏完全混在一起，导致新用户一打开字幕就出现大量
 * 「生词」下划线。迁移不删除用户数据，只把来源改成 default、状态改成 ignored：
 * 词汇工坊默认不再展示它们，正文标注也不再读取它们；用户主动收藏时会重新激活。
 *
 * 只处理「还没有任何学习证据」的行（mastery 与 confidence 均为 0）：用户可能
 * 恰好学过词表里的某个词，那种行的掌握度已被证据更新过，不能被清零。
 */
export const defaultVocabularySourceMigrationV1: CustomMigration = {
    id: MIGRATION_ID,
    description: 'Mark seeded default vocabulary as starter pack, not personal vocabulary',
    run: async (ctx) => {
        const seededVersion = await readSeededVersion(ctx);
        if (!seededVersion) {
            ctx.logger.debug('skip: default vocabulary was never seeded');
            return;
        }

        let defaults: DefaultVocabularyWord[];
        try {
            defaults = await loadDefaultVocabulary();
        } catch (error) {
            ctx.logger.warn('skip: unable to load default vocabulary', { error });
            return;
        }
        const defaultWords = Array.from(new Set(
            defaults
                .map((item) => item.word.trim().toLowerCase())
                .filter((word) => word.length > 0),
        ));
        if (defaultWords.length === 0) {
            ctx.logger.info('skip: default vocabulary file is empty');
            return;
        }

        let updated = 0;
        for (let index = 0; index < defaultWords.length; index += 500) {
            const batch = defaultWords.slice(index, index + 500);
            const result = await ctx.db
                .update(words)
                .set({
                    source: 'default',
                    status: 'ignored',
                    mastery: 0,
                    confidence: 0,
                    mastered_at: null,
                    updated_at: new Date().toISOString(),
                })
                .where(and(
                    inArray(sql`lower(${words.word})`, batch),
                    // 已有学习证据的行属于用户自己的学习结果，保持原样。
                    eq(words.mastery, 0),
                    eq(words.confidence, 0),
                ));
            updated += result.changes;
        }

        ctx.logger.info('default vocabulary marked as starter pack', {
            candidates: defaultWords.length,
            updated,
        });
    },
};
