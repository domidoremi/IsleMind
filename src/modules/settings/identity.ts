import type { Settings, SettingsModelDisplayAlias, SettingsModelFavorite, SettingsLastPreferredModel } from '@/types/settingsContracts'
import { normalizeModelRoutingPlans } from '@/core/modelRoutingPlan'
import { normalizeSettingsToolDeclarations } from './toolDeclarations'
import { normalizeSettingsScenePlans } from './scenePlans'

export const SETTINGS_IDENTITY_DISPLAY_NAME_MAX_LENGTH = 48
export const SETTINGS_IDENTITY_ID_MAX_LENGTH = 200
export const SETTINGS_MODEL_DISPLAY_ALIAS_LIMIT = 128
export const SETTINGS_MODEL_FAVORITE_LIMIT = 128

export class SettingsModelFavoriteLimitError extends Error {
  constructor() {
    super('The model favorite limit has been reached.')
    this.name = 'SettingsModelFavoriteLimitError'
  }
}

export function getSettingsModelIdentityKey(providerId: string, modelId: string): string {
  return `${providerId.length}:${providerId}${modelId}`
}

export function normalizeSettingsModelFavorites(value: unknown): SettingsModelFavorite[] | undefined {
  if (!Array.isArray(value)) return undefined
  const byIdentity = new Map<string, SettingsModelFavorite>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    const providerId = normalizeFavoriteIdentityId(record.providerId)
    const modelId = normalizeFavoriteIdentityId(record.modelId)
    if (!providerId || !modelId) continue
    const key = getSettingsModelIdentityKey(providerId, modelId)
    if (byIdentity.has(key)) continue
    byIdentity.set(key, { providerId, modelId })
    if (byIdentity.size === SETTINGS_MODEL_FAVORITE_LIMIT) break
  }
  // An explicit empty list can clear favorites during a selective restore;
  // absence in a legacy record remains distinct.
  return Array.from(byIdentity.values())
}

export function setSettingsModelFavorite(
  favorites: readonly SettingsModelFavorite[] | undefined,
  input: { providerId: string; modelId: string; favorite: boolean },
): SettingsModelFavorite[] | undefined {
  const providerId = normalizeFavoriteIdentityId(input.providerId)
  const modelId = normalizeFavoriteIdentityId(input.modelId)
  if (!providerId || !modelId) throw new TypeError('A complete model favorite identity is required.')
  const current = normalizeSettingsModelFavorites(favorites) ?? []
  const exists = current.some((item) => item.providerId === providerId && item.modelId === modelId)
  if (input.favorite && !exists) {
    if (current.length >= SETTINGS_MODEL_FAVORITE_LIMIT) throw new SettingsModelFavoriteLimitError()
    return [...current, { providerId, modelId }]
  }
  const next = input.favorite ? current : current.filter((item) => item.providerId !== providerId || item.modelId !== modelId)
  return next
}

export function removeSettingsModelFavoritesForProviders(
  favorites: readonly SettingsModelFavorite[] | undefined,
  providerIds: readonly string[],
): SettingsModelFavorite[] | undefined {
  const removed = new Set(providerIds)
  const remaining = normalizeSettingsModelFavorites(favorites)?.filter((item) => !removed.has(item.providerId))
  return remaining
}

export function normalizeSettingsLastPreferredModel(value: unknown): SettingsLastPreferredModel | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.schema !== 'islemind.global-model-preference.v1') {
    throw new TypeError('Unsupported global model preference version.')
  }
  const providerId = normalizeIdentityId(record.providerId)
  const model = normalizeIdentityId(record.model)
  return providerId && model ? { schema: 'islemind.global-model-preference.v1', providerId, model } : undefined
}

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
    const key = getSettingsModelIdentityKey(providerId, modelId)
    if (!byIdentity.has(key) && byIdentity.size >= SETTINGS_MODEL_DISPLAY_ALIAS_LIMIT) continue
    byIdentity.set(key, { providerId, modelId, displayName })
  }
  const normalized = Array.from(byIdentity.values())
  return normalized.length ? normalized : undefined
}

export function normalizeSettingsIdentityPreferences(settings: Settings): Settings {
  settings = normalizeSettingsScenePlans(normalizeSettingsToolDeclarations(settings))
  const modelRoutingPlans = normalizeModelRoutingPlans(settings.modelRoutingPlans)
  const assistantDisplayName = normalizeSettingsIdentityDisplayName(settings.assistantDisplayName)
  const modelDisplayAliases = normalizeSettingsModelDisplayAliases(settings.modelDisplayAliases)
  const modelFavorites = normalizeSettingsModelFavorites(settings.modelFavorites)
  const lastPreferredModel = normalizeSettingsLastPreferredModel(settings.lastPreferredModel)
  if (
    JSON.stringify(settings.modelRoutingPlans) === JSON.stringify(modelRoutingPlans) &&
    settings.assistantDisplayName === assistantDisplayName &&
    modelDisplayAliasesEqual(settings.modelDisplayAliases, modelDisplayAliases) &&
    JSON.stringify(settings.modelFavorites) === JSON.stringify(modelFavorites) &&
    JSON.stringify(settings.lastPreferredModel) === JSON.stringify(lastPreferredModel)
  ) {
    return settings
  }

  const normalized: Settings = { ...settings }
  if (modelRoutingPlans) normalized.modelRoutingPlans = modelRoutingPlans
  else delete normalized.modelRoutingPlans
  if (assistantDisplayName) normalized.assistantDisplayName = assistantDisplayName
  else delete normalized.assistantDisplayName
  if (modelDisplayAliases) normalized.modelDisplayAliases = modelDisplayAliases
  else delete normalized.modelDisplayAliases
  if (modelFavorites) normalized.modelFavorites = modelFavorites
  else delete normalized.modelFavorites
  if (lastPreferredModel) normalized.lastPreferredModel = lastPreferredModel
  else delete normalized.lastPreferredModel
  return normalized
}

export function getSettingsModelDisplayAlias(
  aliases: readonly SettingsModelDisplayAlias[] | undefined,
  providerId: string,
  modelId: string | null,
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

function normalizeFavoriteIdentityId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // Request IDs are opaque. Unicode normalization could silently point a
  // favorite at another alias or make it disappear from the local catalog.
  const normalized = value.trim()
  if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized)) return undefined
  if (Array.from(normalized).length > SETTINGS_IDENTITY_ID_MAX_LENGTH) return undefined
  return normalized
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
