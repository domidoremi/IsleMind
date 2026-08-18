import type { AIProvider } from '@/types/providerContracts'
import type { ProviderModelAccessInput, ProviderModelAccessPolicy } from './providerModelAccessPolicy'
import { normalizeSearchText } from '@/utils/text'
export type ProviderSortMode = 'manual' | 'recent' | 'enabled' | 'models' | 'health' | 'name'
export type ProviderPolicyModelCache = Map<string, string[]>
export type ProviderSearchTextCache = Map<string, string>
export const PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT = 96
export const PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT = 160

export interface ProviderSettingsGroup {
  id: string
  label: string
  providers: AIProvider[]
}

export type ProviderSettingsListDependencies = Pick<
  ProviderModelAccessPolicy,
  'getPolicyAllowedProviderModels' | 'getProviderModelDisplayCandidates' | 'hasProviderModelAccessRules' | 'resolveProviderModelAliasAccess'
>

export function createProviderSettingsList(dependencies: ProviderSettingsListDependencies) {
  const {
    getPolicyAllowedProviderModels,
    getProviderModelDisplayCandidates,
    hasProviderModelAccessRules,
    resolveProviderModelAliasAccess,
  } = dependencies

  /** Groups visual cards without merging provider records, credentials, or IDs. */
  function groupProviderSettingsCards(providers: AIProvider[]): ProviderSettingsGroup[] {
    const groups = new Map<string, ProviderSettingsGroup>()
    for (const provider of providers) {
      const id = providerSettingsSupplierKey(provider)
      const current = groups.get(id)
      if (current) {
        current.providers.push(provider)
        continue
      }
      groups.set(id, {
        id,
        label: providerSettingsSupplierLabel(provider),
        providers: [provider],
      })
    }
    return [...groups.values()]
  }

  function filterAndSortProviders(
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

  function buildProviderSettingsPolicyModelCache(
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

  function buildProviderSettingsSearchIndex(
    providers: AIProvider[],
    policyModelsByProviderId?: ProviderPolicyModelCache,
  ): ProviderSearchTextCache {
    const index: ProviderSearchTextCache = new Map()
    for (const provider of providers) {
      index.set(provider.id, buildProviderSearchText(provider, policyModelsByProviderId?.get(provider.id)))
    }
    return index
  }

  function compareProviders(
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

  function providerSettingsSupplierKey(provider: AIProvider): string {
    const endpoint = provider.baseUrl?.trim()
    if (endpoint) {
      try {
        const normalizedEndpoint = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
        return `endpoint:${new URL(normalizedEndpoint).hostname.toLowerCase()}`
      } catch {
        return `endpoint:${endpoint.toLowerCase().replace(/^https?:\/\//i, '').replace(/\/+$/u, '')}`
      }
    }
    const presetId = provider.detectedPresetId ?? provider.presetId
    if (presetId && presetId !== 'custom-endpoint') return `preset:${presetId}`
    return `type:${provider.type}`
  }

  function providerSettingsSupplierLabel(provider: AIProvider): string {
    if (provider.baseUrl?.trim()) {
      try {
        const normalizedEndpoint = /^https?:\/\//i.test(provider.baseUrl) ? provider.baseUrl : `https://${provider.baseUrl}`
        return new URL(normalizedEndpoint).hostname
      } catch {
        return provider.name
      }
    }
    const presetId = provider.detectedPresetId ?? provider.presetId
    if (presetId && presetId !== 'custom-endpoint') return presetId
    return provider.name
  }

  function providerMatchesModelFilter(
    provider: AIProvider,
    filter: string,
    settings?: ProviderModelAccessInput['settings'],
    policyModelsByProviderId?: ProviderPolicyModelCache,
    searchTextByProviderId?: ProviderSearchTextCache,
  ): boolean {
    const cachedSearchText = searchTextByProviderId?.get(provider.id)
    if (cachedSearchText !== undefined) {
      return cachedSearchText.includes(filter) || providerSourceModelMatchesFilter(provider, filter, settings)
    }
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
      )
      for (const model of provider.modelConfigs ?? []) {
        if (allowedModelIds.has(model.id.toLowerCase())) values.push(model.id, model.name)
      }
    } else {
      values.push(
        provider.baseUrl,
        provider.lastTestModel,
      )
      appendSampledProviderSearchValues(values, provider.models ?? [])
      appendSampledProviderModelConfigValues(values, provider.modelConfigs ?? [])
      appendSampledProviderCredentialGroupValues(values, provider.credentialGroups ?? [])
      appendSampledProviderAliasValues(values, provider.modelAliases ?? [])
    }
    return normalizeSearchText(values.filter(Boolean).join(' '))
  }

  function appendSampledProviderSearchValues(target: Array<string | undefined>, values: readonly string[]): void {
    appendSampledProviderSearchItems(target, values, (value) => [value])
  }

  function appendSampledProviderModelConfigValues(target: Array<string | undefined>, models: NonNullable<AIProvider['modelConfigs']>): void {
    appendSampledProviderSearchItems(target, models, (model) => [model.id, model.name])
  }

  function appendSampledProviderCredentialGroupValues(target: Array<string | undefined>, groups: NonNullable<AIProvider['credentialGroups']>): void {
    let appended = 0
    const append = (value: string | undefined): boolean => {
      const normalized = value?.trim()
      if (!normalized) return false
      target.push(normalized)
      appended += 1
      return appended >= PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT
    }
    for (const group of groups) {
      for (const model of group.availableModels ?? []) {
        if (append(model)) return
      }
    }
  }

  function appendSampledProviderAliasValues(target: Array<string | undefined>, aliases: NonNullable<AIProvider['modelAliases']>): void {
    appendSampledProviderSearchItems(target, aliases, (alias) => [alias.alias, alias.model])
  }

  function appendSampledProviderSearchItems<T>(
    target: Array<string | undefined>,
    items: readonly T[],
    valuesForItem: (item: T) => Array<string | undefined>,
  ): void {
    if (items.length <= PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT) {
      appendProviderSearchItemRange(target, items, valuesForItem, 0, items.length)
      return
    }
    const headCount = Math.ceil(PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT / 2)
    const tailCount = Math.floor(PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT / 2)
    appendProviderSearchItemRange(target, items, valuesForItem, 0, headCount)
    appendProviderSearchItemRange(target, items, valuesForItem, items.length - tailCount, items.length)
  }

  function appendProviderSearchItemRange<T>(
    target: Array<string | undefined>,
    items: readonly T[],
    valuesForItem: (item: T) => Array<string | undefined>,
    start: number,
    end: number,
  ): void {
    for (let index = start; index < end; index += 1) {
      for (const value of valuesForItem(items[index])) {
        const normalized = value?.trim()
        if (normalized) target.push(normalized)
      }
    }
  }

  function providerSourceModelMatchesFilter(provider: AIProvider, filter: string, settings?: ProviderModelAccessInput['settings']): boolean {
    const policyScoped = hasProviderModelAccessRules(settings)
    const modelAllowed = (model: string | undefined): boolean => {
      const normalized = model?.trim()
      return !!normalized && (!policyScoped || resolveProviderModelAliasAccess({ provider, model: normalized, settings }).allowed)
    }
    const modelMatches = (model: string | undefined, label?: string): boolean => {
      if (!modelAllowed(model)) return false
      return providerSearchValueMatchesFilter(model, filter) || providerSearchValueMatchesFilter(label, filter)
    }

    if (modelMatches(provider.lastTestModel)) return true
    for (const model of provider.models ?? []) {
      if (modelMatches(model)) return true
    }
    for (const model of provider.modelConfigs ?? []) {
      if (modelMatches(model.id, model.name)) return true
    }
    for (const group of provider.credentialGroups ?? []) {
      for (const model of group.availableModels ?? []) {
        if (modelMatches(model)) return true
      }
    }
    for (const alias of provider.modelAliases ?? []) {
      if (modelMatches(alias.alias) || modelMatches(alias.model)) return true
    }
    return false
  }

  function providerSearchValueMatchesFilter(value: string | undefined, filter: string): boolean {
    return normalizeSearchText(value ?? '').includes(filter)
  }

  function getCachedPolicyModels(provider: AIProvider, settings?: ProviderModelAccessInput['settings'], policyModelsByProviderId?: ProviderPolicyModelCache): string[] {
    return policyModelsByProviderId?.get(provider.id) ?? getPolicyAllowedProviderModels(provider, settings, { limit: PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT })
  }

  return {
    buildProviderSettingsPolicyModelCache,
    buildProviderSettingsSearchIndex,
    compareProviders,
    filterAndSortProviders,
    groupProviderSettingsCards,
    providerMatchesModelFilter,
    providerSettingsSupplierKey,
    providerSettingsSupplierLabel,
  }
}
