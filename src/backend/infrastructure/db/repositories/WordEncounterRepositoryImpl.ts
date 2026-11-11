import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    wordEncounter,
    type InsertWordEncounter,
} from '@/backend/infrastructure/db/tables/wordEncounter';
import TYPES from '@/backend/ioc/types';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';

/**
 * 单词遭遇事件 SQLite 仓储。
 */
@injectable()
export default class WordEncounterRepositoryImpl implements WordEncounterRepository {
    /**
     * @param db 数据库实例。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async record(value: InsertWordEncounter): Promise<void> {
        this.db.insert(wordEncounter).values(value).run();
    }
}
