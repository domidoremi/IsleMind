import { err, ok, type Result } from '@/core'
import type {
  SettingsActionErrorCode,
  SettingsActionName,
  SettingsActionResult,
  SettingsActionUseCase,
  SettingsActionUseCaseDependencies,
  SettingsFeatureFlag,
  SettingsLanguage,
  SettingsThemeFamily,
} from '../contracts'
import {
  isSettingsThemeAccentReset,
  normalizeSettingsThemeAccent,
  normalizeSettingsThemeFamily,
  normalizeSettingsThemeMode,
} from '../appearance'

const featureFlagAliases: Record<string, SettingsFeatureFlag> = {
  memory: 'memoryEnabled',
  long_memory: 'memoryEnabled',
  knowledge: 'knowledgeEnabled',
  local_knowledge: 'knowledgeEnabled',
  web_search: 'webSearchEnabled',
  search: 'webSearchEnabled',
  skills: 'skillsEnabled',
  mcp: 'mcpEnabled',
  command_palette: 'commandPaletteEnabled',
  haptics: 'hapticsEnabled',
}

/**
 * Application use case for app-local preference changes. It deliberately
 * returns stable outcome codes and values; presentation owns translated copy
 * and trace formatting.
 */
export function createSettingsActionUseCase(
  dependencies: SettingsActionUseCaseDependencies,
): SettingsActionUseCase {
  return {
    async execute(input, options = {}) {
      if (options.signal?.aborted) {
        return err('cancelled', 'settings_action_cancelled', { retryable: true })
      }

      const name = normalizeActionName(input?.name)
      if (!name) {
        return err('rejected', 'settings_action_rejected', { retryable: false })
      }
      const args = input.arguments ?? {}

      if (name === 'get_settings') {
        return ok({ action: name, snapshot: dependencies.settings.getSnapshot() })
      }

      if (name === 'set_theme_mode') {
        const theme = normalizeSettingsThemeMode(args.mode ?? args.theme)
        if (!theme) return err('invalid_theme_mode', 'settings_action_invalid_theme_mode', { retryable: false })
        return runMutation(() => dependencies.settings.setTheme(theme), { action: name, theme })
      }

      if (name === 'set_theme_family') {
        const themeFamily = normalizeThemeFamily(args.themeId ?? args.family ?? args.theme)
        if (!themeFamily) return err('invalid_theme_family', 'settings_action_invalid_theme_family', { retryable: false })
        return runMutation(() => dependencies.settings.setThemeFamily(themeFamily), { action: name, themeFamily })
      }

      if (name === 'set_theme_accent') {
        const rawAccent = args.color ?? args.accent ?? args.value
        const themeAccent = normalizeSettingsThemeAccent(rawAccent)
        if (!themeAccent && !isSettingsThemeAccentReset(rawAccent)) {
          return err('invalid_theme_accent', 'settings_action_invalid_theme_accent', { retryable: false })
        }
        return runMutation(
          () => dependencies.settings.setThemeAccent(themeAccent),
          { action: name, themeAccent: themeAccent ?? null },
        )
      }

      if (name === 'set_language') {
        const language = normalizeLanguage(args.language ?? args.locale)
        if (!language) return err('invalid_language', 'settings_action_invalid_language', { retryable: false })
        return runMutation(() => dependencies.settings.setLanguage(language), { action: name, language })
      }

      const flag = normalizeFeatureFlag(args.flag ?? args.name ?? args.key)
      const enabled = normalizeBoolean(args.enabled ?? args.value ?? args.on)
      if (!flag) return err('invalid_feature_flag', 'settings_action_invalid_feature_flag', { retryable: false })
      if (enabled === undefined) return err('invalid_feature_value', 'settings_action_invalid_feature_value', { retryable: false })
      return runMutation(() => dependencies.settings.setFeatureFlag(flag, enabled), { action: name, flag, enabled })
    },
  }
}

async function runMutation(
  mutation: () => void | Promise<void>,
  result: Exclude<SettingsActionResult, { action: 'get_settings' }>,
): Promise<Result<SettingsActionResult, SettingsActionErrorCode>> {
  try {
    await mutation()
    return ok(result)
  } catch {
    return err<SettingsActionErrorCode>('operation_failed', 'settings_action_operation_failed', { retryable: true })
  }
}

export function isSettingsActionName(value: unknown): value is SettingsActionName {
  return value === 'get_settings' ||
    value === 'set_theme_mode' ||
    value === 'set_theme_family' ||
    value === 'set_theme_accent' ||
    value === 'set_language' ||
    value === 'set_feature_flag'
}

function normalizeActionName(value: unknown): SettingsActionName | undefined {
  return isSettingsActionName(value) ? value : undefined
}

function normalizeThemeFamily(value: unknown): SettingsThemeFamily | undefined {
  return normalizeSettingsThemeFamily(value)
}

function normalizeLanguage(value: unknown): SettingsLanguage | undefined {
  return value === 'zh-CN' || value === 'en' || value === 'ja' ? value : undefined
}

function normalizeFeatureFlag(value: unknown): SettingsFeatureFlag | undefined {
  if (typeof value !== 'string') return undefined
  return featureFlagAliases[value.trim().toLowerCase().replace(/[\s-]+/g, '_')]
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', 'on', 'yes', 'enable', 'enabled', '1'].includes(normalized)) return true
  if (['false', 'off', 'no', 'disable', 'disabled', '0'].includes(normalized)) return false
  return undefined
}
