import type {
    InsertRolePlayTurn,
    RolePlayTurn,
} from '@/backend/infrastructure/db/tables/rolePlayTurn';

/**
 * 多轮场景对话轮次仓储。
 *
 * 只负责按会话键读写轮次，不做点评或掌握度计算。
 */
export default interface RolePlayTurnRepository {
    /**
     * 追加一轮；同一会话同一轮次重复提交时覆盖旧值。
     *
     * @returns 落库后的轮次序号。
     */
    upsertTurn(value: InsertRolePlayTurn): Promise<number>;

    /**
     * 按会话键读取全部轮次，按轮次升序。
     *
     * @param sessionKey 会话键。
     */
    listBySession(sessionKey: string): Promise<RolePlayTurn[]>;
}
