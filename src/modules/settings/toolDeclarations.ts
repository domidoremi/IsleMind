import type { Settings, ToolDeclarationMode } from '@/types/settingsContracts'

/** Old, absent and malformed values never silently enable deferred declarations. */
export function normalizeSettingsToolDeclarationMode(value: unknown): ToolDeclarationMode {
  return value === 'auto' ? 'auto' : 'full'
}

export function normalizeSettingsToolDeclarations(settings: Settings): Settings {
  if (settings.toolDeclarationMode === undefined) return settings
  const mode = normalizeSettingsToolDeclarationMode(settings.toolDeclarationMode)
  return settings.toolDeclarationMode === mode ? settings : { ...settings, toolDeclarationMode: mode }
}
