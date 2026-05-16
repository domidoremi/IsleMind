import { create } from 'zustand'
import { DEFAULT_PROVIDERS, getDefaultProviderModelIds, getModelConfig, getProviderConfigIssue, getXiaomiMimoOfficialBaseUrl, XIAOMI_MIMO_PAYG_BASE_URL } from '@/types'
import type { Settings, AIProvider, Language, ThemeMode } from '@/types'
import { loadData, saveData } from '@/services/storage'
import * as SecureStore from 'expo-secure-store'

interface SettingsState {
  settings: Settings
  providers: AIProvider[]

  load: () => Promise<void>
  updateSettings: (updates: Partial<Settings>) => void
  setTheme: (theme: ThemeMode) => void
  setLanguage: (language: Language) => void
  addProvider: (provider: AIProvider) => Promise<void>
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  removeProvider: (id: string) => Promise<void>
  setProviderApiKey: (id: string, apiKey: string) => Promise<void>
  getSecureApiKey: (id: string) => Promise<string | null>
  setTavilyApiKey: (apiKey: string) => Promise<void>
  getTavilyApiKey: () => Promise<string | null>
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
  webSearchEnabled: false,
  webSearchMode: 'native',
  knowledgeTopK: 4,
  memoryTopK: 4,
  onboardingCompleted: false,
  ragMode: 'hybrid',
  embeddingMode: 'hybrid',
}

function secureProviderKey(id: string): string {
  return `islemind.key.${id.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

const TAVILY_KEY = 'islemind.key.tavily'

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  providers: DEFAULT_PROVIDERS,

  load: async () => {
    const [settings, providers] = await Promise.all([
      loadData<Settings>('SETTINGS'),
      loadData<AIProvider[]>('PROVIDERS'),
    ])
    const mergedSettings = settings ? { ...defaultSettings, ...settings } : defaultSettings
    const mergedProviders = mergeProviders(providers ?? [])
    const defaultProvider = mergedProviders.some((provider) => provider.id === mergedSettings.defaultProvider)
      ? mergedSettings.defaultProvider
      : null
    set({
      settings: { ...mergedSettings, defaultProvider },
      providers: mergedProviders,
    })
  },

  updateSettings: (updates: Partial<Settings>) => {
    set((state) => {
      const updated = { ...state.settings, ...updates }
      saveData('SETTINGS', updated)
      return { settings: updated }
    })
  },

  setTheme: (theme: ThemeMode) => {
    get().updateSettings({ theme })
  },

  setLanguage: (language: Language) => {
    get().updateSettings({ language })
  },

  addProvider: async (provider: AIProvider) => {
    if (provider.apiKey) {
      await SecureStore.setItemAsync(secureProviderKey(provider.id), provider.apiKey)
    }
    set((state) => {
      const updated = [...state.providers, normalizeProvider({ ...provider, apiKey: '' } as AIProvider)]
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
    set((state) => {
      const updated = state.providers.map((p) =>
        p.id === id ? normalizeProvider({ ...p, ...updates, apiKey: '' } as AIProvider) : p
      )
      saveData('PROVIDERS', updated)
      return { providers: updated }
    })
  },

  removeProvider: async (id: string) => {
    await SecureStore.deleteItemAsync(secureProviderKey(id))
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

  hydrateProviderKey: async (id: string) => {
    const provider = get().providers.find((item) => item.id === id)
    if (!provider) return null
    const apiKey = await SecureStore.getItemAsync(secureProviderKey(id))
    return { ...provider, apiKey: apiKey ?? '' }
  },

  getConfiguredProviders: async () => {
    const hydrated = await Promise.all(get().providers.map((provider) => get().hydrateProviderKey(provider.id)))
    return hydrated.filter((provider): provider is AIProvider => {
      if (!provider?.enabled) return false
      if (!provider.apiKey.trim()) return false
      if (!provider.models.length) return false
      return !getProviderConfigIssue(provider, provider.apiKey)
    })
  },

  getPrimaryConfiguredProvider: async () => {
    const configured = await get().getConfiguredProviders()
    const defaultProvider = get().settings.defaultProvider
    return configured.find((provider) => provider.id === defaultProvider) ?? configured[0] ?? null
  },

  clearAll: async () => {
    const resetSettings = { ...defaultSettings, defaultProvider: null, onboardingCompleted: false }
    await Promise.all([
      ...DEFAULT_PROVIDERS.map((provider) => SecureStore.deleteItemAsync(secureProviderKey(provider.id))),
      SecureStore.deleteItemAsync(TAVILY_KEY),
    ])
    saveData('SETTINGS', resetSettings)
    const resetProviders = DEFAULT_PROVIDERS.map((provider) => ({ ...provider, enabled: false, apiKey: '' }))
    saveData('PROVIDERS', resetProviders)
    set({ settings: resetSettings, providers: resetProviders })
  },
}))

function mergeProviders(saved: AIProvider[]): AIProvider[] {
  const byId = new Map<string, AIProvider>()
  for (const provider of DEFAULT_PROVIDERS) {
    byId.set(provider.id, provider)
  }
  for (const provider of saved) {
    const base = byId.get(provider.id)
    byId.set(provider.id, normalizeProvider({ ...base, ...provider, apiKey: '' } as AIProvider))
  }
  return Array.from(byId.values()).map(normalizeProvider)
}

function normalizeProvider(provider: AIProvider): AIProvider {
  const models = normalizeProviderModels(provider)
  const baseUrl = normalizeProviderBaseUrl(provider)
  return {
    ...provider,
    apiKey: '',
    baseUrl,
    enabled: provider.enabled ?? false,
    models,
    credentialMode: provider.type === 'xiaomi-mimo' ? provider.credentialMode ?? 'token-plan' : provider.credentialMode,
    tokenPlanRegion: provider.type === 'xiaomi-mimo' ? provider.tokenPlanRegion ?? 'cn' : provider.tokenPlanRegion,
    wireProtocol: provider.type === 'xiaomi-mimo' ? provider.wireProtocol ?? 'openai-compatible' : provider.wireProtocol,
    modelConfigs: models.map((modelId) => getModelConfig(modelId, provider.type, provider.modelConfigs)),
    lastTestStatus: provider.lastTestStatus ?? 'idle',
    lastModelSyncStatus: provider.lastModelSyncStatus ?? 'idle',
  }
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

function normalizeProviderModels(provider: AIProvider): string[] {
  const defaultModels = provider.type === 'openai-compatible' && provider.id !== 'deepseek' ? [] : getDefaultProviderModelIds(provider.type)
  if (!provider.models.length) return defaultModels
  const defaultSet = new Set(defaultModels)
  const existing = provider.models.filter((model) => {
    const config = getModelConfig(model, provider.type, provider.modelConfigs)
    return !config.deprecated || defaultSet.has(model) || !defaultSet.size
  })
  const merged = [...defaultModels, ...existing]
  const seen = new Set<string>()
  return merged.filter((model) => {
    if (seen.has(model)) return false
    seen.add(model)
    return true
  })
}
