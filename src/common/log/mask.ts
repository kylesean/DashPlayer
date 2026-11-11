/**
 * 日志脱敏工具：按字段名与字符串值模式对敏感信息统一掩码。
 * 供 IPC 日志（registerRoute）与主进程/渲染端日志（simple-logger）共用。
 */

/**
 * 敏感字段名匹配规则：命中即整体掩码。
 *
 * - 前半段按「包含」匹配凭据关键词，覆盖 apiKey / api_key / API-KEY 等命名变体；
 * - `^key` 覆盖独立 key 字段（openai.key、key-store、keystore）以及 key1 这类变体；
 * - `key$` 覆盖 privateKey、session_key 这类以 key 结尾的复合名。
 *
 * 规则对原始字段名与归一化后的字段名都成立（分隔符可选），
 * 因此直接测试原始字段名也不会漏判。
 *
 * 刻意选择「宁可多掩码」：key1、monkey 这类不含真实凭据的字段被一并掩掉，
 * 只是日志里多几颗星，换来的是任何以 key 开头/结尾的命名都不会漏。
 */
export const SENSITIVE_KEY_RE = /(api[-_]?key|access[-_]?key|pass[-_]?word|secret|token|passwd|pwd|authorization|auth|cookie|credential)|^key|key$/i;

/**
 * 归一化敏感字段名：转小写并去掉 `_`、`-` 分隔符。
 *
 * 为什么先归一化再匹配：旧实现直接用 `/\bkey\b/` 这类正则，靠词边界识别独立字段，
 * 但真实配置里的键名大多是复合写法（snake_case 的 api_key、camelCase 的 privateKey），
 * 词边界根本不成立，凭据字段会整条漏进日志。归一化把所有命名形态折叠成同一形状，
 * 规则才不会随命名风格漏网——请勿为了“简化”把这里改回按词边界匹配。
 *
 * @param key 原始字段名。
 * @returns 归一化后的字段名（小写且不含 `_`、`-`）。
 */
export function normalizeSensitiveKey(key: string): string {
    return key.toLowerCase().replace(/[_-]/g, '');
}

/**
 * 敏感值模式：字符串中命中即替换为掩码占位。
 *
 * 除密钥前缀外，还要覆盖「凭据藏在 URL 查询串里」这一形态：手机访问地址
 * 形如 `http://192.168.1.5:27182/?t=<token>`，字段名 `lanUrls` 不敏感，
 * 值里也没有 `sk-`/`Bearer`，只靠键名规则会让令牌原样落盘。
 */
const SENSITIVE_VALUE_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
    { pattern: /sk-[A-Za-z0-9_-]{16,}/g, replace: 'sk-***' },
    { pattern: /Bearer\s+\S+/g, replace: 'Bearer ***' },
    // URL 查询串里的访问令牌：?t=... / &t=... / ?token=...
    { pattern: /([?&](?:t|token|access_token)=)[^&\s"'#]+/gi, replace: '$1***' },
];

/**
 * 判断字段名是否为敏感字段。
 * @param key 字段名。
 * @returns 命中敏感字段名返回 true。
 */
export function isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_RE.test(normalizeSensitiveKey(key));
}

/**
 * 对字符串中的敏感值模式做掩码替换。
 * @param text 原始字符串。
 * @returns 掩码后的字符串；无敏感模式时原样返回。
 */
export function maskSensitiveValues(text: string): string {
    let masked = text;
    for (const { pattern, replace } of SENSITIVE_VALUE_PATTERNS) {
        masked = masked.replace(pattern, replace);
    }
    return masked;
}
