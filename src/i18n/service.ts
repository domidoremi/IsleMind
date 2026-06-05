import type { Language } from '@/types'
import en from './resources/en.json'
import ja from './resources/ja.json'
import zhCN from './resources/zh-CN.json'

type TranslationValues = Record<string, string | number | boolean | null | undefined>
type TranslationTree = Record<string, unknown>

const resources: Record<Language, TranslationTree> = {
  en,
  ja,
  'zh-CN': zhCN,
}

let serviceLanguage: Language = 'zh-CN'
let systemLanguage: Language = 'zh-CN'

export function setServiceLanguage(language: Language): void {
  serviceLanguage = language
}

export function setSystemLanguage(language: Language): void {
  systemLanguage = language
}

export function getSystemLanguage(): Language {
  return systemLanguage
}

export function st(key: string, values?: TranslationValues, fallback?: string): string {
  const defaultValue = fallback ?? key
  const translated = getByPath(resources[serviceLanguage], key) ?? getByPath(resources.en, key)
  return interpolate(typeof translated === 'string' ? translated : defaultValue, values)
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => {
    const value = values[name]
    return value === undefined || value === null ? '' : String(value)
  })
}

function getByPath(source: TranslationTree, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as TranslationTree)[part]
  }, source)
}
