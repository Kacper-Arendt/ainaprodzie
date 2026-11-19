import i18n from 'i18next'
import type { i18n as I18nInstance } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import chatEn from './en/chat.json'
import commonEn from './en/common.json'
import chatPl from './pl/chat.json'
import commonPl from './pl/common.json'

// English is the default locale and Polish its translation. Every namespace of
// every locale is registered here, at init, never by the feature that uses it
// (standards/frontend/spa-architecture.md).
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    defaultNS: 'common',
    // Browsers report region tags (`en-US`, `pl-PL`). These two options narrow
    // one to its language and publish the result on `resolvedLanguage`, so an
    // unsupported locale (`de-DE`) reaches English through `fallbackLng`.
    // `i18n.language` keeps the raw tag, which is why `activeLanguage()` exists.
    supportedLngs: ['en', 'pl'],
    load: 'languageOnly',
    // localStorage first: i18n boot is synchronous, so the login screen paints
    // in the chosen language with no flash.
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'retrofit.language',
      caches: ['localStorage'],
    },
    resources: {
      en: { common: commonEn, chat: chatEn },
      pl: { common: commonPl, chat: chatPl },
    },
    interpolation: { escapeValue: false },
  })

export const LANGUAGES = ['en', 'pl'] as const
export type AppLanguage = (typeof LANGUAGES)[number]

/**
 * The active language, and the only value any consumer reads: the selector, the
 * `<html lang>` attribute and the language sent to the server. `resolvedLanguage`
 * is undefined only before `init()` returns, so the fallback lives here, once.
 */
export function activeLanguage(instance: I18nInstance = i18n): AppLanguage {
  const resolved = instance.resolvedLanguage
  return LANGUAGES.includes(resolved as AppLanguage) ? (resolved as AppLanguage) : 'en'
}

/**
 * Assistive technology picks its voice and pronunciation rules from `<html lang>`,
 * so the attribute has to agree with the language the UI renders in. `index.html`
 * ships `lang="en"`; the call below corrects it on the first resolution and the
 * listener keeps it in step afterwards. `activeLanguage()`, never `i18n.language`,
 * so an `en-US` navigator still stamps `en`.
 */
function applyDocumentLanguage(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = activeLanguage()
}

applyDocumentLanguage()
i18n.on('languageChanged', applyDocumentLanguage)

export default i18n
