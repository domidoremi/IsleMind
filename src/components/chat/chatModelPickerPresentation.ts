import { getPolicyAllowedProviderModels } from '@/bootstrap/providerModelAccess'
import { getSettingsModelIdentityKey, normalizeSettingsModelDisplayAliases, normalizeSettingsModelFavorites } from '@/modules/settings'
import type { AIProvider } from '@/types/providerContracts'
import type { SettingsModelDisplayAlias, SettingsModelFavorite } from '@/types/settingsContracts'
import { normalizeProviderModelAliases } from '@/utils/providerModels'
import { normalizeSearchText } from '@/utils/text'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'

export type ChatModelPickerScope =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'provider'; providerId: string }

export interface ChatModelPickerCandidate {
  key: string
  provider: AIProvider
  id: string
  upstreamModel: string
  sourceId: string
  searchText: string
}

/** Search local catalog metadata once; capability/evidence projection is limited
 * to the visible page. Requested aliases stay separate from upstream targets. */
export function buildChatModelPickerCandidates(input: {
  providers: readonly AIProvider[]
  currentProviderId: string | null
  currentModel: string | null
  displayAliases?: readonly SettingsModelDisplayAlias[]
  providerFallbackName: string
}): ChatModelPickerCandidate[] {
  const displayAliases = new Map(normalizeSettingsModelDisplayAliases(input.displayAliases)?.map((alias) => [
    getSettingsModelIdentityKey(alias.providerId, alias.modelId), alias.displayName,
  ]))
  const candidates: ChatModelPickerCandidate[] = []
  const seen = new Set<string>()
  for (const provider of input.providers) {
    // Display cached and policy-blocked rows; selection and dispatch recheck
    // access independently. Catalog enumeration itself makes no network calls.
    const modelIds = getPolicyAllowedProviderModels(provider)
    if (provider.id === input.currentProviderId && input.currentModel) {
      const index = modelIds.indexOf(input.currentModel)
      if (index >= 0) modelIds.splice(index, 1)
      modelIds.unshift(input.currentModel)
    }
    const configs = new Map(provider.modelConfigs?.map((config) => [config.id, config]))
    const routingAliases = new Map(normalizeProviderModelAliases(provider).map((alias) => [alias.alias.toLowerCase(), alias.model]))
    const providerSearchText = `${resolveProviderDisplayName(provider, input.providerFallbackName)} ${provider.name} ${provider.id} ${provider.baseUrl ?? ''}`
    for (const id of modelIds) {
      const key = getSettingsModelIdentityKey(provider.id, id)
      const displayAliasKey = getSettingsModelIdentityKey(provider.id.normalize('NFC').trim(), id.normalize('NFC').trim())
      if (seen.has(key)) continue
      seen.add(key)
      const upstreamModel = routingAliases.get(id.toLowerCase()) ?? id
      const config = configs.get(upstreamModel)
      const source = config?.upstreamProvider
      candidates.push({
        key, provider, id, upstreamModel, sourceId: source?.id ?? '',
        searchText: normalizeSearchText(
          `${providerSearchText} ${id} ${upstreamModel} ${config?.name ?? ''} ${displayAliases.get(displayAliasKey) ?? ''} ${source?.id ?? ''} ${source?.name ?? ''}`,
        ),
      })
    }
  }
  return candidates
}

export function filterChatModelPickerCandidates(input: {
  candidates: readonly ChatModelPickerCandidate[]
  scope: ChatModelPickerScope
  query: string
  favorites?: readonly SettingsModelFavorite[]
  sourceId?: string | null
}): ChatModelPickerCandidate[] {
  const terms = normalizeSearchText(input.query).split(' ').filter(Boolean)
  const favoriteKeys = new Set(normalizeSettingsModelFavorites(input.favorites)?.map((item) => getSettingsModelIdentityKey(item.providerId, item.modelId)))
  return input.candidates.filter((candidate) => {
    if (input.scope.kind === 'provider') {
      if (candidate.provider.id !== input.scope.providerId) return false
      if (input.sourceId !== undefined && input.sourceId !== null && candidate.sourceId !== input.sourceId) return false
    }
    if (input.scope.kind === 'favorites' && !favoriteKeys.has(candidate.key)) return false
    return terms.every((term) => candidate.searchText.includes(term))
  })
}

export function sortChatModelPickerProviders(providers: readonly AIProvider[], currentProviderId: string | null): AIProvider[] {
  return [...providers].sort((left, right) => {
    if (left.id === currentProviderId && right.id !== currentProviderId) return -1
    if (right.id === currentProviderId && left.id !== currentProviderId) return 1
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  })
}
