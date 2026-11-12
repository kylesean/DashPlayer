/**
 * 把密钥脱敏成「只够核对、不够使用」的提示。
 *
 * 为什么不是直接返回明文：渲染进程拿到的任何字符串都可能经由 XSS、日志、
 * 崩溃上报或用户截图外泄。设置页真正需要的只是「我配的那个 key 还在不在」，
 * 一个末四位就足够核对，而末四位单独无法用于认证。
 *
 * 长度不足 8 位时一律返回全遮罩：短密钥的末四位可能已是很大比例，
 * 再露出去就没有脱敏意义了。
 *
 * @param secret 原始密钥；可能为空串或未配置。
 * @returns 形如 `••••abcd` 的提示；未配置时返回空串。
 */
export const maskSecret = (secret: string | null | undefined): string => {
    if (!secret) {
        return '';
    }
    const trimmed = secret.trim();
    if (trimmed.length === 0) {
        return '';
    }
    if (trimmed.length < 8) {
        return '••••';
    }
    return `••••${trimmed.slice(-4)}`;
};
