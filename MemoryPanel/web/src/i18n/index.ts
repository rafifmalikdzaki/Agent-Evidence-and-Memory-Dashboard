/**
 * i18n init module (English-first deployment).
 *
 * - First visit defaults to en-US unless a choice was persisted before
 * - A manual switch in the header persists to localStorage
 * - react-i18next's useTranslation re-renders components automatically
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zhCN } from './zh-CN';
import { enUS } from './en-US';

const STORAGE_KEY = 'tdai-memory.lang';

function detectInitialLanguage(): string {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === 'zh-CN' || stored === 'en-US') return stored;
  } catch {
    // Storage can be unavailable under browser privacy or sandbox policies.
  }
  // This deployment ships English-first: default to en-US unless the user
  // previously chose a language (persisted above). The header language
  // switcher still allows opting into Chinese.
  void (typeof navigator !== 'undefined' && navigator.language);
  return 'en-US';
}

export function changeLanguage(lang: string): void {
  void i18n.changeLanguage(lang);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // Persisting the preference is optional; the in-memory switch still stands.
  }
}

export function getCurrentLanguage(): string {
  return i18n.language || 'en-US';
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
