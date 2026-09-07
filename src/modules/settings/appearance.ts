import type { SettingsThemeFamily, SettingsThemeMode } from './contracts'
import type { ThemeBackgroundIntensity, ThemeBackgroundMotion, ThemeBackgroundVariation } from '@/types/settingsContracts'
import {
  isThemeAccentResetValue,
  normalizeThemeAccentValue,
  normalizeThemeFamilyValue,
  normalizeThemeModeValue,
} from '@/types/settingsContracts'

export function normalizeSettingsThemeMode(value: unknown): SettingsThemeMode | undefined {
  return normalizeThemeModeValue(value)
}

export function normalizeSettingsThemeFamily(value: unknown): SettingsThemeFamily | undefined {
  return normalizeThemeFamilyValue(value)
}

export function normalizeSettingsThemeAccent(value: unknown): string | undefined {
  return normalizeThemeAccentValue(value)
}

export function isSettingsThemeAccentReset(value: unknown): boolean {
  return isThemeAccentResetValue(value)
}

const BACKGROUND_VARIATIONS = ['fixed', 'random', 'startup', 'daily', 'preset'] as const
const BACKGROUND_MOTIONS = ['static', 'subtle', 'dynamic', 'immersive'] as const
const BACKGROUND_INTENSITIES = ['low', 'medium', 'high'] as const

export function normalizeSettingsBackgroundVariation(value: unknown): ThemeBackgroundVariation | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase() === 'rotate' ? 'random' : value.trim().toLowerCase()
  return (BACKGROUND_VARIATIONS as readonly string[]).includes(normalized)
    ? normalized as ThemeBackgroundVariation
    : undefined
}

export function normalizeSettingsBackgroundMotion(value: unknown): ThemeBackgroundMotion | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return (BACKGROUND_MOTIONS as readonly string[]).includes(normalized)
    ? normalized as ThemeBackgroundMotion
    : undefined
}

export function normalizeSettingsBackgroundIntensity(value: unknown): ThemeBackgroundIntensity | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return (BACKGROUND_INTENSITIES as readonly string[]).includes(normalized)
    ? normalized as ThemeBackgroundIntensity
    : undefined
}
