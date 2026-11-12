const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 把「上次遇见 / 上次复习」的时间格式化成相对描述。
 *
 * 用相对时间而不是绝对日期：用户关心的是「三周前」，不是「10 月 21 日」。
 * 超过 30 天退回日期，避免出现「第 47 天前」这种没人会换算的说法。
 *
 * @param iso ISO 时间；null 表示从未发生。
 * @param locale 当前界面语言。
 * @param t 翻译函数。
 * @param neverKey 从未发生时的文案键。
 * @returns 可展示的时间描述。
 */
export const formatMemoryWhen = (
    iso: string | null,
    locale: string,
    t: Translate,
    neverKey: string,
): string => {
    if (!iso) {
        return t(neverKey);
    }
    const time = Date.parse(iso);
    if (Number.isNaN(time)) {
        return t(neverKey);
    }
    const diff = Date.now() - time;
    // 未来时间（时钟漂移或数据异常）按「刚刚」处理，不显示负数。
    if (diff < MINUTE_MS) {
        return t('wordMemory.justNow');
    }
    if (diff < HOUR_MS) {
        return t('wordMemory.minutesAgo', { count: Math.round(diff / MINUTE_MS) });
    }
    if (diff < DAY_MS) {
        return t('wordMemory.hoursAgo', { count: Math.round(diff / HOUR_MS) });
    }
    const days = Math.round(diff / DAY_MS);
    if (days <= 30) {
        return t('wordMemory.daysAgo', { count: days });
    }
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(time));
};
