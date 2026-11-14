import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { useAutoSaveSettingsForm } from '@/frontend/features/settings/useAutoSaveSettingsForm';

let currentTranslate = (key: string) => key;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: currentTranslate }),
}));

/** 保存成功后 hook 会 mutate 详情缓存；测试里只关心它不抛错。 */
vi.mock('swr', () => ({
    useSWRConfig: () => ({ mutate: vi.fn().mockResolvedValue(undefined) }),
}));

interface TestForm {
    url: string;
}

/** 推进假时钟使防抖与保存微任务链跑完。 */
const settle = async (ms = 80): Promise<void> => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
};

/**
 * 挂载一个使用自动保存 hook 的最小表单。
 *
 * @param onSave 保存实现；测试可控制它何时完成、何时失败。
 */
const mountForm = (onSave: (values: TestForm) => Promise<void>) => renderHook(() => {
    const form = useForm<TestForm>({ defaultValues: { url: 'a' } });
    const auto = useAutoSaveSettingsForm<TestForm>({
        form,
        onSave,
        debounceMs: 5,
    });
    return { form, auto };
});

describe('设置自动保存表单', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('首次初始化必须应用服务端快照，否则页面永远停在加载态', async () => {
        const { result } = mountForm(async () => undefined);

        act(() => result.current.auto.initialize({ url: 'server' }));

        expect(result.current.auto.ready).toBe(true);
        expect(result.current.form.getValues('url')).toBe('server');
    });

    it('已确认缺陷回归：保存在途时用户继续输入，服务端快照回放不得擦掉新输入', async () => {
        let releaseFirstSave!: () => void;
        const onSave = vi.fn(() => new Promise<void>((resolve) => {
            releaseFirstSave = resolve;
        }));
        const { result } = mountForm(onSave);

        act(() => result.current.auto.initialize({ url: 'a' }));

        // 用户改成 b，防抖到期后开始保存 b（此时在途）
        act(() => result.current.form.setValue('url', 'b'));
        await settle();
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith({ url: 'b' });

        // 保存在途期间用户继续输入 c
        act(() => result.current.form.setValue('url', 'c'));

        // 保存 b 成功：基线推进到 b，随后 mutate 重取把 b 交回 initialize
        await act(async () => {
            releaseFirstSave();
            await vi.advanceTimersByTimeAsync(0);
        });
        act(() => result.current.auto.initialize({ url: 'b' }));

        // 修复前这里会变回 b，用户刚敲的 c 被擦掉。
        expect(result.current.form.getValues('url')).toBe('c');
    });

    it('没有未保存改动时接受服务端刷新（切走再切回的后台重校验）', async () => {
        const { result } = mountForm(async () => undefined);

        act(() => result.current.auto.initialize({ url: 'a' }));
        // 本地与服务端基线一致，此时后端改了值（例如另一个窗口保存）
        act(() => result.current.auto.initialize({ url: 'remote' }));

        expect(result.current.form.getValues('url')).toBe('remote');
    });

    it('保存失败后继续编辑仍会再次提交，改动不会丢失', async () => {
        let attempt = 0;
        const errors: string[] = [];
        const saved: string[] = [];
        const onSave = vi.fn(async (values: TestForm) => {
            attempt += 1;
            if (attempt === 1) {
                errors.push(values.url);
                throw new Error('network down');
            }
            saved.push(values.url);
        });
        const { result } = mountForm(onSave);

        act(() => result.current.auto.initialize({ url: 'a' }));
        act(() => result.current.form.setValue('url', 'b'));
        await settle();
        // 第一次保存确实失败了
        expect(errors).toEqual(['b']);

        act(() => result.current.form.setValue('url', 'c'));
        await settle();

        // 关键断言：失败没有让改动丢失，用户继续编辑后仍会落盘。
        // 失败当轮可能立刻重试一次（基线未推进），因此只断言最终值被保存。
        expect(saved.at(-1)).toBe('c');
    });

    it('初始化后无改动时不产生保存请求', async () => {
        const onSave = vi.fn(async () => undefined);
        const { result } = mountForm(onSave);

        act(() => result.current.auto.initialize({ url: 'a' }));
        await settle();

        expect(onSave).not.toHaveBeenCalled();
    });

    it('切换语言导致 t 引用变化时，不得触发卸载冲刷提交', async () => {
        const onSave = vi.fn(async () => undefined);
        const { result, rerender } = mountForm(onSave);

        act(() => result.current.auto.initialize({ url: 'a' }));
        act(() => result.current.form.setValue('url', 'b'));

        currentTranslate = (key: string) => `en:${key}`;
        rerender();
        expect(onSave).not.toHaveBeenCalled();

        currentTranslate = (key: string) => key;
    });

    it('首轮保存失败期间用户改回原基线并触发第二轮短路时，flush 仍会抛出首轮错误', async () => {
        let rejectFirst!: (err: Error) => void;
        const onSave = vi.fn(() => new Promise<void>((_, reject) => {
            rejectFirst = reject;
        }));
        const { result } = mountForm(onSave);

        act(() => result.current.auto.initialize({ url: 'a' }));
        act(() => result.current.form.setValue('url', 'b'));

        const flushPromise = result.current.auto.flush();
        // 第一轮保存仍在途时排队一次提交，并把值改回基线 a 让第二轮短路返回
        act(() => result.current.form.setValue('url', 'a'));
        await expect(result.current.auto.flush()).resolves.toBeUndefined();

        rejectFirst(new Error('save failed'));
        await expect(flushPromise).rejects.toThrow('save failed');
    });
});
