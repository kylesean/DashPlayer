import { create } from 'zustand';

/**
 * 视频播放结束后的复盘提示。
 *
 * 视频自然结束是一个明确的「这一段学完了」时刻，适合提示复盘；但提示本身
 * 必须可关闭且只出现一次，否则每次暂停/继续都会弹一次。这里用请求序号
 * 表达一次性意图，由播放器工具栏消费，避免把状态塞进播放器 store。
 */
interface RecapPromptStore {
    /** 请求提示的会话键；同一会话只提示一次。 */
    promptKey: string | null;
    /** 已提示过的会话键集合，跨会话切换后仍能避免重复打扰。 */
    promptedKeys: Record<string, true>;
    /**
     * 复盘弹层是否打开。
     *
     * 放在 store 而不是组件内部 state：视频结束提示在字幕面板上方，
     * 弹层在工具栏里，两处必须共享同一个开关，否则要靠在 effect 里
     * 同步两份状态——那正是级联渲染的来源。
     */
    recapOpen: boolean;
    /**
     * 视频结束时请求一次复盘提示。
     *
     * @param key 会话键；为空时不提示（播放器还没绑定媒体）。
     */
    requestPrompt: (key: string | null) => void;
    /** 用户关闭提示后清空当前请求。 */
    dismiss: () => void;
    /** 打开或关闭复盘弹层。 */
    setRecapOpen: (open: boolean) => void;
}

export const useRecapPromptStore = create<RecapPromptStore>((set, get) => ({
    promptKey: null,
    promptedKeys: {},
    recapOpen: false,
    requestPrompt: (key) => {
        if (!key || get().promptedKeys[key]) {
            return;
        }
        set((state) => ({
            promptKey: key,
            promptedKeys: { ...state.promptedKeys, [key]: true },
        }));
    },
    dismiss: () => set({ promptKey: null }),
    setRecapOpen: (open) => set({ recapOpen: open }),
}));
