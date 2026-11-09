import { createRoot } from 'react-dom/client';
import React, { useEffect } from 'react';
import useSetting from '@/fronted/features/settings/settingsStore';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import HomePage from '@/fronted/features/file-browser/HomePage';
import TitleBarLayout from '@/fronted/components/layout/TitleBarLayout';
import YoutubeImportDialogHost from '@/fronted/features/youtube-import/YoutubeImportDialogHost';
import PlayerPage from '@/fronted/features/player/PlayerPage';
import AppShellLayout from '@/fronted/components/layout/AppShellLayout';
import SettingLayout from '@/fronted/features/settings/SettingLayout';
import ShortcutSetting from '@/fronted/features/settings/ShortcutSetting';
import StorageSetting from '@/fronted/features/settings/StorageSetting';
import AboutSetting from '@/fronted/features/settings/AboutSetting';
import AppearanceSetting from '@/fronted/features/settings/AppearanceSetting';
import ProxySetting from '@/fronted/features/settings/ProxySetting';
import MobileAccessSetting from '@/fronted/features/settings/MobileAccessSetting';
import YoutubeImportSetting from '@/fronted/features/settings/YoutubeImportSetting';
import ServiceResourceSetting from '@/fronted/features/settings/ServiceResourceSetting';
import toast, { Toaster as HotToaster, type Toast } from 'react-hot-toast';

import GlobalShortCut from '@/fronted/components/shared/shortcuts/GlobalShortCut';
import Eb from '@/fronted/components/shared/common/Eb';
import VideoLearningPage from '@/fronted/features/video-learning/VideoLearningPage';
import { OnboardingView } from '@/fronted/features/onboarding/OnboardingView';
import { getOnboardingCompletedVersion } from '@/fronted/features/onboarding/onboardingApi';
import { MigrationFailureGate } from '@/fronted/features/migration-failure/MigrationFailureGate';
import { getMigrationFailureDetail } from '@/fronted/features/migration-failure/migrationFailureApi';
import type { MigrationFailureDetail } from '@/common/contracts/migration-failure';
import { Button } from '@/fronted/components/ui/button';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { applyLanguageSetting } from '@/fronted/i18n';
import { Theme } from '@astryxdesign/core/theme';
import { themes, type ThemeSlug } from '../../astryx-themes';
import type { AppearanceThemeFamily } from '@/common/contracts/appearance-setting-vo';

/**
 * 持久化的主题家族值 → 本地主题 slug。
 *
 * 本地主题在官方主题基础上补了中文回退与浅色卡片层级，slug 带 `dp-` 前缀；
 * 但后端存储仍沿用 neutral/stone/gothic/matcha/y2k/butter/chocolate，避免改历史数据。
 * 用 `satisfies` 保证每套家族都有对应主题，新增家族时编译期就会报错。
 */
const THEME_SLUG_BY_FAMILY = {
    neutral: 'dp-neutral',
    stone: 'dp-stone',
    gothic: 'dp-gothic',
    matcha: 'dp-matcha',
    y2k: 'dp-y2k',
    butter: 'dp-butter',
    chocolate: 'dp-chocolate',
} as const satisfies Record<AppearanceThemeFamily, ThemeSlug>;

/**
 * 深色专用主题。
 *
 * Gothic 的 token 是绝对值而不是 light-dark 对，切到浅色模式会出现
 * 深色主题配浅色原生控件。选中这些主题时强制走 dark 模式。
 */
const DARK_ONLY_THEME_SLUGS: ReadonlySet<ThemeSlug> = new Set<ThemeSlug>(['dp-gothic']);

const UPDATE_CHECK_DELAY_MS = 6000;
const UPDATE_TOAST_ID = 'update-available';

/**
 * 启动门槛的判定结果，优先级从高到低：迁移失败 → 首次使用引导 → 主界面。
 *
 * null 表示尚未判定完成：此时只展示轻量加载态，避免主界面先闪一下再被引导页顶掉。
 */
