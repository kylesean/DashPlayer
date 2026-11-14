/**
 * 跟读录音的阶段转移表。
 *
 * 为什么值得单独成表：`usePracticeRecorder` 里 phase 有 4 个取值、7 个事件，
 * 但真正决定「能不能开始 / 停止 / 丢弃」的规则散在 4 个 `if` 与两个 effect 里。
 * 读代码时要同时看 `phase !== 'idle'`、`phase !== 'recording'`、`recorder.state`
 * 三处才能确定某个操作会不会生效，改一处很容易漏掉另一处。
 *
 * 这里只表达**允许发生什么**，不碰 DOM、不碰 MediaRecorder、不产生副作用：
 * 调用方仍然负责真正去停录音、释放麦克风。好处是「评分中不许丢弃」这类硬约束
 * 可以直接用纯函数测试钉住，而不需要伪造 MediaRecorder。
 */

/** 录音阶段：空闲 / 等待麦克风授权 / 采集中 / 已提交评分。 */
export type PracticeRecorderPhase = 'idle' | 'requesting' | 'recording' | 'processing';

/** 驱动阶段变化的事件。 */
export type PracticeRecorderEvent =
    /** 用户点「开始」：同步占位进入 requesting，之后才允许发起任何异步麦克风请求。 */
    | 'START'
    /** 麦克风就绪且 MediaRecorder 已 start：requesting → recording。 */
    | 'MIC_READY'
    /** 用户点「停止」：录音字节交给评分。 */
    | 'STOP'
    /** 录音界面退场（关面板 / 切页签 / 当前句消失）或麦克风授权失败/不支持：丢弃，不评分。 */
    | 'CANCEL'
    /** 评分结束（成功或失败都一样：回到空闲）。 */
    | 'SCORED'
    /** 录到空音频：不送评分，回到空闲。 */
    | 'EMPTY';

/**
 * 计算下一个阶段。
 *
 * 关键约束（每条都有测试钉住）：
 * - `processing` 不接受 `CANCEL`：音频已经交给评分链路，此时把阶段打回 `idle`
 *   会让用户立刻再开一段录音，与仍在进行的评分并发，结果挂到错误的句子上。
 * - `idle` 不接受 `STOP` / `SCORED` / `EMPTY`：这些事件只能由一次真实录音产生，
 *   否则会出现「没在录音却能触发评分收尾」的错位。
 *
 * 组件卸载不在这张表里：卸载后不会再有任何事件，`phase` 也就没有下一次读取者。
 * 卸载必须保证的是全局 `practiceStore.recorderPhase` 归位（回 idle），那由 hook 的
 * 卸载清理直接处理（见 `usePracticeRecorder` 的卸载 effect），用 `phase` 表达反而会掩盖它。
 *
 * @param phase 当前阶段。
 * @param event 事件。
 * @returns 下一个阶段；事件在当前阶段不合法时返回 null（调用方应忽略）。
 */
export function nextRecorderPhase(
    phase: PracticeRecorderPhase,
    event: PracticeRecorderEvent,
): PracticeRecorderPhase | null {
    switch (phase) {
        case 'idle':
            // START 必须在任何副作用（ensureMicrophone / getUserMedia）之前同步消费，
            // 否则快速二次触发会并行打开两条 MediaStream 并互相覆盖（麦克风泄漏）。
            return event === 'START' ? 'requesting' : null;
        case 'requesting':
            if (event === 'MIC_READY') {
                return 'recording';
            }
            // 授权被拒 / getUserMedia 失败 / 界面退场：回到空闲
            return event === 'CANCEL' ? 'idle' : null;
        case 'recording':
            if (event === 'STOP') {
                return 'processing';
            }
            if (event === 'CANCEL') {
                return 'idle';
            }
            // 空录音不经过评分，直接回到空闲
            return event === 'EMPTY' ? 'idle' : null;
        case 'processing':
            // 评分中只接受评分结束；CANCEL 必须被拒绝（见上）
            return event === 'SCORED' ? 'idle' : null;
        default:
            return null;
    }
}

/**
 * 该阶段是否仍在占用麦克风。
 *
 * 用来表达「哪些阶段需要释放音频轨道」：`processing` 已经停采，只是等评分结果。
 *
 * @param phase 阶段。
 * @returns 正在采集时为 true。
 */
export function isCapturing(phase: PracticeRecorderPhase): boolean {
    return phase === 'recording';
}
