import type { AIProvider } from '@/types'
import { getPolicyAllowedProviderModels, getProviderModelDisplayCandidates, type ProviderModelAccessInput } from '@/services/ai/policy/providerModelAccess'
import { normalizeSearchText } from '@/utils/text'

export type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'

export function filterAndSortProviders(
  providers: AIProvider[],
  options: {
    filter: string
    sortMode: ProviderSortMode
    usageByProvider: Map<string, number>
    settings?: ProviderModelAccessInput['settings']
  }
): AIProvider[] {
  const normalizedFilter = normalizeSearchText(options.filter)
  const filtered = normalizedFilter
    ? providers.filter((provider) => providerMatchesModelFilter(provider, normalizedFilter, options.settings))
    : providers
  return [...filtered].sort((a, b) => compareProviders(a, b, options.sortMode, options.usageByProvider, options.settings))
}

export function compareProviders(
  a: AIProvider,
  b: AIProvider,
  mode: ProviderSortMode,
  usageByProvider: Map<string, number>,
  settings?: ProviderModelAccessInput['settings']
): number {
  if (mode === 'recent') return (usageByProvider.get(b.id) ?? 0) - (usageByProvider.get(a.id) ?? 0)
  if (mode === 'enabled') return Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)
  if (mode === 'models') return getPolicyAllowedProviderModels(b, settings).length - getPolicyAllowedProviderModels(a, settings).length || a.name.localeCompare(b.name)
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

export function providerMatchesModelFilter(provider: AIProvider, filter: string, settings?: ProviderModelAccessInput['settings']): boolean {
  const policyModels = getProviderModelDisplayCandidates({ providers: [provider], settings, includeDisabled: true, includeLocalSetup: true })[0]?.models ?? []
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
