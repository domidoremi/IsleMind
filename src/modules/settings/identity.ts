import type { Settings, SettingsModelDisplayAlias } from '@/types/settingsContracts'

export const SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH = 48
export const SETTINGS_IDENTITY_ID_MAX_LENGTH = 200
export const SETTINGS_MODEL_DISPLAY_ALIAS_LIMIT = 128

export function normalizeSettingsIdentityDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (!normalized) return undefined
  return Array.from(normalized).slice(0, SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH).join('')
}

export function normalizeSettingsModelDisplayAliases(value: unknown): SettingsModelDisplayAlias[] | undefined {
  if (!Array.isArray(value)) return undefined
  const byIdentity = new Map<string, SettingsModelDisplayAlias>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    const providerId = normalizeIdentityId(record.providerId)
    const modelId = normalizeIdentityId(record.modelId)
    const displayName = normalizeSettingsIdentityDisplayName(record.displayName)
    if (!providerId || !modelId || !displayName) continue
    const key = modelIdentityKey(providerId, modelId)
    if (!byIdentity.has(key) && byIdentity.size >= SETTINGS_MODEL_DISPLAY_ALIAS_LIMIT) continue
    byIdentity.set(key, { providerId, modelId, displayName })
  }
  const normalized = Array.from(byIdentity.values())
  return normalized.length ? normalized : undefined
}

export function normalizeSettingsIdentityPreferences(settings: Settings): Settings {
  const assistantDisplayName = normalizeSettingsIdentityDisplayName(settings.assistantDisplayName)
  const modelDisplayAliases = normalizeSettingsModelDisplayAliases(settings.modelDisplayAliases)
  if (
    settings.assistantDisplayName === assistantDisplayName &&
    modelDisplayAliasesEqual(settings.modelDisplayAliases, modelDisplayAliases)
  ) {
    return settings
  }

  const normalized: Settings = { ...settings }
  if (assistantDisplayName) normalized.assistantDisplayName = assistantDisplayName
  else delete normalized.assistantDisplayName
  if (modelDisplayAliases) normalized.modelDisplayAliases = modelDisplayAliases
  else delete normalized.modelDisplayAliases
  return normalized
}

export function getSettingsModelDisplayAlias(
  aliases: readonly SettingsModelDisplayAlias[] | undefined,
  providerId: string,
  modelId: string,
): string | undefined {
  const normalizedProviderId = normalizeIdentityId(providerId)
  const normalizedModelId = normalizeIdentityId(modelId)
  if (!normalizedProviderId || !normalizedModelId) return undefined
  return normalizeSettingsModelDisplayAliases(aliases)?.find(
    (alias) => alias.providerId === normalizedProviderId && alias.modelId === normalizedModelId,
  )?.displayName
}

export function upsertSettingsModelDisplayAlias(
  aliases: readonly SettingsModelDisplayAlias[] | undefined,
  input: { providerId: string; modelId: string; displayName: unknown },
): SettingsModelDisplayAlias[] | undefined {
  const providerId = normalizeIdentityId(input.providerId)
  const modelId = normalizeIdentityId(input.modelId)
  if (!providerId || !modelId) return normalizeSettingsModelDisplayAliases(aliases)

  const current = normalizeSettingsModelDisplayAliases(aliases) ?? []
  const remaining = current.filter((alias) => alias.providerId !== providerId || alias.modelId !== modelId)
  const displayName = normalizeSettingsIdentityDisplayName(input.displayName)
  if (!displayName) return remaining.length ? remaining : undefined
  if (remaining.length >= SETTINGS_MODEL_DISPLAY_ALIAS_LIMIT) return current
  return [...remaining, { providerId, modelId, displayName }]
}

function normalizeIdentityId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.normalize('NFC').trim()
  if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) return undefined
  if (Array.from(normalized).length > SETTINGS_IDENTITY_ID_MAX_LENGTH) return undefined
  return normalized
}

function modelIdentityKey(providerId: string, modelId: string): string {
  return `${providerId.length}:${providerId}${modelId}`
}

function modelDisplayAliasesEqual(
  current: readonly SettingsModelDisplayAlias[] | undefined,
  normalized: readonly SettingsModelDisplayAlias[] | undefined,
): boolean {
  if (!current?.length && !normalized?.length) return true
  if (!current || !normalized || current.length !== normalized.length) return false
  return current.every((alias, index) => {
    const candidate = normalized[index]
    return alias.providerId === candidate.providerId && alias.modelId === candidate.modelId && alias.displayName === candidate.displayName
  })
}
