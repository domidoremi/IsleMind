import { getLocales } from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Language } from '@/types'

import en from './resources/en.json'
import ja from './resources/ja.json'
import zhCN from './resources/zh-CN.json'

export { i18n }

export function detectLanguage(): Language {
  const locales = getLocales()
  const lang = locales[0]?.languageCode
  if (lang === 'zh') return 'zh-CN'
  if (lang === 'ja') return 'ja'
  return 'en'
}

export function initI18n(language?: Language) {
  const detected = language ?? detectLanguage()

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