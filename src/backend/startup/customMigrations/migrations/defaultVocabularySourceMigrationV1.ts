import { inArray, sql } from 'drizzle-orm';

import { words } from '@/backend/infrastructure/db/tables/words';
import {
    loadDefaultVocabulary,
    type DefaultVocabularyWord,
} from '@/backend/utils/defaultVocabulary';

import type { CustomMigration } from '../types';

const MIGRATION_ID = 'default-vocabulary-source-v1';
const DEFAULT_SEED_VERSION_KEY = 'syssetup.vocabularySeedVersion';

/**
 * 把历史启动时播种进 dp_words 的默认词表标记为 starter pack。
 *
 * 旧逻辑把默认词表和用户收藏完全混在一起，导致新用户一打开字幕就出现大量
 * 「生词」下划线。迁移不删除用户数据，只把来源改成 default、状态改成 ignored：
 * 词汇工坊默认不再展示它们，正文标注也不再读取它们；用户主动收藏时会重新激活。
 */
export const defaultVocabularySourceMigrationV1: CustomMigration = {
    id: MIGRATION_ID,
    description: 'Mark seeded default vocabulary as starter pack, not personal vocabulary',
    run: async (ctx) => {
        const seededVersion = ctx.settings.getPersisted(DEFAULT_SEED_VERSION_KEY);
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
                .where(inArray(sql`lower(${words.word})`, batch));
            updated += result.changes;
        }

        ctx.logger.info('default vocabulary marked as starter pack', {
            candidates: defaultWords.length,
            updated,
        });
    },
};
