import { count } from 'drizzle-orm';

import db from '@/backend/infrastructure/db';
import { systemConfigs } from '@/backend/infrastructure/db/tables/sysConf';
import { words } from '@/backend/infrastructure/db/tables/words';
import TimeUtil from '@/common/utils/TimeUtil';
import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import container from '@/backend/ioc/inversify.config';
import type SystemConfigService from '@/backend/services/SystemConfigService';
import { type DefaultVocabularyWord, loadDefaultVocabulary } from '@/backend/utils/defaultVocabulary';

export const DEFAULT_VOCABULARY_VERSION = '1';
const SEED_VERSION_KEY = 'syssetup.vocabularySeedVersion';

const chunk = <T>(items: T[], size: number): T[][] => {
    if (size <= 0) return [items];
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size));
    }
    return result;
};

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
    await db.transaction(async (tx) => {
        for (const batch of chunk(rows, 300)) {
            await tx
                .insert(words)
                .values(batch)
                .onConflictDoNothing();
        }
        await tx
            .insert(systemConfigs)
            .values({ key: SEED_VERSION_KEY, value: DEFAULT_VOCABULARY_VERSION })
            .onConflictDoUpdate({
                target: systemConfigs.key,
                set: { value: DEFAULT_VOCABULARY_VERSION, updated_at: TimeUtil.timeUtc() },
            });
    });
    logger.info('seed done', { version: DEFAULT_VOCABULARY_VERSION });
};
