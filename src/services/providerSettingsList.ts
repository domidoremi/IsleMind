import type { AIProvider } from '@/types'
import { getPolicyAllowedProviderModels, getProviderModelDisplayCandidates, hasProviderModelAccessRules, type ProviderModelAccessInput } from '@/services/ai/policy/providerModelAccess'
import { normalizeSearchText } from '@/utils/text'

export type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'
export type ProviderPolicyModelCache = Map<string, string[]>
export type ProviderSearchTextCache = Map<string, string>
export const PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT = 96

export function filterAndSortProviders(
  providers: AIProvider[],
  options: {
    filter: string
    sortMode: ProviderSortMode
    usageByProvider: Map<string, number>
    settings?: ProviderModelAccessInput['settings']
    policyModelsByProviderId?: ProviderPolicyModelCache
    searchTextByProviderId?: ProviderSearchTextCache
  }
): AIProvider[] {
  const normalizedFilter = normalizeSearchText(options.filter)
  const filtered = normalizedFilter
    ? providers.filter((provider) => providerMatchesModelFilter(provider, normalizedFilter, options.settings, options.policyModelsByProviderId, options.searchTextByProviderId))
    : providers
  return [...filtered].sort((a, b) => compareProviders(a, b, options.sortMode, options.usageByProvider, options.settings, options.policyModelsByProviderId))
}

export function buildProviderSettingsPolicyModelCache(
  providers: AIProvider[],
  settings?: ProviderModelAccessInput['settings'],
  options: { modelLimit?: number } = {},
): ProviderPolicyModelCache {
  const modelLimit = options.modelLimit ?? PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT
  const cache: ProviderPolicyModelCache = new Map()
  for (const provider of providers) {
    cache.set(provider.id, getPolicyAllowedProviderModels(provider, settings, { limit: modelLimit }))
  }
  return cache
}

export function buildProviderSettingsSearchIndex(
  providers: AIProvider[],
  policyModelsByProviderId?: ProviderPolicyModelCache,
): ProviderSearchTextCache {
  const index: ProviderSearchTextCache = new Map()
  for (const provider of providers) {
    index.set(provider.id, buildProviderSearchText(provider, policyModelsByProviderId?.get(provider.id)))
  }
  return index
}

export function compareProviders(
  a: AIProvider,
  b: AIProvider,
  mode: ProviderSortMode,
  usageByProvider: Map<string, number>,
  settings?: ProviderModelAccessInput['settings'],
  policyModelsByProviderId?: ProviderPolicyModelCache
): number {
  if (mode === 'recent') return (usageByProvider.get(b.id) ?? 0) - (usageByProvider.get(a.id) ?? 0)
  if (mode === 'enabled') return Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)
  if (mode === 'models') return getCachedPolicyModels(b, settings, policyModelsByProviderId).length - getCachedPolicyModels(a, settings, policyModelsByProviderId).length || a.name.localeCompare(b.name)
  if (mode === 'health') return providerHealthRank(b) - providerHealthRank(a) || a.name.localeCompare(b.name)
  if (mode === 'name') return a.name.localeCompare(b.name)
  return 0
}

function providerHealthRank(provider: AIProvider): number {
  if (provider.lastTestStatus === 'ok') return 4
  if (provider.lastModelSyncStatus === 'ok') return 3
  if (provider.lastTestStatus === 'bad' || provider.lastModelSyncStatus === 'bad') return 1
  return 2
}

export function providerMatchesModelFilter(
  provider: AIProvider,
  filter: string,
  settings?: ProviderModelAccessInput['settings'],
  policyModelsByProviderId?: ProviderPolicyModelCache,
  searchTextByProviderId?: ProviderSearchTextCache,
): boolean {
  const cachedSearchText = searchTextByProviderId?.get(provider.id)
  if (cachedSearchText !== undefined) return cachedSearchText.includes(filter)
  const policyModels = policyModelsByProviderId?.get(provider.id) ?? (hasProviderModelAccessRules(settings)
    ? getProviderModelDisplayCandidates({ providers: [provider], settings, includeDisabled: true, includeLocalSetup: true, modelLimit: PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT, includePreferredModel: false })[0]?.models ?? []
    : undefined)
  return buildProviderSearchText(provider, policyModels).includes(filter)
}

function buildProviderSearchText(provider: AIProvider, policyModels?: string[]): string {
  const values: Array<string | undefined> = [
    provider.name,
    provider.type,
  ]
  if (policyModels) {
    const allowedModelIds = new Set(policyModels.map((model) => model.toLowerCase()))
    values.push(
      ...policyModels,
      ...(provider.modelConfigs ?? [])
        .filter((model) => allowedModelIds.has(model.id.toLowerCase()))
        .flatMap((model) => [model.id, model.name]),
    )
  } else {
    values.push(
      provider.baseUrl,
      ...(provider.models ?? []),
      ...(provider.modelConfigs ?? []).flatMap((model) => [model.id, model.name]),
      ...(provider.credentialGroups ?? []).flatMap((group) => group.availableModels ?? []),
      ...(provider.modelAliases ?? []).flatMap((alias) => [alias.alias, alias.model]),
      provider.lastTestModel,
    )
  }
  return normalizeSearchText(values.filter(Boolean).join(' '))
}

function getCachedPolicyModels(provider: AIProvider, settings?: ProviderModelAccessInput['settings'], policyModelsByProviderId?: ProviderPolicyModelCache): string[] {
  return policyModelsByProviderId?.get(provider.id) ?? getPolicyAllowedProviderModels(provider, settings, { limit: PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT })
}

export { hasProviderModelAccessRules }
