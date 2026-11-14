import i18n, { changeLanguage, use as i18nextUse } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import zhNav from '@/frontend/i18n/locales/zh-CN/nav.json';
import enNav from '@/frontend/i18n/locales/en-US/nav.json';
import zhSettings from '@/frontend/i18n/locales/zh-CN/settings.json';
import enSettings from '@/frontend/i18n/locales/en-US/settings.json';
import zhToast from '@/frontend/i18n/locales/zh-CN/toast.json';
import enToast from '@/frontend/i18n/locales/en-US/toast.json';
import zhErrors from '@/frontend/i18n/locales/zh-CN/errors.json';
import enErrors from '@/frontend/i18n/locales/en-US/errors.json';
import zhPlayer from '@/frontend/i18n/locales/zh-CN/player.json';
import enPlayer from '@/frontend/i18n/locales/en-US/player.json';
import zhPages from '@/frontend/i18n/locales/zh-CN/pages.json';
import enPages from '@/frontend/i18n/locales/en-US/pages.json';
import zhCommon from '@/frontend/i18n/locales/zh-CN/common.json';
import enCommon from '@/frontend/i18n/locales/en-US/common.json';
import zhOnboarding from '@/frontend/i18n/locales/zh-CN/onboarding.json';
import enOnboarding from '@/frontend/i18n/locales/en-US/onboarding.json';
import zhMigration from '@/frontend/i18n/locales/zh-CN/migration.json';
import enMigration from '@/frontend/i18n/locales/en-US/migration.json';
import zhYoutubeImport from '@/frontend/i18n/locales/zh-CN/youtube-import.json';
import enYoutubeImport from '@/frontend/i18n/locales/en-US/youtube-import.json';
import zhPractice from '@/frontend/i18n/locales/zh-CN/practice.json';
import enPractice from '@/frontend/i18n/locales/en-US/practice.json';
import zhRecap from '@/frontend/i18n/locales/zh-CN/recap.json';
import enRecap from '@/frontend/i18n/locales/en-US/recap.json';
import zhCompass from '@/frontend/i18n/locales/zh-CN/compass.json';
import enCompass from '@/frontend/i18n/locales/en-US/compass.json';
import zhMoment from '@/frontend/i18n/locales/zh-CN/moment.json';
import enMoment from '@/frontend/i18n/locales/en-US/moment.json';
import zhMemoryMap from '@/frontend/i18n/locales/zh-CN/memoryMap.json';
import enMemoryMap from '@/frontend/i18n/locales/en-US/memoryMap.json';
import zhMetrics from '@/frontend/i18n/locales/zh-CN/metrics.json';
import enMetrics from '@/frontend/i18n/locales/en-US/metrics.json';

export type AppLocale = 'zh-CN' | 'en-US';
export type AppLanguageSetting = 'system' | AppLocale;

export const I18N_FALLBACK_LOCALE: AppLocale = 'en-US';

export const resources = {
    'zh-CN': {
        nav: zhNav,
        settings: zhSettings,
        toast: zhToast,
        errors: zhErrors,
        player: zhPlayer,
        pages: zhPages,
        common: zhCommon,
        onboarding: zhOnboarding,
        migration: zhMigration,
        youtubeImport: zhYoutubeImport,
        practice: zhPractice,
        recap: zhRecap,
        compass: zhCompass,
        moment: zhMoment,
        memoryMap: zhMemoryMap,
        metrics: zhMetrics,
    },
    'en-US': {
        nav: enNav,
        settings: enSettings,
        toast: enToast,
        errors: enErrors,
        player: enPlayer,
        pages: enPages,
        common: enCommon,
        onboarding: enOnboarding,
        migration: enMigration,
        youtubeImport: enYoutubeImport,
        practice: enPractice,
        recap: enRecap,
        compass: enCompass,
        moment: enMoment,
        memoryMap: enMemoryMap,
        metrics: enMetrics,
    },
};

export const resolveLocaleFromSystem = (language: string | undefined | null): AppLocale => {
    if ((language ?? '').toLowerCase().startsWith('zh')) {
        return 'zh-CN';
    }
    return 'en-US';
};

export const resolveLocaleFromSetting = (
    setting: string | undefined | null,
    systemLanguage: string | undefined | null = typeof navigator === 'undefined' ? 'en-US' : navigator.language,
): AppLocale => {
    if (setting === 'zh-CN' || setting === 'en-US') {
        return setting;
    }
    if (setting === 'system') {
        return resolveLocaleFromSystem(systemLanguage);
    }
    return I18N_FALLBACK_LOCALE;
};

export const applyLanguageSetting = async (setting: string | undefined | null): Promise<AppLocale> => {
    const locale = resolveLocaleFromSetting(setting);
    if (i18n.resolvedLanguage !== locale) {
        await changeLanguage(locale);
    }
    return locale;
};

void i18nextUse(initReactI18next)
    .init({
        resources,
        lng: I18N_FALLBACK_LOCALE,
        fallbackLng: I18N_FALLBACK_LOCALE,
        interpolation: {
            escapeValue: false,
        },
        ns: ['nav', 'settings', 'toast', 'errors', 'player', 'pages', 'common', 'onboarding', 'migration', 'youtubeImport', 'practice', 'recap', 'compass', 'moment', 'memoryMap', 'metrics'],
        defaultNS: 'settings',
        returnNull: false,
        debug: import.meta.env.DEV,
        parseMissingKeyHandler: (key) => {
            if (import.meta.env.DEV) {
                getRendererLogger('i18n').warn(`[i18n] missing key: ${key}`);
            }
            return key;
        },
    });

export default i18n;
