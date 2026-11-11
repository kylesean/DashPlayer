import { count } from 'drizzle-orm';

import db from '@/backend/infrastructure/db';
import { words } from '@/backend/infrastructure/db/tables/words';
import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import container from '@/backend/ioc/inversify.config';
import type SystemConfigService from '@/backend/services/SystemConfigService';
import { type DefaultVocabularyWord, loadDefaultVocabulary } from '@/backend/utils/defaultVocabulary';
import {
    DEFAULT_VOCABULARY_VERSION,
    SEED_VERSION_KEY,
    writeDefaultVocabularyInTransaction,
} from './defaultVocabularySeed';

export { DEFAULT_VOCABULARY_VERSION, writeDefaultVocabularyInTransaction };

export const seedDefaultVocabularyIfNeeded = async (): Promise<void> => {
    const logger = getMainLogger('seedDefaultVocabulary');
    const sysConf = container.get<SystemConfigService>(TYPES.SystemConfigService);

    const seededVersion = await sysConf.getValue(SEED_VERSION_KEY);
    if (seededVersion === DEFAULT_VOCABULARY_VERSION) {
        logger.debug('skip seed: already seeded', { seededVersion });
        return;
    }

    const wordCount = db
        .select({ c: count() })
        .from(words)
        .get()?.c ?? 0;

    if (wordCount > 0) {
        logger.debug('skip seed: dp_words not empty', { wordCount, seededVersion });
        await sysConf.setValue(SEED_VERSION_KEY, DEFAULT_VOCABULARY_VERSION);
        return;
    }

    let defaults: DefaultVocabularyWord[];
    try {
        defaults = await loadDefaultVocabulary();
    } catch (error) {
        logger.error('load default vocabulary failed', { error });
        return;
    }

    if (defaults.length === 0) {
        logger.debug('skip seed: no default vocabulary entries');
        await sysConf.setValue(SEED_VERSION_KEY, DEFAULT_VOCABULARY_VERSION);
        return;
    }

    logger.info('seeding default vocabulary', {
        version: DEFAULT_VOCABULARY_VERSION,
        count: defaults.length,
    });

    const rows = defaults
        .map((w) => ({
            word: w.word.trim(),
            translate: w.translate ?? null,
            status: 'ignored' as const,
            source: 'default' as const,
        }))
        .filter((w) => w.word.length > 0);

    // 分批插入是为了控制单条 SQL 的参数数量，但必须整体原子：
    // 中途崩溃/断电时，下一轮启动看到「表非空」就会把版本标记落库，
    // 残缺词表从此被当成已完成播种，缺失的默认词永远不会补上。
    // 事务内插入 + 事务内写标记，保证「要么全有、要么全无」。
    // better-sqlite3 的事务是同步 API：回调必须是同步函数，语句也要显式 `.run()`。
    // 传 async 回调时事务会在回调返回 Promise 的那一刻 COMMIT，后续插入落到事务外，
    // 中途失败就会留下「非空但残缺」的词表，被下一次启动误判为已完成播种。
    writeDefaultVocabularyInTransaction((callback) => db.transaction(callback), rows);
    logger.info('seed done', { version: DEFAULT_VOCABULARY_VERSION });
};
