import type { Language, ProcessTrace, Settings, ThemeId, ThemeMode, ToolContentBlock } from '@/types'
import { useSettingsStore } from '@/store/settingsStore'
import { st, setServiceLanguage } from '@/i18n/service'

export type AppActionName =
  | 'get_settings'
  | 'set_theme_mode'
  | 'set_theme_family'
  | 'set_language'
  | 'set_feature_flag'

export type AppActionSource = 'local-intent' | 'builtin-tool'
export type AppActionPolicyDecision = 'execute' | 'confirm' | 'reject'

export interface AppActionRequest {
  name: AppActionName
  arguments?: Record<string, unknown>
  source: AppActionSource
}

export interface AppActionOptions {
  signal?: AbortSignal
}

export interface AppActionResult {
  ok: boolean
  message: string
  content: ToolContentBlock[]
  trace: ProcessTrace
  error?: string
}

type FeatureFlagKey =
  | 'memoryEnabled'
  | 'knowledgeEnabled'
  | 'webSearchEnabled'
  | 'skillsEnabled'
  | 'mcpEnabled'
  | 'commandPaletteEnabled'
  | 'hapticsEnabled'

const DIRECT_ACTIONS = new Set<AppActionName>([
  'get_settings',
  'set_theme_mode',
  'set_theme_family',
  'set_language',
  'set_feature_flag',
])

const FEATURE_FLAGS: Record<string, { key: FeatureFlagKey; label: string }> = {
  memory: { key: 'memoryEnabled', label: 'memory' },
  long_memory: { key: 'memoryEnabled', label: 'memory' },
  knowledge: { key: 'knowledgeEnabled', label: 'knowledge' },
  local_knowledge: { key: 'knowledgeEnabled', label: 'knowledge' },
  web_search: { key: 'webSearchEnabled', label: 'web search' },
  search: { key: 'webSearchEnabled', label: 'web search' },
  skills: { key: 'skillsEnabled', label: 'skills' },
  mcp: { key: 'mcpEnabled', label: 'MCP' },
  command_palette: { key: 'commandPaletteEnabled', label: 'command palette' },
  haptics: { key: 'hapticsEnabled', label: 'haptics' },
}

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system']
const THEME_IDS: ThemeId[] = ['minimal', 'glass', 'cartoon']
const LANGUAGES: Language[] = ['zh-CN', 'en', 'ja']

export function decideAppActionPolicy(request: AppActionRequest): AppActionPolicyDecision {
  return DIRECT_ACTIONS.has(request.name) ? 'execute' : 'reject'
}

export async function executeAppAction(request: AppActionRequest, options: AppActionOptions = {}): Promise<AppActionResult> {
  const startedAt = Date.now()
  if (options.signal?.aborted) {
    return appActionFailure(request.name, st('appAction.cancelled', undefined, 'App action was cancelled.'), startedAt, 'skipped', {
      errorCode: 'cancelled',
      status: 'cancelled',
      failureCode: 'cancelled',
    })
  }

  const decision = decideAppActionPolicy(request)
  if (decision !== 'execute') {
    return appActionFailure(request.name, st('appAction.rejected', undefined, 'Action rejected by policy.'), startedAt, 'skipped')
  }

  try {
    const result = await runAppAction(request)
    return appActionSuccess(request.name, result.message, startedAt, result.metadata, result.content)
  } catch (error) {
    const message = error instanceof Error ? error.message : st('appAction.failed', undefined, 'Action failed.')
    return appActionFailure(request.name, message, startedAt)
  }
}

