// src/backend/ipc/renderer-log.ts
import { ipcMain } from 'electron';
import type { SimpleEvent } from '@/common/log/simple-types';
import type { RendererEventChannel } from '@/common/api/renderer-event-def';
import { writeEvent } from '@/backend/infrastructure/logger';

/**
 * 渲染进程日志写入通道。
 *
 * 走单向事件而不是请求/响应路由：日志写不进去不该让渲染进程等一个结果。
 * 通道名与载荷类型由 renderer-event-def.ts 统一约束。
 */
const RENDERER_LOG_CHANNEL: RendererEventChannel = 'dp-log/write';

ipcMain.on(RENDERER_LOG_CHANNEL, (_event, e: SimpleEvent) => {
    writeEvent({
        ts: e.ts || new Date().toISOString(),
        level: e.level,
        process: 'renderer',
        module: e.module || 'unknown',
        msg: e.msg || '',
        data: e.data,
        traceId: e.traceId,
    });
});
