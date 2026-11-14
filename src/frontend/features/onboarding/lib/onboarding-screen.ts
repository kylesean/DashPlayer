/**
 * 引导流程的屏幕。
 *
 * `finishing` 单独成为一个屏幕，而不是叠加在 `download` 之上的布尔值：
 * 收尾期间「页面还是下载页」和「正在写配置」这两个事实必须互斥，
 * 否则用户在收尾途中点返回或手动下载，会被异步收尾强行拽到完成页。
 */
export type OnboardingScreen = 'storage' | 'download' | 'manual' | 'done' | 'finishing';

/**
 * 引导流程的导航事件。
 */
export type OnboardingEvent =
    /** 存储页点「下一步」。 */
    | 'NEXT'
    /** 下载页点「返回」。 */
    | 'BACK'
    /** 下载页点「手动下载」。 */
    | 'OPEN_MANUAL'
    /** 手动下载页点「返回」。 */
    | 'CLOSE_MANUAL'
    /** 开始收尾（写引擎选择与引导完成标记）。 */
    | 'START_FINISH'
    /** 收尾成功。 */
    | 'FINISH_OK'
    /** 收尾失败，退回下载页让用户重试。 */
    | 'FINISH_FAILED';

/** 事件到目标屏幕的映射；未列出的组合一律非法。 */
const TRANSITIONS: Record<OnboardingScreen, Partial<Record<OnboardingEvent, OnboardingScreen>>> = {
    storage: {
        NEXT: 'download',
    },
    download: {
        BACK: 'storage',
        OPEN_MANUAL: 'manual',
        START_FINISH: 'finishing',
    },
    manual: {
        CLOSE_MANUAL: 'download',
    },
    finishing: {
        FINISH_OK: 'done',
        FINISH_FAILED: 'download',
    },
    done: {},
};

/**
 * 计算下一个屏幕。
 *
 * 返回 `null` 表示该事件在当前屏幕下非法，调用方应忽略它。
 * 收尾中只接受「成功 / 失败」两个事件，任何导航都会被拒绝——
 * 这是「收尾期间不能离开下载页」这条规则的唯一落点。
 *
 * @param screen 当前屏幕。
 * @param event 触发事件。
 * @returns 下一个屏幕；非法转移返回 null。
 */
export function transitionOnboardingScreen(
    screen: OnboardingScreen,
    event: OnboardingEvent
): OnboardingScreen | null {
    return TRANSITIONS[screen][event] ?? null;
}

/**
 * 判断当前屏幕是否正在收尾。
 *
 * @param screen 当前屏幕。
 * @returns 收尾中返回 true。
 */
export function isFinishing(screen: OnboardingScreen): boolean {
    return screen === 'finishing';
}

/**
 * 判断当前是否允许离开下载页（返回 / 手动下载）。
 *
 * @param screen 当前屏幕。
 * @param downloading 是否正在下载资源包。
 * @returns 可以离开时返回 true。
 */
export function canLeaveDownload(screen: OnboardingScreen, downloading: boolean): boolean {
    return screen === 'download' && !downloading;
}
