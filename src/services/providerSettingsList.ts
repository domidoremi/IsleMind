import type { AIProvider } from '@/types'
import { getPolicyAllowedProviderModels, getProviderModelDisplayCandidates, type ProviderModelAccessInput } from '@/services/ai/policy/providerModelAccess'
import { normalizeSearchText } from '@/utils/text'

export type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'
export type ProviderPolicyModelCache = Map<string, string[]>
const PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT = 96

export function filterAndSortProviders(
  providers: AIProvider[],
  options: {
    filter: string
    sortMode: ProviderSortMode
    usageByProvider: Map<string, number>
    settings?: ProviderModelAccessInput['settings']
    policyModelsByProviderId?: ProviderPolicyModelCache
  }
): AIProvider[] {
  const normalizedFilter = normalizeSearchText(options.filter)
  const filtered = normalizedFilter
    ? providers.filter((provider) => providerMatchesModelFilter(provider, normalizedFilter, options.settings, options.policyModelsByProviderId))
    : providers
  return [...filtered].sort((a, b) => compareProviders(a, b, options.sortMode, options.usageByProvider, options.settings, options.policyModelsByProviderId))
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

export function providerMatchesModelFilter(provider: AIProvider, filter: string, settings?: ProviderModelAccessInput['settings'], policyModelsByProviderId?: ProviderPolicyModelCache): boolean {
  const policyModels = policyModelsByProviderId?.get(provider.id) ?? getProviderModelDisplayCandidates({ providers: [provider], settings, includeDisabled: true, includeLocalSetup: true, modelLimit: PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT, includePreferredModel: false })[0]?.models ?? []
  const allowedModelIds = new Set(policyModels.map((model) => model.toLowerCase()))
  const values = [
    provider.name,
    provider.type,
    ...policyModels,
    ...(provider.modelConfigs ?? [])
      .filter((model) => allowedModelIds.has(model.id.toLowerCase()))
      .flatMap((model) => [model.id, model.name]),
  ]
  return values.some((value) => normalizeSearchText(value).includes(filter))
}

function getCachedPolicyModels(provider: AIProvider, settings?: ProviderModelAccessInput['settings'], policyModelsByProviderId?: ProviderPolicyModelCache): string[] {
  return policyModelsByProviderId?.get(provider.id) ?? getPolicyAllowedProviderModels(provider, settings, { limit: PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT })
}
