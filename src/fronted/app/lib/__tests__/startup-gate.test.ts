import { describe, expect, it } from 'vitest';
import { resolveStartupGate } from '../startup-gate';

const failedMigration = {
    failed: true,
    phase: 'custom',
    migrationId: 'store-schema-dictionary-youdao-v2',
    description: '清理有道词典链路存量数据',
    errorMessage: 'SQLITE_BUSY: database is locked',
};

const healthyMigration = {
    failed: false,
    phase: null,
    migrationId: null,
    description: null,
    errorMessage: null,
};

describe('启动门槛裁决', () => {
    it('迁移失败优先于引导与主界面', () => {
        expect(resolveStartupGate(failedMigration, null)).toEqual({
            kind: 'migration-failure',
            failure: failedMigration,
        });
        expect(resolveStartupGate(failedMigration, '1')).toEqual({
            kind: 'migration-failure',
            failure: failedMigration,
        });
    });

    it('迁移正常时，从未完成引导进入引导页', () => {
        expect(resolveStartupGate(healthyMigration, null)).toEqual({ kind: 'onboarding' });
    });

    it('迁移正常且已完成过引导时进入主界面', () => {
        expect(resolveStartupGate(healthyMigration, '1')).toEqual({ kind: 'main' });
    });

    it('读取失败（null）不拦截启动，按已完成状态放行', () => {
        // 一次 IPC 异常不该把用户永久锁在启动页。
        expect(resolveStartupGate(null, '1')).toEqual({ kind: 'main' });
        expect(resolveStartupGate(null, null)).toEqual({ kind: 'onboarding' });
    });

    it('空串版本号视为从未完成引导', () => {
        // 后端没写过配置时可能返回空串而不是 null，二者语义必须一致。
        expect(resolveStartupGate(healthyMigration, '')).toEqual({ kind: 'onboarding' });
    });

    it('失败详情即使缺少其他字段也能裁决（只要 failed 为真）', () => {
        expect(resolveStartupGate({ failed: true }, '1')).toEqual({
            kind: 'migration-failure',
            failure: { failed: true },
        });
    });
});
