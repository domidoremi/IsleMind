import { create } from 'zustand'
import { getModelConfig, getProviderConfigIssue, XIAOMI_MIMO_PAYG_BASE_URL, getXiaomiMimoOfficialBaseUrl } from '@/types'
import type { Settings, AIProvider, Language, ProviderCredentialGroup, ThemeMode } from '@/types'
import { loadData, saveData } from '@/services/storage'
import * as SecureStore from 'expo-secure-store'
import { applyProviderPreset, defaultProviderSyncPolicy, detectProviderPreset, getProviderPreset } from '@/services/ai/providerRegistry'
import { normalizeProviderCredentialGroups } from '@/services/ai/providerCredentials'
import { legacySearchModeForProvider, resolveSearchProvider } from '@/services/searchPolicy'
import { clearHistoricalInjectedGroupModels, clearHistoricalInjectedProviderModels, getProviderPreferredModel, isProviderConversationReady } from '@/utils/providerModels'
import { st } from '@/i18n/service'
import { setServiceLanguage } from '@/i18n/service'

interface SettingsState {
  settings: Settings
  providers: AIProvider[]

  load: () => Promise<void>
  updateSettings: (updates: Partial<Settings>) => void
  setTheme: (theme: ThemeMode) => void
  setLanguage: (language: Language) => void
  addProvider: (provider: AIProvider) => Promise<void>
  addProviders: (providers: AIProvider[]) => Promise<void>
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  updateProviders: (ids: string[], updates: Partial<AIProvider>) => Promise<void>
  reorderProviders: (providerIds: string[]) => void
  removeProvider: (id: string) => Promise<void>
  setProviderApiKey: (id: string, apiKey: string) => Promise<void>
  getSecureApiKey: (id: string) => Promise<string | null>
  setProviderCredentialGroupKey: (providerId: string, groupId: string, apiKey: string) => Promise<void>
  getProviderCredentialGroupKey: (providerId: string, groupId: string) => Promise<string | null>
  updateProviderCredentialGroupHealth: (providerId: string, groupId: string | undefined, ok: boolean) => Promise<void>
  setTavilyApiKey: (apiKey: string) => Promise<void>
  getTavilyApiKey: () => Promise<string | null>
  setGoogleSearchApiKey: (apiKey: string) => Promise<void>
  getGoogleSearchApiKey: () => Promise<string | null>
  setBingSearchApiKey: (apiKey: string) => Promise<void>
  getBingSearchApiKey: () => Promise<string | null>
  setCustomSearchApiKey: (apiKey: string) => Promise<void>
  getCustomSearchApiKey: () => Promise<string | null>
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  getConfiguredProviders: () => Promise<AIProvider[]>
  getPrimaryConfiguredProvider: () => Promise<AIProvider | null>
  clearAll: () => Promise<void>
}

const defaultSettings: Settings = {
  theme: 'system',
  language: 'zh-CN',
  defaultProvider: null,
  fontSize: 16,
  hapticsEnabled: true,
  defaultTemperature: 0.7,
  defaultMaxTokens: undefined,
  memoryEnabled: true,
  knowledgeEnabled: true,
  petEnabled: false,
  webSearchEnabled: true,
  webSearchMode: 'native',
  knowledgeTopK: 4,
  memoryTopK: 4,
  onboardingCompleted: false,
  ragMode: 'hybrid',
  embeddingMode: 'hybrid',
  localEmbeddingModelId: undefined,
  localEmbeddingModelSource: 'none',
  localModelDownloadMirrorBaseUrl: '',
  ragProfile: 'balanced',
  ragQueryRewriteEnabled: true,
  ragHydeEnabled: true,
  ragFlareEnabled: true,
  ragGraphEnabled: true,
  ragRaptorEnabled: true,
  ragCrossEncoderEnabled: true,
  ragColbertEnabled: true,
  ragLlmlinguaEnabled: true,
  searchProvider: 'native',
  autoUpdateCheckEnabled: true,
  providerCatalogVersion: 1,
  skillsEnabled: true,
  mcpEnabled: true,
  commandPaletteEnabled: true,
}

const PROVIDER_CATALOG_VERSION = 1
const LEGACY_DEFAULT_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'xiaomi-mimo',
  'deepseek',
  'dashscope',
  'bigmodel',
  'xai',
  'openrouter',
  'newapi',
  'sub2api',
  'custom-openai',
  'custom-anthropic',
]

