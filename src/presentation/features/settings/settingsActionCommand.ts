import {
  createSettingsActionUseCase,
  isSettingsActionName,
  type AppSettingsSnapshot,
  type SettingsActionErrorCode,
  type SettingsActionName,
  type SettingsActionResult,
  type SettingsFeatureFlag,
} from '@/modules/settings'
import { st, setServiceLanguage } from '@/i18n/service'
import { useSettingsStore } from '@/store/settingsStore'
import type { Language, Settings, ThemeId, ThemeMode } from '@/types/settingsContracts'
import type { ProcessTrace, ToolContentBlock } from '@/core'

export type SettingsActionSource = 'local-intent' | 'builtin-tool'
export type SettingsActionPolicyDecision = 'execute' | 'confirm' | 'reject'

export interface SettingsActionCommandRequest {
  name: SettingsActionName
  arguments?: Record<string, unknown>
  source: SettingsActionSource
}

export interface SettingsActionCommandOptions {
  signal?: AbortSignal
}

export interface SettingsActionCommandResult {
  ok: boolean
  message: string
  content: ToolContentBlock[]
  trace: ProcessTrace
  error?: string
}

const settingsActionUseCase = createSettingsActionUseCase({
  settings: {
    getSnapshot: getSettingsSnapshot,
    setTheme(theme) {
      useSettingsStore.getState().setTheme(theme as ThemeMode)
    },
    setThemeFamily(themeFamily) {
      useSettingsStore.getState().setThemeId(themeFamily as ThemeId)
    },
    setThemeAccent(themeAccent) {
      useSettingsStore.getState().setThemeAccent(themeAccent)
    },
    async setLanguage(language) {
      useSettingsStore.getState().setLanguage(language as Language)
      setServiceLanguage(language)
      try {
        const i18nModule = await import('@/i18n')
        await i18nModule.changeAppLanguage(language)
      } catch {
        // Persisted settings and service language remain usable in non-UI runtimes.
      }
    },
    setFeatureFlag(flag, enabled) {
      useSettingsStore.getState().updateSettings({ [flag]: enabled } as Partial<Settings>)
    },
  },
})

export function decideSettingsActionPolicy(request: SettingsActionCommandRequest): SettingsActionPolicyDecision {
  return isSettingsActionName(request.name) ? 'execute' : 'reject'
}

export async function executeSettingsAction(
  request: SettingsActionCommandRequest,
  options: SettingsActionCommandOptions = {},
): Promise<SettingsActionCommandResult> {
  const startedAt = Date.now()
  const result = await settingsActionUseCase.execute(request, options)
  if (!result.ok) return settingsActionFailureForError(request.name, result.error.code, startedAt)
  const presentation = presentSettingsActionResult(result.value)
  return settingsActionSuccess(request.name, presentation.message, startedAt, presentation.metadata, presentation.content)
}

function getSettingsSnapshot(): AppSettingsSnapshot {
  const settings = useSettingsStore.getState().settings
  return {
    theme: settings.theme,
    themeId: settings.themeId,
    themeAccent: settings.themeAccent,
    language: settings.language,
    memoryEnabled: settings.memoryEnabled,
    knowledgeEnabled: settings.knowledgeEnabled,
    webSearchEnabled: settings.webSearchEnabled,
    skillsEnabled: settings.skillsEnabled,
    mcpEnabled: settings.mcpEnabled,
    commandPaletteEnabled: settings.commandPaletteEnabled,
    hapticsEnabled: settings.hapticsEnabled,
  }
}

function presentSettingsActionResult(result: SettingsActionResult): {
  message: string
  metadata?: Record<string, unknown>
  content?: ToolContentBlock[]
} {
  if (result.action === 'get_settings') {
    const text = formatSettingsSnapshot(result.snapshot)
    return {
      message: text,
      metadata: { action: result.action, snapshot: result.snapshot },
      content: [{ type: 'text', text }],
    }
  }
  if (result.action === 'set_theme_mode') {
    return {
      message: st('appAction.themeModeChanged', { value: result.theme }, 'Theme mode set to ' + result.theme + '.'),
      metadata: { action: result.action, theme: result.theme },
    }
  }
  if (result.action === 'set_theme_family') {
    return {
      message: st('appAction.themeFamilyChanged', { value: result.themeFamily }, 'Theme family set to ' + result.themeFamily + '.'),
      metadata: { action: result.action, themeId: result.themeFamily },
    }
  }
  if (result.action === 'set_theme_accent') {
    const message = result.themeAccent
      ? st('appAction.themeAccentChanged', { value: result.themeAccent }, 'Accent color set to ' + result.themeAccent + '.')
      : st('appAction.themeAccentReset', undefined, 'Accent color restored to the theme default.')
    return {
      message,
      metadata: { action: result.action, themeAccent: result.themeAccent },
    }
  }
  if (result.action === 'set_language') {
    return {
      message: st('appAction.languageChanged', { value: result.language }, 'Language set to ' + result.language + '.'),
      metadata: { action: result.action, language: result.language },
    }
  }
  const label = featureFlagLabel(result.flag)
  return {
    message: st('appAction.featureFlagChanged', { feature: label, value: result.enabled ? 'on' : 'off' }, label + ' ' + (result.enabled ? 'enabled' : 'disabled') + '.'),
    metadata: { action: result.action, flag: result.flag, enabled: result.enabled },
  }
}

