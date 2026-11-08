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
    titleBarHeight: number;
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
};

/** 全局布局状态修改动作。 */
export type UseLayoutActions = {
    /** 切换侧边栏显示状态。 */
    changeSideBar: (show: boolean) => void;
    /** 切换全屏状态。 */
    changeFullScreen: (full: boolean) => void;
    /** 设置纯播客模式开关。 */
    setPodcastMode: (mode: boolean) => void;
    /** 更新对话学习输入激活态。 */
    changeChatting: (chatting: boolean) => void;
};

/**
 * 管理全局布局状态，包括侧边栏、窗口分级尺寸、全屏和播客模式。
 */
const useLayout = create<UseLayoutState & UseLayoutActions>()(
    subscribeWithSelector((set) => ({
        showSideBar: true,
        chatting: false,
        titleBarHeight: 0,
        width: '2xl',
        height: '2xl',
        fullScreen: false,
        changeSideBar: (show: boolean) => {
            set({ showSideBar: show });
        },
        changeFullScreen: (full: boolean) => {
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

api.call('system/info').then((sysInfo) => {
    useLayout.setState({ titleBarHeight: sysInfo.isWindows ? 28 : 0 });
});

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
