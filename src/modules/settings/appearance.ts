import type { SettingsThemeFamily, SettingsThemeMode } from './contracts'

const THEME_ACCENT_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const THEME_ACCENT_RESET_VALUES = new Set(['', 'auto', 'default', 'none', 'reset'])

export function normalizeSettingsThemeMode(value: unknown): SettingsThemeMode | undefined {
  return value === 'light' || value === 'dark' || value === 'system' ? value : undefined
}

export function normalizeSettingsThemeFamily(value: unknown): SettingsThemeFamily | undefined {
  if (value === 'lime-road' || value === 'cartoon' || value === 'island') return 'monet'
  if (value === 'markdown' || value === 'material-3' || value === 'material3') return 'material'
  if (value === 'glass' || value === 'liquid') return 'liquid-glass'
  return value === 'minimal' || value === 'monet' || value === 'material' || value === 'liquid-glass' ? value : undefined
}

export function normalizeSettingsThemeAccent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  const match = normalized.match(THEME_ACCENT_PATTERN)
  if (!match) return undefined
  const hex = match[1]
  const expanded = hex.length === 3
    ? hex.split('').map((part) => `${part}${part}`).join('')
    : hex
  return `#${expanded.toUpperCase()}`
}

export function isSettingsThemeAccentReset(value: unknown): boolean {
  return typeof value === 'string' && THEME_ACCENT_RESET_VALUES.has(value.trim().toLowerCase())
}
