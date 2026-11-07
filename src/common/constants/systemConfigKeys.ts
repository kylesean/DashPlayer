/** 更新提示最近一次展示时间的系统配置键。 */
export const UPDATE_TOAST_LAST_SHOWN_AT_KEY = 'update.toastLastShownAt';

/** 用户首次使用引导完成版本的系统配置键（例如 '1'，后续版本升级有新引导可递增）。 */
export const ONBOARDING_COMPLETED_VERSION_KEY = 'onboarding.completedVersion';

/**
 * 字幕意群重切分的系统配置键。
 *
 * 开启时解析层把滚动式碎片字幕（YouTube 自动字幕）重切分成完整意群，
 * 翻译与精听循环都以意群为单位。未写入时视为开启（默认行为）。
 */
export const SUBTITLE_MEANING_GROUP_RESEGMENTATION_KEY = 'subtitle.meaningGroupResegmentation';
