import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Language } from '@/types'

const LANGUAGE_SOURCE_KEY = '@islemind/language-source'

export type LanguagePreferenceSource = 'system' | 'user'

export function isLanguagePreferenceSource(value: unknown): value is LanguagePreferenceSource {
  return value === 'system' || value === 'user'
}

export async function loadLanguagePreferenceSource(): Promise<LanguagePreferenceSource> {
  try {
    const source = await AsyncStorage.getItem(LANGUAGE_SOURCE_KEY)
    return isLanguagePreferenceSource(source) ? source : 'system'
  } catch {
    return 'system'
  }
}

export async function saveLanguagePreferenceSource(source: LanguagePreferenceSource): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_SOURCE_KEY, source)
  } catch {
    // silently fail
  }
}

export async function clearLanguagePreferenceSource(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LANGUAGE_SOURCE_KEY)
  } catch {
    // silently fail
  }
}

export function resolveEffectiveLanguage(language: Language | undefined, source: LanguagePreferenceSource, systemLanguage: Language): Language {
  return source === 'user' && language ? language : systemLanguage
}
