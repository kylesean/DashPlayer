/**
 * 整句学习工作台入口状态的相位派生。
 *
 * 为什么值得单独成文件：入口状态由四个 store 字段组成
 * （learningVisible / hasLearningContext / chatSessionId / sentenceResolveError），
 * 此前 UI 与测试要同时读其中两三个才能回答「现在处于什么阶段」；
 * 乐观进入窗口（可见但会话未建）、失败隐藏（不可见但有错误残留）这类组合态
 * 靠读代码记忆。这里用纯函数把组合态收敛为四个可命名的相位，只推导、不存储，
 * 不改变任何 store 字段的写入方式（写入收敛见 chatStore 的 applyLearningTransition）。
 *
 * 与 `practice/lib/recorder-phase.ts` 的差异：那台机器有显式事件表约束「能发生什么」，
 * 本相位是**事后派生**——learningEntry 的转换入口多（乐观进入/重开/失败/隐藏），
 * 显式表反而要覆盖大量旁路事件，收益为负；派生函数足以让组合态可测、可检索。
 */

/** 整句学习工作台的相位。 */
export type LearningPhase =
    /** 工作台关闭且无失败残留（hideLearning / clear 之后的常态）。 */
    | 'hidden'
    /** 乐观进入窗口：界面可见但会话尚未建好（openSentenceSession 已占位、createSession 在途）。 */
    | 'resolving'
    /** 会话就绪，可正常对话与生成。 */
    | 'ready'
    /** 入口失败：工作台已隐藏，错误文本残留待下次进入时展示/清除。 */
    | 'failed';

export interface LearningSessionFacts {
    learningVisible: boolean;
    chatSessionId: string;
    sentenceResolveError: string | null;
}

/**
 * 从 store 字段组合派生当前相位。
 *
 * 已接受的组合态及其归属（勿当 bug 报）：
 * - `learningVisible=true && sentenceResolveError!=null`：resolving 期间的信息性错误
 *   （如云可用性探测失败，流程仍继续），归入 resolving，错误由 UI 另行展示。
 * - `learningVisible=false && chatSessionId!=''`：隐藏但保留现场（hasLearningContext
 *   维持挂载），归入 hidden——重开同句走 reopenLearning 直接回现场。
 */
export function deriveLearningPhase(facts: LearningSessionFacts): LearningPhase {
    if (!facts.learningVisible) {
        return facts.sentenceResolveError ? 'failed' : 'hidden';
    }
    return facts.chatSessionId ? 'ready' : 'resolving';
}
