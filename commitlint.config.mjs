/**
 * commitlint 配置。
 *
 * 为什么这个仓库需要它：发版流程由 release-please 驱动，版本号与 CHANGELOG
 * 都是从提交信息（Conventional Commits）推导出来的。一条格式不合规的提交
 * 会让该变更从 CHANGELOG 里消失、或者把版本号判错，而这些问题在发版前
 * 完全看不出来。提交信息在这里是「承重结构」，不是风格偏好。
 *
 * 相对 config-conventional 默认值只放宽了三条，原因都与中文正文和专有名词有关：
 * - header-max-length 从 100 放宽到 120：中文一个字符承载的信息量比英文大，
 *   同样长度的标题往往还没说完一件事。
 * - body-max-line-length 关闭：正文是中文散文式说明，按 100 字符硬换行会让
 *   句子碎成几段，反而更难读。Git 本身不做行宽约束，这条规则只影响观感。
 * - subject-case 关闭：主题大量以专有名词开头（YouTube、OpenAI、Electron、
 *   SQLite、ffmpeg），而该规则会把「首字母大写」判成 sentence-case 违规。
 *   对中文主题它本来也不提供任何信息。
 */
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'header-max-length': [2, 'always', 120],
        'body-max-line-length': [0],
        'subject-case': [0],
    },
};
