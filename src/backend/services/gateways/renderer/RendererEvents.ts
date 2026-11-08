import type { RuntimeSettingKey } from '@/common/contracts/runtime-settings';
import type { DpTask } from '@/common/contracts/dp-task';
import type { WindowState } from '@/common/types/Types';

/**
 * 主进程向渲染进程推送运行时事件的端口。
 */
export default interface RendererEvents {
    storeUpdate(key: RuntimeSettingKey, value: string): void;
    dpTaskUpdate(task: DpTask): void;
    windowStateUpdate(state: WindowState): void;
    error(error: Error): void;
    info(message: string): void;
}
