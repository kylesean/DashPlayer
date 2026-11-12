/**
 * 本地 ASR（whisper.cpp / parakeet）失败信息的可读化。
 *
 * 为什么需要它：parakeet 在「没有人声 / 全是静音 / 说中文」时会返回
 * `Segments (0)`，并把上千字符的 C++ 初始化日志（模型加载、Vulkan 探测、
 * 逐 token 时间轴）一并拼进异常消息。原样透到界面就是一个整屏弹框，
 * 用户既看不懂，也不知道下一步该做什么。
 *
 * 这里只做**分类**，不吞掉未知错误：只有确认是「没识别出语音」才替换成
 * 可操作提示，其余错误原样返回，避免把真正的故障伪装成用户操作问题。
 */

/** 判定「没有识别出任何语音」的特征串。 */
const NO_SPEECH_PATTERNS = [
    /未返回识别文本/,
    /Segments\s*\(\s*0\s*\)/,
    /未返回\s*token\s*时间轴/,
    /录音内容为空/,
] as const;

/** 剥掉 Electron IPC 在错误消息前面加的固定前缀。 */
const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

/**
 * 判断异常是否属于「没有识别出语音」。
 *
 * @param message 原始错误消息。
 * @returns 属于该类别时返回 true。
 */
export const isNoSpeechError = (message: string): boolean =>
    NO_SPEECH_PATTERNS.some((pattern) => pattern.test(message));

/**
 * 把 ASR 异常转成用户能理解、且知道下一步做什么的提示。
 *
 * @param error 捕获到的异常。
 * @returns 可展示的单行消息；非「无语音」类错误返回剥离 IPC 前缀后的首行。
 */
export const describeAsrFailure = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : String(error);
    const stripped = raw.replace(IPC_PREFIX, '').trim();

    if (isNoSpeechError(stripped)) {
        // parakeet 只支持英文；用中文跟读时同样会得到 Segments (0)，
        // 直接说「没听到声音」会把用户引向错误的排查方向。
        return /parakeet/i.test(stripped)
            ? '没有识别到英文语音。请确认对着麦克风用英语朗读，且麦克风没有被静音。'
            : '没有识别到语音。请靠近麦克风、避开环境噪音后重试。';
    }

    // 未知错误保留首行：完整 stderr 对用户没有价值，但完全隐藏会丢失排查线索。
    return stripped.split('\n')[0]?.slice(0, 200) || '语音识别失败';
};
