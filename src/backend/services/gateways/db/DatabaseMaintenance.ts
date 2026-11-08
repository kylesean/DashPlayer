/**
 * 数据库维护端口。
 *
 * 为应用服务层提供清空运行库等底层维护能力，避免服务层与控制器直接依赖数据库基础设施实现。
 */
export default interface DatabaseMaintenance {
    /**
     * 清空当前运行环境数据库中的所有业务表、索引和自增序列。
     *
     * 仅用于显式重置数据库场景，调用后原有业务数据将全部丢失。
     */
    clearAll(): Promise<void>;
}