function secureProviderKey(id: string): string {
  return `islemind.key.${id.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

function secureProviderGroupKey(providerId: string, groupId: string): string {
  return `islemind.key.${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}.${groupId.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

const TAVILY_KEY = 'islemind.key.tavily'
const GOOGLE_SEARCH_KEY = 'islemind.key.google-search'
const BING_SEARCH_KEY = 'islemind.key.bing-search'
const CUSTOM_SEARCH_KEY = 'islemind.key.custom-search'

async function setSecureKey(key: string, value: string): Promise<void> {
  if (value) {
    await SecureStore.setItemAsync(key, value)
  } else {
    await SecureStore.deleteItemAsync(key)
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  providers: [],

  load: async () => {
    const [settings, providers] = await Promise.all([
      loadData<Settings>('SETTINGS'),
      loadData<AIProvider[]>('PROVIDERS'),
    ])
    const rawSettings = settings ? { ...defaultSettings, ...settings } : defaultSettings
    const resolvedSearchProvider = resolveSearchProvider(rawSettings)
    const resetCatalog = (rawSettings.providerCatalogVersion ?? PROVIDER_CATALOG_VERSION) < PROVIDER_CATALOG_VERSION
    if (resetCatalog) {
      await clearProviderCatalogSecrets(providers ?? [])
    }
    const mergedSettings = {
      ...rawSettings,
      providerCatalogVersion: PROVIDER_CATALOG_VERSION,
      defaultProvider: resetCatalog ? null : rawSettings.defaultProvider,
      searchProvider: resolvedSearchProvider,
      webSearchMode: legacySearchModeForProvider(resolvedSearchProvider),
      webSearchEnabled: resolvedSearchProvider !== 'off',
    }
    const mergedProviders = resetCatalog ? [] : mergeProviders(providers ?? [])
    const defaultProvider = mergedProviders.some((provider) => provider.id === mergedSettings.defaultProvider)
      ? mergedSettings.defaultProvider
      : null
    set({
      settings: { ...mergedSettings, defaultProvider },
      providers: mergedProviders,
    })
    if (resetCatalog) {
      saveData('SETTINGS', { ...mergedSettings, defaultProvider: null })
      saveData('PROVIDERS', [])
    }
  },

  updateSettings: (updates: Partial<Settings>) => {
    set((state) => {
      const draft = { ...state.settings, ...updates }
      const resolved = updates.searchProvider ?? (
        updates.webSearchMode || updates.webSearchEnabled !== undefined
          ? resolveSearchProvider(draft)
          : draft.searchProvider
      )
      const nextSearchProvider = updates.webSearchEnabled === true && resolved === 'off' ? 'native' : resolved
      const updated = nextSearchProvider
        ? {
            ...draft,
            searchProvider: nextSearchProvider,
            webSearchMode: legacySearchModeForProvider(nextSearchProvider),
            webSearchEnabled: nextSearchProvider !== 'off',
          }
        : draft
      saveData('SETTINGS', updated)
      return { settings: updated }
    })
  },

  setTheme: (theme: ThemeMode) => {
    get().updateSettings({ theme })
  },

  setLanguage: (language: Language) => {
    setServiceLanguage(language)
    get().updateSettings({ language })
  },

  addProvider: async (provider: AIProvider) => {
    if (provider.apiKey) {
      await SecureStore.setItemAsync(secureProviderKey(provider.id), provider.apiKey)
    }
    await persistCredentialGroupKeys(provider.id, provider.credentialGroups)
    set((state) => {
      const updated = [normalizeProvider({ ...provider, apiKey: '' } as AIProvider), ...state.providers]
      saveData('PROVIDERS', updated)
      if (!state.settings.defaultProvider) {
        get().updateSettings({ defaultProvider: provider.id })
      }
      return { providers: updated }
    })
  },

  updateProvider: async (id: string, updates: Partial<AIProvider>) => {
    if (updates.apiKey) {
      await SecureStore.setItemAsync(secureProviderKey(id), updates.apiKey)
    }
    if (updates.credentialGroups) {
      const previous = get().providers.find((provider) => provider.id === id)?.credentialGroups ?? []
      const nextIds = new Set(updates.credentialGroups.map((group) => group.id))
      await Promise.all(previous
        .filter((group) => !nextIds.has(group.id))
        .map((group) => SecureStore.deleteItemAsync(secureProviderGroupKey(id, group.id)))
      )
      await persistCredentialGroupKeys(id, updates.credentialGroups)
    }
    set((state) => {
      const updated = state.providers.map((p) =>
        p.id === id ? normalizeProvider({ ...p, ...updates, apiKey: '' } as AIProvider) : p
      )
      saveData('PROVIDERS', updated)
      return { providers: updated }
    })
  },

  addProviders: async (providers: AIProvider[]) => {
    if (!providers.length) return
    await Promise.all(providers.map(async (provider) => {
      if (provider.apiKey) {
        await SecureStore.setItemAsync(secureProviderKey(provider.id), provider.apiKey)
      }
      await persistCredentialGroupKeys(provider.id, provider.credentialGroups)
    }))
    set((state) => {
      const normalized = providers.map((provider) => normalizeProvider({ ...provider, apiKey: '' } as AIProvider))
      const existingIds = new Set(normalized.map((provider) => provider.id))
      const updated = [...normalized, ...state.providers.filter((provider) => !existingIds.has(provider.id))]
      const defaultProvider = state.settings.defaultProvider ?? normalized[0]?.id ?? null
      const settings = { ...state.settings, defaultProvider }
      saveData('PROVIDERS', updated)
      saveData('SETTINGS', settings)
      return { providers: updated, settings }
    })
  },

  updateProviders: async (ids: string[], updates: Partial<AIProvider>) => {
    const uniqueIds = Array.from(new Set(ids))
    if (!uniqueIds.length) return
    await Promise.all(uniqueIds.map((id) => get().updateProvider(id, updates)))
  },

  reorderProviders: (providerIds: string[]) => {
    set((state) => {
      const byId = new Map(state.providers.map((provider) => [provider.id, provider]))
      const ordered = providerIds
        .map((id) => byId.get(id))
        .filter((provider): provider is AIProvider => !!provider)
      const seen = new Set(ordered.map((provider) => provider.id))
      const rest = state.providers.filter((provider) => !seen.has(provider.id))
      const updated = [...ordered, ...rest]
      saveData('PROVIDERS', updated)
      return { providers: updated }
    })
  },

  removeProvider: async (id: string) => {
    await SecureStore.deleteItemAsync(secureProviderKey(id))
    const provider = get().providers.find((item) => item.id === id)
    await Promise.all((provider?.credentialGroups ?? []).map((group) => SecureStore.deleteItemAsync(secureProviderGroupKey(id, group.id))))
    set((state) => {
      const updated = state.providers.filter((p) => p.id !== id)
      saveData('PROVIDERS', updated)
      saveData('SETTINGS', {
        ...state.settings,
        defaultProvider: state.settings.defaultProvider === id ? null : state.settings.defaultProvider,
      })
      return {
        providers: updated,
        settings:
          state.settings.defaultProvider === id
            ? { ...state.settings, defaultProvider: null }
            : state.settings,
      }
    })
  },

  setProviderApiKey: async (id: string, apiKey: string) => {
    if (apiKey) {
      await SecureStore.setItemAsync(secureProviderKey(id), apiKey)
    } else {
      await SecureStore.deleteItemAsync(secureProviderKey(id))
    }
  },

  getSecureApiKey: async (id: string) => {
    return SecureStore.getItemAsync(secureProviderKey(id))
  },

  setProviderCredentialGroupKey: async (providerId: string, groupId: string, apiKey: string) => {
    if (apiKey) {
      await SecureStore.setItemAsync(secureProviderGroupKey(providerId, groupId), apiKey)
    } else {
      await SecureStore.deleteItemAsync(secureProviderGroupKey(providerId, groupId))
    }
  },

  getProviderCredentialGroupKey: async (providerId: string, groupId: string) => {
    return SecureStore.getItemAsync(secureProviderGroupKey(providerId, groupId))
  },

  updateProviderCredentialGroupHealth: async (providerId: string, groupId: string | undefined, ok: boolean) => {
    if (!groupId) return
    set((state) => {
      const now = Date.now()
      const updated = state.providers.map((provider) => {
        if (provider.id !== providerId || !provider.credentialGroups?.length) return provider
        return {
          ...provider,
          credentialGroups: provider.credentialGroups.map((group) => {
            if (group.id !== groupId) return group
            return {
              ...group,
              lastUsedAt: now,
              lastFailureAt: ok ? group.lastFailureAt : now,
              failureCount: ok ? 0 : (group.failureCount ?? 0) + 1,
            }
          }),
        }
      })
      saveData('PROVIDERS', updated)
      return { providers: updated }
    })
  },

  setTavilyApiKey: async (apiKey: string) => {
    if (apiKey) {
      await SecureStore.setItemAsync(TAVILY_KEY, apiKey)
    } else {
      await SecureStore.deleteItemAsync(TAVILY_KEY)
    }
  },

  getTavilyApiKey: async () => {
    return SecureStore.getItemAsync(TAVILY_KEY)
  },

  setGoogleSearchApiKey: async (apiKey: string) => setSecureKey(GOOGLE_SEARCH_KEY, apiKey),
  getGoogleSearchApiKey: async () => SecureStore.getItemAsync(GOOGLE_SEARCH_KEY),
  setBingSearchApiKey: async (apiKey: string) => setSecureKey(BING_SEARCH_KEY, apiKey),
  getBingSearchApiKey: async () => SecureStore.getItemAsync(BING_SEARCH_KEY),
  setCustomSearchApiKey: async (apiKey: string) => setSecureKey(CUSTOM_SEARCH_KEY, apiKey),
  getCustomSearchApiKey: async () => SecureStore.getItemAsync(CUSTOM_SEARCH_KEY),

  hydrateProviderKey: async (id: string) => {
    const provider = get().providers.find((item) => item.id === id)
    if (!provider) return null
    const apiKey = await SecureStore.getItemAsync(secureProviderKey(id))
    const credentialGroups = await Promise.all((provider.credentialGroups ?? []).map(async (group) => ({
      ...group,
      apiKey: await SecureStore.getItemAsync(secureProviderGroupKey(id, group.id)) ?? group.apiKey ?? '',
    })))
    const primaryGroupKey = credentialGroups.find((group) => group.enabled && group.apiKey)?.apiKey
    return normalizeProviderCredentialGroups({ ...provider, apiKey: apiKey ?? primaryGroupKey ?? '', credentialGroups })
  },

  getConfiguredProviders: async () => {
    const hydrated = await Promise.all(get().providers.map((provider) => get().hydrateProviderKey(provider.id)))
    return hydrated.filter((provider): provider is AIProvider => {
      if (!provider || !isProviderConversationReady(provider)) return false
      const hasCredential = provider.apiKey.trim() || provider.credentialGroups?.some((group) => group.enabled && group.apiKey?.trim())
      if (!hasCredential) return false
      if (!getProviderPreferredModel(provider)) return false
      return !getProviderConfigIssue(provider, provider.apiKey)
    })
  },

  getPrimaryConfiguredProvider: async () => {
    const configured = await get().getConfiguredProviders()
    const defaultProvider = get().settings.defaultProvider
    return configured.find((provider) => provider.id === defaultProvider) ?? configured[0] ?? null
  },

  clearAll: async () => {
    const resetSettings = { ...defaultSettings, defaultProvider: null, onboardingCompleted: false, providerCatalogVersion: PROVIDER_CATALOG_VERSION }
    await Promise.all([
      ...LEGACY_DEFAULT_PROVIDER_IDS.map((id) => SecureStore.deleteItemAsync(secureProviderKey(id))),
      SecureStore.deleteItemAsync(TAVILY_KEY),
      SecureStore.deleteItemAsync(GOOGLE_SEARCH_KEY),
      SecureStore.deleteItemAsync(BING_SEARCH_KEY),
      SecureStore.deleteItemAsync(CUSTOM_SEARCH_KEY),
      ...get().providers.flatMap((provider) => (provider.credentialGroups ?? []).map((group) => SecureStore.deleteItemAsync(secureProviderGroupKey(provider.id, group.id)))),
    ])
    saveData('SETTINGS', resetSettings)
    const resetProviders: AIProvider[] = []
    saveData('PROVIDERS', resetProviders)
    set({ settings: resetSettings, providers: resetProviders })
  },
}))

function mergeProviders(saved: AIProvider[]): AIProvider[] {
  return saved.map((provider) => normalizeProvider({ ...provider, apiKey: '' } as AIProvider))
}

function normalizeProvider(provider: AIProvider): AIProvider {
  const models = normalizeProviderModels(provider)
  const baseUrl = normalizeProviderBaseUrl(provider)
  const detectedPresetId = provider.detectedPresetId ?? detectProviderPreset({ baseUrl, apiKey: provider.apiKey, name: provider.name }).presetId
  const presetId = provider.presetId ?? (provider.id === 'custom-openai' ? 'custom-openai-compatible' : detectedPresetId)
  const preset = getProviderPreset(presetId)
  const normalized = applyProviderPreset({
    ...provider,
    apiKey: '',
    baseUrl,
    presetId,
    detectedPresetId,
    detectionStatus: provider.detectionStatus ?? (provider.presetId ? 'manual' : 'detected'),
    capabilities: { ...preset.capabilities, ...provider.capabilities },
    syncPolicy: provider.syncPolicy ?? defaultProviderSyncPolicy(),
    enabled: provider.enabled ?? false,
    models,
    credentialMode: provider.type === 'xiaomi-mimo' ? provider.credentialMode ?? 'token-plan' : provider.credentialMode,
    tokenPlanRegion: provider.type === 'xiaomi-mimo' ? provider.tokenPlanRegion ?? 'cn' : provider.tokenPlanRegion,
    wireProtocol: provider.type === 'xiaomi-mimo' ? provider.wireProtocol ?? 'openai-compatible' : provider.wireProtocol,
    modelConfigs: models.map((modelId) => getModelConfig(modelId, provider.type, provider.modelConfigs)),
    lastTestStatus: provider.lastTestStatus ?? 'idle',
    lastModelSyncStatus: provider.lastModelSyncStatus ?? 'idle',
  } as AIProvider, presetId)
  return normalizeProviderCredentialGroups({
    ...normalized,
    apiKey: '',
    credentialGroups: sanitizeCredentialGroups(normalized.credentialGroups, normalized),
    modelAvailability: normalized.modelAvailability,
  })
}

function normalizeProviderBaseUrl(provider: AIProvider): string | undefined {
  const baseUrl = provider.baseUrl?.trim()
  if (provider.type !== 'xiaomi-mimo') return baseUrl || undefined

  const credentialMode = provider.credentialMode ?? 'token-plan'
  const tokenPlanRegion = provider.tokenPlanRegion ?? 'cn'
  const wireProtocol = provider.wireProtocol ?? 'openai-compatible'
  const officialBaseUrl = getXiaomiMimoOfficialBaseUrl(credentialMode, tokenPlanRegion, wireProtocol)
  const baseUrlLower = baseUrl?.toLowerCase()
  const knownOfficialUrls = new Set([
    XIAOMI_MIMO_PAYG_BASE_URL.toLowerCase(),
    getXiaomiMimoOfficialBaseUrl('token-plan', tokenPlanRegion, 'openai-compatible').toLowerCase(),
    getXiaomiMimoOfficialBaseUrl('token-plan', tokenPlanRegion, 'anthropic-compatible').toLowerCase(),
    getXiaomiMimoOfficialBaseUrl('payg', tokenPlanRegion, 'anthropic-compatible').toLowerCase(),
  ])

  if (!baseUrl) return officialBaseUrl
  if (baseUrlLower && knownOfficialUrls.has(baseUrlLower)) {
    return officialBaseUrl
  }
  return baseUrl
}

async function persistCredentialGroupKeys(providerId: string, groups: ProviderCredentialGroup[] | undefined): Promise<void> {
  await Promise.all((groups ?? []).map(async (group) => {
    if (!group.apiKey) return
    await SecureStore.setItemAsync(secureProviderGroupKey(providerId, group.id), group.apiKey)
  }))
}

async function clearProviderCatalogSecrets(providers: AIProvider[]): Promise<void> {
  const ids = new Set([...LEGACY_DEFAULT_PROVIDER_IDS, ...providers.map((provider) => provider.id)])
  await Promise.all([
    ...Array.from(ids).map((id) => SecureStore.deleteItemAsync(secureProviderKey(id))),
    ...providers.flatMap((provider) => (provider.credentialGroups ?? []).map((group) => SecureStore.deleteItemAsync(secureProviderGroupKey(provider.id, group.id)))),
  ])
}

function sanitizeCredentialGroups(groups: ProviderCredentialGroup[] | undefined, provider: AIProvider): ProviderCredentialGroup[] {
  return (groups ?? []).map((group, index) => ({
    ...group,
    id: group.id || `group-${index + 1}`,
    label: group.label || st('apiKeyPanel.groupName', { index: index + 1 }),
    apiKey: '',
    enabled: group.enabled ?? true,
    availableModels: group.availableModels?.length ? clearHistoricalInjectedGroupModels(group, provider) : [],
    failureCount: group.failureCount ?? 0,
  }))
}

function normalizeProviderModels(provider: AIProvider): string[] {
  const models = clearHistoricalInjectedProviderModels(provider)
  const existing = models.filter((model) => {
    const config = getModelConfig(model, provider.type, provider.modelConfigs)
    return !config.deprecated
  })
  const seen = new Set<string>()
  return existing.filter((model) => {
    if (seen.has(model)) return false
    seen.add(model)
    return true
  })
}