function getSettingsSnapshot(): Pick<Settings, 'theme' | 'themeId' | 'language' | FeatureFlagKey> {
  const settings = useSettingsStore.getState().settings
  return {
    theme: settings.theme,
    themeId: settings.themeId,
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

async function runAppAction(request: AppActionRequest): Promise<{ message: string; metadata?: Record<string, unknown>; content?: ToolContentBlock[] }> {
  const args = request.arguments ?? {}
  if (request.name === 'get_settings') {
    const snapshot = getSettingsSnapshot()
    const text = formatSettingsSnapshot(snapshot)
    return {
      message: text,
      metadata: { action: request.name, snapshot },
      content: [{ type: 'text', text }],
    }
  }

  if (request.name === 'set_theme_mode') {
    const theme = normalizeThemeMode(args.mode ?? args.theme)
    if (!theme) throw new Error(st('appAction.invalidThemeMode', undefined, 'Invalid theme mode.'))
    useSettingsStore.getState().setTheme(theme)
    return {
      message: st('appAction.themeModeChanged', { value: theme }, `Theme mode set to ${theme}.`),
      metadata: { action: request.name, theme },
    }
  }

  if (request.name === 'set_theme_family') {
    const themeId = normalizeThemeId(args.themeId ?? args.family ?? args.theme)
    if (!themeId) throw new Error(st('appAction.invalidThemeFamily', undefined, 'Invalid theme family.'))
    useSettingsStore.getState().setThemeId(themeId)
    return {
      message: st('appAction.themeFamilyChanged', { value: themeId }, `Theme family set to ${themeId}.`),
      metadata: { action: request.name, themeId },
    }
  }

  if (request.name === 'set_language') {
    const language = normalizeLanguage(args.language ?? args.locale)
    if (!language) throw new Error(st('appAction.invalidLanguage', undefined, 'Invalid language.'))
    await setAppLanguage(language)
    return {
      message: st('appAction.languageChanged', { value: language }, `Language set to ${language}.`),
      metadata: { action: request.name, language },
    }
  }

  if (request.name === 'set_feature_flag') {
    const flag = normalizeFeatureFlag(args.flag ?? args.name ?? args.key)
    const enabled = normalizeBoolean(args.enabled ?? args.value ?? args.on)
    if (!flag) throw new Error(st('appAction.invalidFeatureFlag', undefined, 'Invalid feature flag.'))
    if (enabled === undefined) throw new Error(st('appAction.invalidFeatureValue', undefined, 'Invalid feature flag value.'))
    useSettingsStore.getState().updateSettings({ [flag.key]: enabled } as Partial<Settings>)
    return {
      message: st('appAction.featureFlagChanged', { feature: flag.label, value: enabled ? 'on' : 'off' }, `${flag.label} ${enabled ? 'enabled' : 'disabled'}.`),
      metadata: { action: request.name, flag: flag.key, enabled },
    }
  }

  throw new Error(st('appAction.unknown', undefined, 'Unknown action.'))
}

async function setAppLanguage(language: Language): Promise<void> {
  useSettingsStore.getState().setLanguage(language)
  setServiceLanguage(language)
  try {
    const i18nModule = await import('@/i18n')
    await i18nModule.changeAppLanguage(language)
  } catch {
    // The service language and persisted setting are already updated; i18next may be unavailable in non-UI tests.
  }
}

function normalizeThemeMode(value: unknown): ThemeMode | undefined {
  return typeof value === 'string' && THEME_MODES.includes(value as ThemeMode) ? value as ThemeMode : undefined
}

function normalizeThemeId(value: unknown): ThemeId | undefined {
  if (value === 'island') return 'cartoon'
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId) ? value as ThemeId : undefined
}

function normalizeLanguage(value: unknown): Language | undefined {
  return typeof value === 'string' && LANGUAGES.includes(value as Language) ? value as Language : undefined
}

function normalizeFeatureFlag(value: unknown): { key: FeatureFlagKey; label: string } | undefined {
  if (typeof value !== 'string') return undefined
  return FEATURE_FLAGS[value.trim().toLowerCase().replace(/[\s-]+/g, '_')]
}

function formatSettingsSnapshot(snapshot: ReturnType<typeof getSettingsSnapshot>): string {
  const rows = [
    st('appAction.settingsSummaryTheme', { theme: snapshot.theme, family: snapshot.themeId }, `Theme: ${snapshot.theme}/${snapshot.themeId}`),
    st('appAction.settingsSummaryLanguage', { language: snapshot.language }, `Language: ${snapshot.language}`),
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
  const label = st(`appAction.featureLabel.${feature}`, undefined, feature)
  const state = enabled === false
    ? st('appAction.disabled', undefined, 'Off')
    : st('appAction.enabled', undefined, 'On')
  return st('appAction.settingsSummaryLine', { feature: label, state }, `${label}: ${state}`)
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', 'on', 'yes', 'enable', 'enabled', '1'].includes(normalized)) return true
  if (['false', 'off', 'no', 'disable', 'disabled', '0'].includes(normalized)) return false
  return undefined
}

function appActionSuccess(
  action: string,
  message: string,
  startedAt: number,
  metadata?: Record<string, unknown>,
  content?: ToolContentBlock[]
): AppActionResult {
  const completedAt = Date.now()
  const blocks = content ?? [{ type: 'text' as const, text: message }]
  return {
    ok: true,
    message,
    content: blocks,
    trace: {
      id: `app-action-${action}-${startedAt}`,
      type: 'tool',
      title: `IsleMind ${action}`,
      content: blocks.map((block) => block.text ?? block.uri ?? block.type).join('\n').slice(0, 1200),
      status: 'done',
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      metadata,
    },
  }
}

function appActionFailure(
  action: string,
  message: string,
  startedAt: number,
  status: ProcessTrace['status'] = 'error',
  metadata: Record<string, unknown> = {}
): AppActionResult {
  const completedAt = Date.now()
  return {
    ok: false,
    message,
    content: [{ type: 'text', text: message }],
    error: message,
    trace: {
      id: `app-action-failed-${action}-${startedAt}`,
      type: 'tool',
      title: `IsleMind ${action}`,
      content: message,
      status,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      metadata: { action, ...metadata },
    },
  }
}
