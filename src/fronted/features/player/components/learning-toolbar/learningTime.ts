const DAY_MS = 24 * 60 * 60 * 1000;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 格式化复习到期时间；近一天内用相对时间，更远用日期。
 *
 * @param iso 到期时间。
 * @param locale 当前界面语言。
 * @param t 翻译函数。
 * @returns 简短时间描述。
 */
export const formatLearningDue = (iso: string, locale: string, t: Translate): string => {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return t('reviewDock.dueUnknown');
    const diff = time - Date.now();
    if (diff <= 0) return t('reviewDock.dueNow');
    if (diff < 60 * 60 * 1000) {
        return t('reviewDock.dueInMinutes', { count: Math.max(1, Math.round(diff / 60000)) });
    }
    if (diff < DAY_MS) {
        return t('reviewDock.dueInHours', { count: Math.max(1, Math.round(diff / (60 * 60 * 1000))) });
    }
    const days = Math.round(diff / DAY_MS);
    if (days <= 30) {
        return t('reviewDock.dueInDays', { count: days });
    }
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(time));
};

/**
 * 格式化会话内的时间点，只显示时分。
 *
 * @param iso ISO 时间。
 * @param locale 当前界面语言。
 * @returns 时分文本；无效时间返回空串。
 */
export const formatLearningClock = (iso: string, locale: string): string => {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return '';
    return new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(time));
};