function settingsActionFailureForError(
  action: string,
  code: SettingsActionErrorCode,
  startedAt: number,
): SettingsActionCommandResult {
  if (code === 'cancelled') {
    return settingsActionFailure(action, st('appAction.cancelled', undefined, 'App action was cancelled.'), startedAt, 'skipped', {
      errorCode: 'cancelled',
      status: 'cancelled',
      failureCode: 'cancelled',
    })
  }
  if (code === 'rejected') {
    return settingsActionFailure(action, st('appAction.rejected', undefined, 'Action rejected by policy.'), startedAt, 'skipped')
  }
  const messages: Record<Exclude<SettingsActionErrorCode, 'cancelled' | 'rejected'>, string> = {
    invalid_theme_mode: st('appAction.invalidThemeMode', undefined, 'Invalid theme mode.'),
    invalid_theme_family: st('appAction.invalidThemeFamily', undefined, 'Invalid theme family.'),
    invalid_theme_accent: st('appAction.invalidThemeAccent', undefined, 'Use a valid hexadecimal accent color.'),
    invalid_language: st('appAction.invalidLanguage', undefined, 'Invalid language.'),
    invalid_feature_flag: st('appAction.invalidFeatureFlag', undefined, 'Invalid feature flag.'),
    invalid_feature_value: st('appAction.invalidFeatureValue', undefined, 'Invalid feature flag value.'),
    operation_failed: st('appAction.failed', undefined, 'Action failed.'),
  }
  return settingsActionFailure(action, messages[code], startedAt)
}

function featureFlagLabel(flag: SettingsFeatureFlag): string {
  const labels: Record<SettingsFeatureFlag, string> = {
    memoryEnabled: 'memory',
    knowledgeEnabled: 'knowledge',
    webSearchEnabled: 'web search',
    skillsEnabled: 'skills',
    mcpEnabled: 'MCP',
    commandPaletteEnabled: 'command palette',
    hapticsEnabled: 'haptics',
  }
  return labels[flag]
}

function formatSettingsSnapshot(snapshot: AppSettingsSnapshot): string {
  const rows = [
    st('appAction.settingsSummaryTheme', { theme: snapshot.theme, family: snapshot.themeId }, 'Theme: ' + snapshot.theme + '/' + snapshot.themeId),
    st('appAction.settingsSummaryLanguage', { language: snapshot.language }, 'Language: ' + snapshot.language),
    formatCapabilityLine('memory', snapshot.memoryEnabled),
    formatCapabilityLine('knowledge', snapshot.knowledgeEnabled),
    formatCapabilityLine('webSearch', snapshot.webSearchEnabled),
    formatCapabilityLine('skills', snapshot.skillsEnabled),
    formatCapabilityLine('mcp', snapshot.mcpEnabled),
    formatCapabilityLine('commandPalette', snapshot.commandPaletteEnabled),
    formatCapabilityLine('haptics', snapshot.hapticsEnabled),
  ]
  return [
    st('appAction.settingsSummaryTitle', undefined, 'System capabilities'),
    ...rows,
    st('appAction.settingsSummaryHint', undefined, 'You can ask me to enable or disable these capabilities directly.'),
  ].join('\n')
}

function formatCapabilityLine(feature: string, enabled?: boolean): string {
  const label = st('appAction.featureLabel.' + feature, undefined, feature)
  const state = enabled === false
    ? st('appAction.disabled', undefined, 'Off')
    : st('appAction.enabled', undefined, 'On')
  return st('appAction.settingsSummaryLine', { feature: label, state }, label + ': ' + state)
}

function settingsActionSuccess(
  action: string,
  message: string,
  startedAt: number,
  metadata?: Record<string, unknown>,
  content?: ToolContentBlock[],
): SettingsActionCommandResult {
  const completedAt = Date.now()
  const blocks = content ?? [{ type: 'text' as const, text: message }]
  return {
    ok: true,
    message,
    content: blocks,
    trace: {
      id: 'app-action-' + action + '-' + startedAt,
      type: 'tool',
      title: 'IsleMind ' + action,
      content: blocks.map((block) => block.text ?? block.uri ?? block.type).join('\n').slice(0, 1200),
      status: 'done',
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      metadata,
    },
  }
}

function settingsActionFailure(
  action: string,
  message: string,
  startedAt: number,
  status: ProcessTrace['status'] = 'error',
  metadata: Record<string, unknown> = {},
): SettingsActionCommandResult {
  const completedAt = Date.now()
  return {
    ok: false,
    message,
    content: [{ type: 'text', text: message }],
    error: message,
    trace: {
      id: 'app-action-failed-' + action + '-' + startedAt,
      type: 'tool',
      title: 'IsleMind ' + action,
      content: message,
      status,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      metadata: { action, ...metadata },
    },
  }
}
