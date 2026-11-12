/**
 * 「无语音」类 ASR 错误的特征串契约。
 *
 * 这些字符串是**跨进程契约**：主进程的 throw 文案与渲染进程的错误分类
 * 正则必须保持一致，任何一侧改动都会让分类静默失效（用户看到原始 stderr
 * 而不是可操作提示）。因此生产端引用这里的常量抛错，消费端从常量派生
 * 正则，两侧由同一常量与契约测试钉住，不再靠字符串纪律维持。
 */

/** whisper.cpp 跑完但识别结果为空；生产端以 `whisper.cpp ${此常量}：{stderr}` 形态抛出。 */
export const ASR_ERROR_NO_RECOGNIZED_TEXT = '未返回识别文本';

/** whisper.cpp 跑完但缺失逐 token 时间轴（跟读评分依赖它）；抛出形态同上。 */
export const ASR_ERROR_NO_TOKEN_TIMELINE = '未返回 token 时间轴';

/** 录音字节检查未通过（空录音 / 纯静音）；原样作为错误消息抛出。 */
export const ASR_ERROR_EMPTY_RECORDING = '录音内容为空';

/**
 * parakeet 的「零分段」输出特征：没有人声 / 全是静音 / 说的是中文。
 * 这是 parakeet 自身 stdout 的固定格式，不是本仓抛出的文案，保持字面模式。
 */
export const ASR_ERROR_ZERO_SEGMENTS_PATTERN = 'Segments (0)';
