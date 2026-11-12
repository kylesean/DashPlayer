import { and, asc, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    type InsertRolePlayTurn,
    rolePlayTurn,
    type RolePlayTurn,
} from '@/backend/infrastructure/db/tables/rolePlayTurn';
import type RolePlayTurnRepository from '@/backend/services/repositories/RolePlayTurnRepository';

/**
 * 多轮场景对话轮次仓储实现。
 */
@injectable()
export default class RolePlayTurnRepositoryImpl implements RolePlayTurnRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async upsertTurn(value: InsertRolePlayTurn): Promise<number> {
        // 同一轮重复提交（例如网络重试或用户改稿后重评）只保留最后一次结果，
        // 否则重开弹窗会看到同一轮的两条互相矛盾的点评。
        const existing = await this.db
            .select({ id: rolePlayTurn.id })
            .from(rolePlayTurn)
            .where(and(
                eq(rolePlayTurn.session_key, value.session_key),
                eq(rolePlayTurn.turn, value.turn),
            ))
            .limit(1);
        if (existing.length > 0) {
            await this.db
                .update(rolePlayTurn)
                .set(value)
                .where(eq(rolePlayTurn.id, existing[0].id));
            return existing[0].id;
        }
        const [record] = await this.db
            .insert(rolePlayTurn)
            .values(value)
            .returning({ id: rolePlayTurn.id });
        return record.id;
    }

    public async listBySession(sessionKey: string): Promise<RolePlayTurn[]> {
        return this.db
            .select()
            .from(rolePlayTurn)
            .where(eq(rolePlayTurn.session_key, sessionKey))
            .orderBy(asc(rolePlayTurn.turn));
    }
}
