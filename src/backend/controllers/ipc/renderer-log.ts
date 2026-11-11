// src/backend/ipc/renderer-log.ts
import { ipcMain } from 'electron';
import type { SimpleEvent, SimpleLevel } from '@/common/log/simple-types';
import type { RendererEventChannel } from '@/common/api/renderer-event-def';
import { writeEvent } from '@/backend/infrastructure/logger';

/**
 * 渲染进程日志写入通道。
 *
 * 走单向事件而不是请求/响应路由：日志写不进去不该让渲染进程等一个结果。
 * 通道名与载荷类型由 renderer-event-def.ts 统一约束。
 */
const RENDERER_LOG_CHANNEL: RendererEventChannel = 'dp-log/write';

/** 合法的日志级别白名单。 */
const LEVELS: ReadonlySet<string> = new Set<SimpleLevel>(['debug', 'info', 'warn', 'error']);

/**
 * 单条渲染层日志允许的最大字符数。
 *
 * 与主进程 `MAX_STRING_LENGTH` 同量级：渲染层若发出超长单行，既会突破日志文件的
 * 4MB 轮转阈值（轮转判断发生在写入前），也会让日志本身不可读。
 */
const MAX_RENDERER_LOG_LENGTH = 8000;

/**
 * 把渲染层传来的任意值收敛成可安全落盘的字符串。
 *
 * @param value 原始值。
 * @returns 截断后的字符串；非字符串返回空串。
 */
const toBoundedString = (value: unknown): string => {
    if (typeof value !== 'string') {
        return '';
    }
    return value.length > MAX_RENDERER_LOG_LENGTH
        ? `${value.slice(0, MAX_RENDERER_LOG_LENGTH)}…`
        : value;
};

/**
 * 判断传入的时间戳是否是合法 ISO 8601。
 *
 * 渲染层的时钟/时区可以任意伪造；非法值一律回落到主进程当前时间，
 * 避免日志时间线被污染成无法排序的形状。
 *
 * @param value 原始时间戳。
 * @returns 合法时返回原值，否则返回 null。
 */
const toIsoTimestamp = (value: unknown): string | null => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : value;
};

ipcMain.on(RENDERER_LOG_CHANNEL, (_event, raw: unknown) => {
    // 通道载荷来自渲染进程，不能假设形状正确：非对象、非字符串 msg 都会在
    // 下游的 maskSensitiveValues 里抛 TypeError，把主进程的 IPC 回调打崩。
    if (!raw || typeof raw !== 'object') {
        return;
    }
    const e = raw as Partial<SimpleEvent>;
    const level = typeof e.level === 'string' && LEVELS.has(e.level) ? e.level as SimpleLevel : 'info';
    const msg = toBoundedString(e.msg);
    if (!msg) {
        return;
    }
    writeEvent({
        ts: toIsoTimestamp(e.ts) ?? new Date().toISOString(),
        level,
        process: 'renderer',
        module: toBoundedString(e.module) || 'unknown',
        msg,
        data: e.data,
        traceId: typeof e.traceId === 'string' && e.traceId.length <= 64 ? e.traceId : undefined,
    });
});
