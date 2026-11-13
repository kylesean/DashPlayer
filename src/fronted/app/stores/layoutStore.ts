import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';

const api = backendClient;

/** 窗口分级断点标识。 */
export type ScreenSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SCREEN_SIZES: ScreenSize[] = ['sm', 'md', 'lg', 'xl', '2xl'];

/** 全局布局状态。 */
export type UseLayoutState = {
    /** 播放页右侧字幕面板与导航栏是否展开。 */
    showSideBar: boolean;
    /** 顶部标题栏预留高度（像素）。 */
    /** 当前视口宽度分级。 */
    width: ScreenSize;
    /** 当前视口高度分级。 */
    height: ScreenSize;
    /** 是否处于全屏模式。 */
    fullScreen: boolean;
    /** 是否处于纯播客无画面模式。 */
    podcastMode: boolean;
    /** 是否正在整句对话学习面板中交互。 */
    chatting: boolean;
    /** 主侧边栏是否处于收起为紧凑图标轨的状态。 */
    sidebarCollapsed: boolean;
    /** 播放页字幕文稿流面板是否显示。 */
    showTranscript: boolean;
    /** 播放页字幕文稿流显示模式：'sentence'（单句精析）或 'article'（连贯讲稿）。 */
    transcriptViewMode: 'sentence' | 'article';
};

/** 全局布局状态修改动作。 */
export type UseLayoutActions = {
    /** 切换侧边栏显示状态。 */
    changeSideBar: (show: boolean) => void;
    /** 切换字幕文稿流显示状态。 */
    setTranscriptVisible: (visible: boolean) => void;
    /** 反转字幕文稿流显示状态。 */
    toggleTranscript: () => void;
    /** 设置字幕文稿流显示模式。 */
    setTranscriptViewMode: (mode: 'sentence' | 'article') => void;
    /** 切换字幕文稿流显示模式。 */
    toggleTranscriptViewMode: () => void;
    /** 切换全屏状态。 */
    changeFullScreen: (full: boolean) => void;
    /** 只同步窗口真实全屏状态，不再反向请求窗口（供 main 进程推送使用）。 */
    syncFullScreenFromWindow: (full: boolean) => void;
    /** 设置纯播客模式开关。 */
    setPodcastMode: (mode: boolean) => void;
    /** 更新对话学习输入激活态。 */
    changeChatting: (chatting: boolean) => void;
    /** 设置主侧边栏紧凑状态。 */
    setSidebarCollapsed: (collapsed: boolean) => void;
    /** 切换主侧边栏紧凑状态。 */
    toggleSidebarCollapsed: () => void;
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'refrain.sidebar_collapsed';
const TRANSCRIPT_VISIBLE_STORAGE_KEY = 'refrain.transcript_visible';
const TRANSCRIPT_VIEW_MODE_STORAGE_KEY = 'refrain.transcript_view_mode';

const readInitialSidebarCollapsed = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
        if (stored !== null) {
            return stored === 'true';
        }
    } catch {
        // 忽略存储访问异常
    }
    return false;
};

const readInitialTranscriptVisible = (): boolean => {
    if (typeof window === 'undefined') return true;
    try {
        const stored = localStorage.getItem(TRANSCRIPT_VISIBLE_STORAGE_KEY);
        if (stored !== null) {
            return stored === 'true';
        }
    } catch {
        // 忽略存储访问异常
    }
    return true;
};

const readInitialTranscriptViewMode = (): 'sentence' | 'article' => {
    if (typeof window === 'undefined') return 'sentence';
    try {
        const stored = localStorage.getItem(TRANSCRIPT_VIEW_MODE_STORAGE_KEY);
        if (stored === 'sentence' || stored === 'article') {
            return stored;
        }
    } catch {
        // 忽略存储访问异常
    }
    return 'sentence';
};

/**
 * 管理全局布局状态，包括侧边栏、窗口分级尺寸、全屏和播客模式。
 */