type StartupGate =
    | { kind: 'migration-failure'; failure: MigrationFailureDetail }
    | { kind: 'onboarding' }
    | { kind: 'main' };

/**
 * 启动门槛判定期间的过渡态。
 *
 * 判定只等一轮 IPC 往返，但主界面挂载很重（首页会立即拉列表、改窗口尺寸），
 * 所以这里只给一个轻量加载指示：既不先渲染主界面再切走，也不留一片空白。
 */
const StartupLoading: React.FC = () => {
    const { t } = useI18nTranslation('common');
    return (
        <div
            role="status"
            aria-label={t('loading')}
            className="flex h-full w-full items-center justify-center gap-2 text-muted-foreground"
        >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">{t('loading')}</span>
        </div>
    );
};

/**
 * DashPlayer 桌面端根组件，负责启动门槛判定、主题语言同步及全局路由。
 */
export const App = () => {
    const { t } = useI18nTranslation('toast');
    const theme = useSetting((s) => s.values.get('appearance.theme'));
    const themeFamily = useSetting((s) => s.values.get('appearance.themeFamily')) || 'neutral';
    // 主题家族由后端枚举校验过；这里显式收窄，非法值在渲染前直接失败
    const themeSlug = THEME_SLUG_BY_FAMILY[themeFamily as AppearanceThemeFamily];
    // 深色专用主题（如 Gothic）无视保存的浅色/跟随系统设置，强制 dark
    const isDarkOnlyTheme = themeSlug !== undefined && DARK_ONLY_THEME_SLUGS.has(themeSlug);
    const languageSetting = useSetting((s) => s.values.get('i18n.language'));
    /** 当前生效的启动门槛；null 表示两个门槛都还没读出结果。 */
    const [gate, setGate] = React.useState<StartupGate | null>(null);

    // 两个门槛并行读取、统一裁决，避免各自为政时互相覆盖；
    // 单次读取失败按「该门槛不拦截」处理，否则一次 IPC 异常就会把用户永久锁在启动页。
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [failure, completedVersion] = await Promise.all([
                getMigrationFailureDetail().catch(() => null),
                getOnboardingCompletedVersion().catch(() => null),
            ]);
            if (cancelled) {
                return;
            }
            if (failure?.failed) {
                setGate({ kind: 'migration-failure', failure });
                return;
            }
            setGate(completedVersion ? { kind: 'main' } : { kind: 'onboarding' });
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // 同步外观主题到 html 根节点：支持 light、dark 及跟随系统（system）
    useEffect(() => {
        const rawTheme = isDarkOnlyTheme ? 'dark' : theme || 'light';
        const resolveEffectiveTheme = (): 'dark' | 'light' => {
            if (rawTheme === 'dark') return 'dark';
            if (rawTheme === 'light') return 'light';
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        };

        const applyTheme = () => {
            const effective = resolveEffectiveTheme();
            document.documentElement.classList.remove('dark', 'light');
            document.documentElement.classList.add(effective);
        };

        applyTheme();

        if (rawTheme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const listener = () => applyTheme();
            mediaQuery.addEventListener('change', listener);
            return () => {
                mediaQuery.removeEventListener('change', listener);
            };
        }
    }, [theme, isDarkOnlyTheme]);

    useEffect(() => {
        applyLanguageSetting(languageSetting).catch(() => undefined);
    }, [languageSetting]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            (async () => {
                const result = await backendClient.call('system/check-update', { mode: 'toast' });
                if (result.status !== 'ok' || result.releases.length === 0 || !result.shouldNotify) {
                    return;
                }
                const latest = result.releases[0];
                const versionTitle = t('updateAvailableTitle', { version: latest.version });
                toast(
                    (tState: Toast) => (
                        <div className="flex items-center gap-3 text-sm">
                            <span className="font-semibold text-xs">{versionTitle}</span>
                            <Button
                                size="sm"
                                className="h-7 px-3 text-xs shrink-0"
                                onClick={() => {
                                    toast.dismiss(tState.id);
                                    void backendClient.call('system/open-url', latest.url);
                                }}
                            >
                                {t('updateAvailableAction')}
                            </Button>
                        </div>
                    ),
                    {
                        id: UPDATE_TOAST_ID,
                        duration: 8000,
                    },
                );
            })().catch(() => {
                // 启动自动检查更新失败时静默跳过
            });
        }, UPDATE_CHECK_DELAY_MS);

        return () => window.clearTimeout(timer);
    }, [t]);

    const effectiveThemeMode: 'light' | 'dark' | 'system' = isDarkOnlyTheme
        ? 'dark'
        : theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';
    if (!themeSlug) {
        throw new Error(`未知的主题家族：${themeFamily}`);
    }
    const activeTheme = themes[themeSlug];

    return (
        <Theme theme={activeTheme} mode={effectiveThemeMode}>
            <div className="w-full h-screen text-foreground overflow-hidden select-none font-sans">
                {gate?.kind === 'migration-failure' && (
                    <MigrationFailureGate failure={gate.failure} />
                )}
                {gate?.kind === 'onboarding' && (
                    <OnboardingView onCompleted={() => setGate({ kind: 'main' })} />
                )}
                {gate?.kind === 'main' && (
                    <HashRouter>
                        <Routes>
                            <Route path="/" element={<HomePage />} />
                            <Route path="home" element={<HomePage />} />
                            <Route element={<TitleBarLayout />}>
                                <Route
                                    path="player/:videoId"
                                    element={<PlayerPage />}
                                />
                                <Route
                                    path="player"
                                    element={<PlayerPage />}
                                />
                                <Route path="*" element={<AppShellLayout />}>
                                    <Route
                                        path="vocabulary"
                                        element={<Eb key="vocabulary"><VideoLearningPage /></Eb>}
                                    />
                                    <Route path="about" element={<Navigate to="/settings/about" replace />} />
                                    <Route
                                        path="settings"
                                        element={<SettingLayout />}
                                    >
                                        <Route
                                            path="*"
                                            element={<Eb><ShortcutSetting /></Eb>}
                                        />
                                        <Route
                                            path="shortcut"
                                            element={<Eb><ShortcutSetting /></Eb>}
                                        />
                                        <Route
                                            path="resources"
                                            element={<Eb><ServiceResourceSetting /></Eb>}
                                        />
                                        <Route
                                            path="storage"
                                            element={<Eb><StorageSetting /></Eb>}
                                        />
                                        <Route
                                            path="update"
                                            element={<Navigate to="/settings/about" replace />}
                                        />
                                        <Route
                                            path="about"
                                            element={<Eb><AboutSetting /></Eb>}
                                        />
                                        <Route
                                            path="appearance"
                                            element={<Eb><AppearanceSetting /></Eb>}
                                        />
                                        <Route
                                            path="proxy"
                                            element={<Eb><ProxySetting /></Eb>}
                                        />
                                        <Route
                                            path="mobile"
                                            element={<Eb><MobileAccessSetting /></Eb>}
                                        />
                                        <Route
                                            path="import"
                                            element={<Eb key="import"><YoutubeImportSetting /></Eb>}
                                        />
                                    </Route>
                                </Route>
                            </Route>
                        </Routes>
                        <YoutubeImportDialogHost />
                    </HashRouter>
                )}
                {gate === null && <StartupLoading />}
            </div>
            <HotToaster
                position="top-center"
                toastOptions={{
                    // 只用 token 类：react-hot-toast 会挂到 body 下，内联旧 shadcn HSL 变量会绕过 Astryx 主题
                    className: 'border border-border/80 bg-background/95 text-foreground shadow-lg backdrop-blur-md text-xs font-medium rounded-xl',
                }}
            />
            <GlobalShortCut />
        </Theme>
    );
};

/**
 * 将 React 应用挂载到 renderer 页面根节点。
 *
 * @throws 页面缺少 root 节点时抛出错误，避免应用在不完整的 HTML 中静默启动。
 */
export function mountApp(): void {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
        throw new Error('Root element not found');
    }
    const root = createRoot(rootElement);
    root.render(<App />);
}
