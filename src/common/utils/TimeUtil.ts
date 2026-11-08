import { formatDistanceToNow, isValid, parseISO } from 'date-fns';
import StrUtil from '@/common/utils/str-util';
import { TypeGuards } from '@/common/utils/TypeGuards';
import type { Nullable } from '@/common/types/Types';

/** 将非负整数补齐为至少两位数字字符串。 */
const pad2 = (value: number): string => String(value).padStart(2, '0');

/** 数据库层面纯日期时间（无时区标识）格式，按 UTC 解析。 */
const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * 时间格式化与解析工具集，统一前后端与 FFmpeg 的时间字符串转换逻辑。
 */
export default class TimeUtil {
    /**
     * 将秒数格式化为紧凑时长字符串（`MM:SS` 或超过一小时时的 `H:MM:SS`）。
     *
     * @param second 时长秒数；为 `null` 或 `undefined` 时返回空字符串。
     * @returns 格式化后的紧凑时长文本。
     */
    public static secondToTimeStrCompact(second: Nullable<number>): string {
        if (second === null || second === undefined) {
            return '';
        }
        const h = Math.floor(second / 3600);
        const m = Math.floor(second % 3600 / 60);
        const s = Math.floor(second % 60);
        const ss = pad2(s);
        if (h > 0) {
            return `${h}:${pad2(m)}:${ss}`;
        }
        return `${pad2(m)}:${ss}`;
    }

    /**
     * 将秒数格式化为标准 `HH:mm:ss` 时长字符串。
     *
     * @param second 时长秒数；为 `null` 或 `undefined` 时返回空字符串。
     * @returns `HH:mm:ss` 格式字符串；对超过 24 小时的时长直接累加小时数而不回绕。
     */
    public static secondToTimeStr(second: Nullable<number>): string {
        if (TypeGuards.isNull(second)) {
            return '';
        }
        const totalSeconds = Math.max(0, Math.floor(second));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
    }

    /**
     * 将秒数格式化为带毫秒的 `HH:mm:ss.SSS` 时间字符串，常用于 FFmpeg 精确截帧定位。
     *
     * @param second 时长秒数；为 `null` 或 `undefined` 时返回空字符串。
     * @returns `HH:mm:ss.SSS` 格式字符串，毫秒按四舍五入取整避免浮点精度偏移。
     */
    public static secondToTimeStrWithMs(second: Nullable<number>): string {
        if (TypeGuards.isNull(second)) {
            return '';
        }
        const totalMs = Math.max(0, Math.round(second * 1000));
        const hours = Math.floor(totalMs / 3_600_000);
        const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
        const secs = Math.floor((totalMs % 60_000) / 1000);
        const ms = totalMs % 1000;
        return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}.${String(ms).padStart(3, '0')}`;
    }

    /**
     * 将 ISO 8601 字符串或数据库存储的 UTC `YYYY-MM-DD HH:mm:ss` 字符串解析为 `Date`。
     *
     * @param iso 时间字符串；为空白或无法解析时返回当前时刻的 `Date`。
     * @returns 解析后的 `Date` 对象。
     */
    public static isoToDate(iso: Nullable<string>): Date {
        if (StrUtil.isBlank(iso)) {
            return new Date();
        }
        const trimmed = iso.trim();
        const normalized = NAIVE_DATETIME_RE.test(trimmed)
            ? `${trimmed.replace(' ', 'T')}Z`
            : trimmed;
        const parsed = parseISO(normalized);
        if (!isValid(parsed)) {
            return new Date();
        }
        return parsed;
    }

    /**
     * 将给定时间格式化为相对当前时刻的可读文案（如 `5 minutes ago`）。
     *
     * @param date 目标日期。
     * @returns 相对时间描述。
     */
    public static dateToRelativeTime(date: Date): string {
        return formatDistanceToNow(date, { addSuffix: true });
    }

    /**
     * 将秒数按每 15 秒分段并映射到所在分段的中心时间点。
     *
     * @param seconds 输入秒数。
     * @returns 所在 15 秒分段的中点秒数。
     */
    public static toGroupMiddle(seconds: number): number {
        const segment = Math.floor(seconds / 15);
        return segment * 15 + 7.5;
    }

    /**
     * 返回当前时刻的数据库 UTC 时间字符串（`YYYY-MM-DD HH:mm:ss`）。
     *
     * @returns UTC 格式的当前时间字符串。
     */
    public static timeUtc(): string {
        return TimeUtil.dateToUtc(new Date());
    }

    /**
     * 将 `Date` 实例格式化为数据库约定的 UTC 时间字符串（`YYYY-MM-DD HH:mm:ss`）。
     *
     * @param date 有效的 `Date` 实例；传入无效日期将显式抛错。
     * @returns UTC 格式时间字符串。
     */
    public static dateToUtc(date: Date): string {
        if (!isValid(date)) {
            throw new Error('无效的日期对象，无法格式化为 UTC 时间');
        }
        return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
    }

    /**
     * 将 `HH:mm:ss` 字符串转换为中文时分秒文本。
     *
     * @param timeStr 冒号分隔的时分秒字符串。
     * @returns 中文格式化时间（如 `01时02分03秒`）。
     */
    public static timeStrToChinese(timeStr: string): string {
        const [h, m, s] = timeStr.split(':');
        return `${h}时${m}分${s}秒`;
    }
}