const useLayout = create<UseLayoutState & UseLayoutActions>()(
    subscribeWithSelector((set) => ({
        showSideBar: true,
        sidebarCollapsed: readInitialSidebarCollapsed(),
        showTranscript: readInitialTranscriptVisible(),
        transcriptViewMode: readInitialTranscriptViewMode(),
        chatting: false,
        width: '2xl',
        height: '2xl',
        fullScreen: false,
        changeSideBar: (show: boolean) => {
            set({ showSideBar: show });
        },
        setTranscriptVisible: (visible: boolean) => {
            try {
                localStorage.setItem(TRANSCRIPT_VISIBLE_STORAGE_KEY, String(visible));
            } catch {
                // 忽略存储访问异常
            }
            set({ showTranscript: visible });
        },
        toggleTranscript: () => {
            set((state) => {
                const next = !state.showTranscript;
                try {
                    localStorage.setItem(TRANSCRIPT_VISIBLE_STORAGE_KEY, String(next));
                } catch {
                    // 忽略存储访问异常
                }
                return { showTranscript: next };
            });
        },
        setTranscriptViewMode: (mode: 'sentence' | 'article') => {
            try {
                localStorage.setItem(TRANSCRIPT_VIEW_MODE_STORAGE_KEY, mode);
            } catch {
                // 忽略存储访问异常
            }
            set({ transcriptViewMode: mode });
        },
        toggleTranscriptViewMode: () => {
            set((state) => {
                const next = state.transcriptViewMode === 'sentence' ? 'article' : 'sentence';
                try {
                    localStorage.setItem(TRANSCRIPT_VIEW_MODE_STORAGE_KEY, next);
                } catch {
                    // 忽略存储访问异常
                }
                return { transcriptViewMode: next };
            });
        },
        setSidebarCollapsed: (collapsed: boolean) => {
            try {
                localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
            } catch {
                // 忽略存储访问异常
            }
            set({ sidebarCollapsed: collapsed });
        },
        toggleSidebarCollapsed: () => {
            set((state) => {
                const next = !state.sidebarCollapsed;
                try {
                    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
                } catch {
                    // 忽略存储访问异常
                }
                return { sidebarCollapsed: next };
            });
        },
        changeFullScreen: (full: boolean) => {
            // 重复设置同一个值不碰窗口：播客模式等流程会顺手调用 changeFullScreen(false)
            if (useLayout.getState().fullScreen === full) {
                return;
            }
            set({ fullScreen: full });
            // 应用内全屏必须同时把系统窗口切成全屏：只隐藏两侧面板的话，
            // 窗口仍带着任务栏/标题栏的高度，16:9 视频左右会留出灰边
            void api.call('system/window-size/change', full ? 'fullscreen' : 'player');
        },
        syncFullScreenFromWindow: (full: boolean) => {
            set({ fullScreen: full });
        },
        podcastMode: false,
        setPodcastMode: (mode: boolean) => {
            set({ podcastMode: mode });
        },
        changeChatting: (chatting: boolean) => {
            set({ chatting });
        },
    })),
);

/**
 * 根据当前视口尺寸刷新响应式断点分级。
 */
const updateSize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    let w: ScreenSize = '2xl';
    let h: ScreenSize = '2xl';
    if (width < 640) {
        w = 'sm';
    } else if (width < 768) {
        w = 'md';
    } else if (width < 1024) {
        w = 'lg';
    } else if (width < 1280) {
        w = 'xl';
    }
    if (height < 500) {
        h = 'sm';
    } else if (height < 600) {
        h = 'md';
    } else if (height < 700) {
        h = 'lg';
    } else if (height < 800) {
        h = 'xl';
    }

    useLayout.setState({ width: w, height: h });
};

/**
 * 判断当前宽度分级是否达到目标断点。
 *
 * @param screen 当前屏幕宽度分级。
 * @param condition 目标最小分级。
 * @returns 当前分级大于等于目标分级时返回 true。
 */
export const cpW = (screen: ScreenSize, condition: ScreenSize): boolean => {
    return SCREEN_SIZES.indexOf(condition) <= SCREEN_SIZES.indexOf(screen);
};

/**
 * 判断当前高度分级是否达到目标断点。
 *
 * @param screen 当前屏幕高度分级。
 * @param condition 目标最小分级。
 * @returns 当前分级大于等于目标分级时返回 true。
 */
export const cpH = (screen: ScreenSize, condition: ScreenSize): boolean => {
    return SCREEN_SIZES.indexOf(condition) <= SCREEN_SIZES.indexOf(screen);
};

updateSize();
window.addEventListener('resize', updateSize);

export default useLayout;
