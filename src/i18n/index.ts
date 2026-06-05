import { getLocales } from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Language } from '@/types'

import en from './resources/en.json'
import ja from './resources/ja.json'
import zhCN from './resources/zh-CN.json'
import { setServiceLanguage, setSystemLanguage } from './service'

export { i18n }

export function detectLanguage(): Language {
  const locales = getLocales()
  const lang = locales[0]?.languageCode
  if (lang === 'zh') return 'zh-CN'
  if (lang === 'ja') return 'ja'
  return 'en'
}

export function initI18n(language?: Language) {
  const systemLanguage = detectLanguage()
  const detected = language ?? systemLanguage
  setSystemLanguage(systemLanguage)
  setServiceLanguage(detected)

  if (i18n.isInitialized) {
    if (i18n.language !== detected) {
      void i18n.changeLanguage(detected)
    }
    return i18n
  }

  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      ja: { translation: ja },
    },
    lng: detected,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    compatibilityJSON: 'v4',
  })

  return i18n
}

export function changeAppLanguage(language: Language) {
  setServiceLanguage(language)
  return i18n.changeLanguage(language)
}
