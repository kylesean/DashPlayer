import { describe, expect, it } from 'vitest';
import {
    canApplyServerSnapshot,
    deriveAutoSavePhase,
    shouldCommitAgain,
} from '../auto-save-machine';

describe('自动保存阶段推导', () => {
    it('无脏无在途即 idle', () => {
        expect(deriveAutoSavePhase({ dirty: false, inFlight: false, failed: false })).toBe('idle');
    });

    it('有脏无在途即 dirty', () => {
        expect(deriveAutoSavePhase({ dirty: true, inFlight: false, failed: false })).toBe('dirty');
    });

    it('在途且无脏即 saving', () => {
        expect(deriveAutoSavePhase({ dirty: false, inFlight: true, failed: false })).toBe('saving');
    });

    it('在途且有脏即 saving-dirty，表示本轮结束后还要再存一次', () => {
        const phase = deriveAutoSavePhase({ dirty: true, inFlight: true, failed: false });
        expect(phase).toBe('saving-dirty');
        expect(shouldCommitAgain(phase)).toBe(true);
    });

    it('失败优先于其它一切，用户必须看到错误', () => {
        expect(deriveAutoSavePhase({ dirty: true, inFlight: true, failed: true })).toBe('error');
        expect(deriveAutoSavePhase({ dirty: false, inFlight: false, failed: true })).toBe('error');
    });

    it('只有 saving-dirty 需要补提交', () => {
        expect(shouldCommitAgain('idle')).toBe(false);
        expect(shouldCommitAgain('dirty')).toBe(false);
        expect(shouldCommitAgain('saving')).toBe(false);
        expect(shouldCommitAgain('error')).toBe(false);
    });
});

describe('服务端快照回放保护', () => {
    it('首次初始化必须放行，否则页面永远停在加载态', () => {
        expect(canApplyServerSnapshot(false, '', null, '{"url":"a"}')).toBe(true);
    });

    it('本地已是目标值时放行（重置为空操作）', () => {
        expect(canApplyServerSnapshot(true, '{"url":"a"}', '{"url":"a"}', '{"url":"a"}')).toBe(true);
    });

    it('本地没有未保存改动时接受后台刷新', () => {
        expect(canApplyServerSnapshot(true, '{"url":"a"}', '{"url":"a"}', '{"url":"remote"}')).toBe(true);
    });

    it('本地有未保存改动时拒绝回放，避免擦掉用户正在输入的内容', () => {
        // 基线是 b，本地已改成 c，服务端回放 b：必须拒绝
        expect(canApplyServerSnapshot(true, '{"url":"c"}', '{"url":"b"}', '{"url":"b"}')).toBe(false);
    });
});
