import { describe, expect, it } from 'vitest';
import {
    canLeaveDownload,
    isFinishing,
    transitionOnboardingScreen,
    type OnboardingEvent,
    type OnboardingScreen,
} from '../onboarding-screen';

const ALL_SCREENS: OnboardingScreen[] = ['storage', 'download', 'manual', 'done', 'finishing'];
const ALL_EVENTS: OnboardingEvent[] = [
    'NEXT',
    'BACK',
    'OPEN_MANUAL',
    'CLOSE_MANUAL',
    'START_FINISH',
    'FINISH_OK',
    'FINISH_FAILED',
];

describe('引导流程屏幕状态机', () => {
    it('主路径：存储 → 下载 → 收尾 → 完成', () => {
        let screen: OnboardingScreen = 'storage';
        const step = (event: OnboardingEvent): void => {
            const next = transitionOnboardingScreen(screen, event);
            expect(next).not.toBeNull();
            screen = next as OnboardingScreen;
        };

        step('NEXT');
        expect(screen).toBe('download');
        step('START_FINISH');
        expect(screen).toBe('finishing');
        step('FINISH_OK');
        expect(screen).toBe('done');
    });

    it('手动下载是下载页的旁支，能原路返回', () => {
        expect(transitionOnboardingScreen('download', 'OPEN_MANUAL')).toBe('manual');
        expect(transitionOnboardingScreen('manual', 'CLOSE_MANUAL')).toBe('download');
    });

    it('收尾失败退回下载页，让用户重试或改走手动下载', () => {
        expect(transitionOnboardingScreen('finishing', 'FINISH_FAILED')).toBe('download');
    });

    it('已确认缺陷回归：收尾中拒绝一切导航，不能被返回或手动下载拽走', () => {
        // 修复前 finishing 是叠加在 download 上的布尔值，
        // 「返回」「手动下载」仍然可点，异步收尾随后把用户强行切到完成页。
        for (const event of ALL_EVENTS) {
            const next = transitionOnboardingScreen('finishing', event);
            if (event === 'FINISH_OK' || event === 'FINISH_FAILED') {
                expect(next).not.toBeNull();
            } else {
                expect(next).toBeNull();
            }
        }
    });

    it('完成页是终态，任何事件都不再改变屏幕', () => {
        for (const event of ALL_EVENTS) {
            expect(transitionOnboardingScreen('done', event)).toBeNull();
        }
    });

    it('不相关的导航事件被拒绝，不会误跳屏幕', () => {
        expect(transitionOnboardingScreen('storage', 'BACK')).toBeNull();
        expect(transitionOnboardingScreen('storage', 'OPEN_MANUAL')).toBeNull();
        expect(transitionOnboardingScreen('manual', 'BACK')).toBeNull();
        expect(transitionOnboardingScreen('download', 'FINISH_OK')).toBeNull();
    });

    it('每一条转移都落在已知屏幕内', () => {
        for (const screen of ALL_SCREENS) {
            for (const event of ALL_EVENTS) {
                const next = transitionOnboardingScreen(screen, event);
                if (next !== null) {
                    expect(ALL_SCREENS).toContain(next);
                }
            }
        }
    });

    it('收尾判定与下载页可离开判定互不干扰', () => {
        expect(isFinishing('finishing')).toBe(true);
        expect(isFinishing('download')).toBe(false);

        expect(canLeaveDownload('download', false)).toBe(true);
        // 下载中不能离开：否则下载与手动下载互相抢带宽
        expect(canLeaveDownload('download', true)).toBe(false);
        expect(canLeaveDownload('finishing', false)).toBe(false);
        expect(canLeaveDownload('manual', false)).toBe(false);
    });
});
