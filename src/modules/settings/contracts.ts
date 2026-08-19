import type { Result } from '@/core'

export const SETTINGS_ACTION_NAMES = [
  'get_settings',
  'set_theme_mode',
  'set_theme_family',
  'set_theme_accent',
  'set_language',
  'set_feature_flag',
] as const

export type SettingsActionName = typeof SETTINGS_ACTION_NAMES[number]

export const SETTINGS_THEME_MODES = ['light', 'dark', 'system'] as const

export type SettingsThemeMode = typeof SETTINGS_THEME_MODES[number]

export const SETTINGS_THEME_FAMILIES = ['minimal', 'monet', 'material', 'liquid-glass'] as const

export type SettingsThemeFamily = typeof SETTINGS_THEME_FAMILIES[number]

export const SETTINGS_LANGUAGES = ['zh-CN', 'en', 'ja'] as const

export type SettingsLanguage = typeof SETTINGS_LANGUAGES[number]

export const SETTINGS_FEATURE_FLAGS = [
  'memoryEnabled',
  'knowledgeEnabled',
  'webSearchEnabled',
  'skillsEnabled',
  'mcpEnabled',
  'commandPaletteEnabled',
  'hapticsEnabled',
] as const

export type SettingsFeatureFlag = typeof SETTINGS_FEATURE_FLAGS[number]

export interface AppSettingsSnapshot {
  theme: SettingsThemeMode
  themeId?: SettingsThemeFamily
  themeAccent?: string
  language: SettingsLanguage
  memoryEnabled?: boolean
  knowledgeEnabled?: boolean
  webSearchEnabled?: boolean
  skillsEnabled?: boolean
  mcpEnabled?: boolean
  commandPaletteEnabled?: boolean
  hapticsEnabled?: boolean
}

/**
 * Port for the small, user-visible settings action surface. Implementations
 * may persist preferences or synchronize a locale, but policy and argument
 * normalization remain in the settings module.
 */
export interface SettingsActionPort {
  getSnapshot(): AppSettingsSnapshot
  setTheme(theme: SettingsThemeMode): void | Promise<void>
  setThemeFamily(themeFamily: SettingsThemeFamily): void | Promise<void>
  setThemeAccent(themeAccent: string | undefined): void | Promise<void>
  setLanguage(language: SettingsLanguage): void | Promise<void>
  setFeatureFlag(flag: SettingsFeatureFlag, enabled: boolean): void | Promise<void>
}

export interface SettingsActionRequest {
  name: string
  arguments?: Readonly<Record<string, unknown>>
}

export interface SettingsActionOptions {
  signal?: AbortSignal
}

export type SettingsActionResult =
  | { action: 'get_settings'; snapshot: AppSettingsSnapshot }
  | { action: 'set_theme_mode'; theme: SettingsThemeMode }
  | { action: 'set_theme_family'; themeFamily: SettingsThemeFamily }
  | { action: 'set_theme_accent'; themeAccent: string | null }
  | { action: 'set_language'; language: SettingsLanguage }
  | { action: 'set_feature_flag'; flag: SettingsFeatureFlag; enabled: boolean }

export type SettingsActionErrorCode =
  | 'cancelled'
  | 'rejected'
  | 'invalid_theme_mode'
  | 'invalid_theme_family'
  | 'invalid_theme_accent'
  | 'invalid_language'
  | 'invalid_feature_flag'
  | 'invalid_feature_value'
  | 'operation_failed'

export interface SettingsActionUseCase {
  execute(
    input: SettingsActionRequest,
    options?: SettingsActionOptions,
  ): Promise<Result<SettingsActionResult, SettingsActionErrorCode>>
}

export interface SettingsActionUseCaseDependencies {
  settings: SettingsActionPort
}
