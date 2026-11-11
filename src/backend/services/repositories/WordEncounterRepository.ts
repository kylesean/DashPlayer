import type { InsertWordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';

/**
 * 单词遭遇事件仓储。
 */
export default interface WordEncounterRepository {
    /**
     * 追加一条遭遇事件。
     *
     * @param value 事件内容。
     */
    record(value: InsertWordEncounter): Promise<void>;
}
