import { create } from 'zustand'
import { getModelConfig, getProviderConfigIssue, XIAOMI_MIMO_PAYG_BASE_URL, getXiaomiMimoOfficialBaseUrl, sanitizeProviderBaseUrl } from '@/types'
import type { Settings, AIProvider, Language, ProviderCredentialGroup, ThemeId, ThemeMode } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { deleteSecureItem, getSecureItem, setSecureItem } from '@/services/secureStorage'
import { applyProviderPreset, detectProviderPreset, getProviderPreset, normalizeProviderSyncPolicy } from '@/services/ai/providerRegistry'
import { normalizeProviderCredentialGroups } from '@/services/ai/providerCredentials'
import { legacySearchModeForProvider, resolveSearchProvider } from '@/services/searchPolicy'
import { clearHistoricalInjectedGroupModels, clearHistoricalInjectedProviderModels, getProviderPreferredModel, hasRemoteProviderModelEvidence, isProviderConversationReady, normalizeProviderModelAliases } from '@/utils/providerModels'
import { getPolicyPreferredProviderModel, providerHasPolicyAllowedModel } from '@/services/ai/policy/providerModelAccess'
import { st } from '@/i18n/service'
import { getSystemLanguage, setServiceLanguage } from '@/i18n/service'
import { clearLanguagePreferenceSource, loadLanguagePreferenceSource, resolveEffectiveLanguage, saveLanguagePreferenceSource } from '@/i18n/languagePreference'
import { normalizeThemeId } from '@/theme/colors'
import { sanitizeSettingsUrlFields } from '@/services/settingsUrlPolicy'
import { removeProviderHealthRecordsByProviderId, clearProviderHealthSnapshot } from '@/services/ai/providerHealthStore'
import { invalidateAllCompactStates, invalidateCompactStatesByProvider } from '@/services/ai/compact/compactStateStore'

interface SettingsState {
  settings: Settings
  providers: AIProvider[]

  load: () => Promise<void>
  updateSettings: (updates: Partial<Settings>) => void
  setTheme: (theme: ThemeMode) => void
  setThemeId: (themeId: ThemeId) => void
  setLanguage: (language: Language) => void
  addProvider: (provider: AIProvider) => Promise<void>
  addProviders: (providers: AIProvider[], options?: AddProvidersOptions) => Promise<void>
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  updateProviders: (ids: string[], updates: Partial<AIProvider>) => Promise<void>
  reorderProviders: (providerIds: string[]) => void
  removeProvider: (id: string) => Promise<void>
  clearAllProviders: () => Promise<void>
  listInvalidProviders: () => Promise<AIProvider[]>
  clearInvalidProviders: (ids?: string[]) => Promise<number>
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
  setObservabilitySinkApiKey: (apiKey: string) => Promise<void>
  getObservabilitySinkApiKey: () => Promise<string | null>
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  getConfiguredProviders: () => Promise<AIProvider[]>
  getPrimaryConfiguredProvider: () => Promise<AIProvider | null>
  clearAll: () => Promise<void>
}

interface AddProvidersProgress {
  completed: number
  total: number
  currentProviderName?: string
}

interface AddProvidersOptions {
  onProgress?: (progress: AddProvidersProgress) => void
  yieldEvery?: number
}

const defaultSettings: Settings = {
  theme: 'system',
  themeId: 'minimal',
  language: 'zh-CN',
  defaultProvider: null,
  fontSize: 16,
  hapticsEnabled: true,
  systemStatusNotificationsEnabled: false,
  defaultTemperature: undefined,
  defaultMaxTokens: undefined,
  memoryEnabled: true,
  knowledgeEnabled: true,
  webSearchEnabled: true,
  webSearchMode: 'native',
  knowledgeTopK: 4,
  memoryTopK: 4,
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
  agentWorkflowMaxSteps: 3,
  agentWorkflowMaxToolCallsPerStep: 1,
  agentWorkflowAllowReadOnlyTools: true,
  agentWorkflowAllowReadWriteTools: 'visible',
  agentWorkflowAllowDestructiveTools: 'confirm',
  agentWorkflowOutputCharLimit: 4800,
  transportMode: 'auto',
  remoteCompactMode: 'off',
  remoteCompactThreshold: 0.8,
  remoteCompactThresholdTokens: 200000,
  payloadPolicyMode: 'warn',
  proxyMode: 'off',
  proxyBaseUrl: '',
  observabilitySinkMode: 'off',
  observabilitySinkTarget: 'opentelemetry',
  observabilitySinkEndpointUrl: '',
  observabilitySinkApiKeyConfigured: false,
  observabilitySinkUserOptIn: false,
  observabilitySinkWorkspaceConsent: false,
  observabilitySinkDevelopmentOnly: false,
  observabilitySinkAllowRawPayloads: false,
  observabilitySinkAttributeLimit: 48,
  observabilitySinkAttributeStringLimit: 160,
  observabilitySinkHighFrequencyExportMode: 'coalesced',
  providerAllowlist: [],
  providerBlocklist: [],
  modelAllowlist: [],
  modelBlocklist: [],
  runtimeLogEnabled: false,
  runtimeLogMaxBytes: 1048576,
  sessionConcurrencyLimit: 1,
  sessionQueueTimeoutMs: 1500,
  sessionAffinityEnabled: false,
  sessionAffinityTtlMs: 30 * 60 * 1000,
  upstreamRequestTimeoutMs: 60000,
  upstreamMaxRetries: 1,
  upstreamCircuitBreakerEnabled: true,
  upstreamCircuitBreakerFailureThreshold: 3,
  upstreamCircuitBreakerCooldownMs: 60000,
  requestRectificationEnabled: false,
  anthropicThinkingSignatureRectificationEnabled: false,
  anthropicThinkingBudgetRectificationEnabled: false,
  bedrockRequestOptimizerEnabled: false,
  thinkingOptimizerEnabled: false,
  cacheInjectionEnabled: false,
  cacheTtl: 'default',
  modelTestModel: '',
  modelTestCheckParameters: false,
}

const PROVIDER_CATALOG_VERSION = 1
const OPTIONAL_SETTINGS_KEYS_WITHOUT_DEFAULT = [
  'googleSearchCx',
  'customSearchEndpoint',
  'lastApkUpdateCheckAt',
] as const satisfies readonly (keyof Settings)[]
const LEGACY_DEFAULT_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'xiaomi-mimo',
  'deepseek',
  'dashscope',
  'moonshot',
  'bigmodel',
  'minimax',
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
const OBSERVABILITY_SINK_API_KEY = 'islemind.key.observability-sink'

async function setSecureKey(key: string, value: string): Promise<void> {
  if (value) {
    await setSecureItem(key, value)
  } else {
    await deleteSecureItem(key)
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  providers: [],

  load: async () => {
    const [settings, providers, languageSource, observabilitySinkApiKey] = await Promise.all([
      loadData<Settings>('SETTINGS'),
      loadData<AIProvider[]>('PROVIDERS'),
      loadLanguagePreferenceSource(),
      getSecureItem(OBSERVABILITY_SINK_API_KEY),
    ])
    const storedSettings = stripLegacySettingsFields(settings ? { ...defaultSettings, ...settings } : defaultSettings)
    const rawSettings = sanitizeSettingsUrlFields(storedSettings)
    const effectiveLanguage = resolveEffectiveLanguage(rawSettings.language, languageSource, getSystemLanguage())
    const resolvedSearchProvider = resolveSearchProvider(rawSettings)
    const resetCatalog = (rawSettings.providerCatalogVersion ?? PROVIDER_CATALOG_VERSION) < PROVIDER_CATALOG_VERSION
    if (resetCatalog) {
      await clearProviderCatalogSecrets(providers ?? [])
    }
    const normalizedThemeId = normalizeThemeId(rawSettings.themeId)
    const observabilitySinkApiKeyConfigured = !!observabilitySinkApiKey?.trim()
    const mergedSettings = sanitizeSettingsUrlFields({
      ...rawSettings,
      language: effectiveLanguage,
      themeId: normalizedThemeId,
      providerCatalogVersion: PROVIDER_CATALOG_VERSION,
      defaultProvider: resetCatalog ? null : rawSettings.defaultProvider,
      observabilitySinkApiKeyConfigured,
      searchProvider: resolvedSearchProvider,
      webSearchMode: legacySearchModeForProvider(resolvedSearchProvider),
      webSearchEnabled: resolvedSearchProvider !== 'off',
    })
    const mergedProviders = resetCatalog ? [] : mergeProviders(providers ?? [])
    const defaultProvider = mergedProviders.some((provider) => provider.id === mergedSettings.defaultProvider)
      ? mergedSettings.defaultProvider
      : null
    set({
      settings: { ...mergedSettings, defaultProvider },
      providers: mergedProviders,
    })
    setServiceLanguage(effectiveLanguage)
    const themeIdMigrated = rawSettings.themeId !== normalizedThemeId
    const settingsUrlMigrated = rawSettings !== storedSettings
    const observabilitySecretStateMigrated = rawSettings.observabilitySinkApiKeyConfigured !== observabilitySinkApiKeyConfigured
    if (resetCatalog || themeIdMigrated || settingsUrlMigrated || observabilitySecretStateMigrated) {
      saveData('SETTINGS', { ...mergedSettings, defaultProvider: resetCatalog ? null : defaultProvider })
    }
    if (resetCatalog) {
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
      const updated = sanitizeSettingsUrlFields(nextSearchProvider
        ? {
            ...draft,
            searchProvider: nextSearchProvider,
            webSearchMode: legacySearchModeForProvider(nextSearchProvider),
            webSearchEnabled: nextSearchProvider !== 'off',
          }
        : draft)
      saveData('SETTINGS', updated)
      return { settings: updated }
    })
  },

  setTheme: (theme: ThemeMode) => {
    get().updateSettings({ theme })
  },

  setThemeId: (themeId: ThemeId) => {
    get().updateSettings({ themeId })
  },

  setLanguage: (language: Language) => {
    void saveLanguagePreferenceSource('user')
    setServiceLanguage(language)
    get().updateSettings({ language })
  },

  addProvider: async (provider: AIProvider) => {
    if (provider.apiKey) {
      await setSecureItem(secureProviderKey(provider.id), provider.apiKey)
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
      await setSecureItem(secureProviderKey(id), updates.apiKey)
    }
    if (updates.credentialGroups) {
      const previous = get().providers.find((provider) => provider.id === id)?.credentialGroups ?? []
      const nextIds = new Set(updates.credentialGroups.map((group) => group.id))
      await Promise.all(previous
        .filter((group) => !nextIds.has(group.id))
        .map((group) => deleteSecureItem(secureProviderGroupKey(id, group.id)))
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

  addProviders: async (providers: AIProvider[], options?: AddProvidersOptions) => {
    if (!providers.length) return
    const total = providers.length
    const yieldEvery = normalizeYieldEvery(options?.yieldEvery)
    options?.onProgress?.({ completed: 0, total })
    await yieldToUi()
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index]
      if (provider.apiKey) {
        await setSecureItem(secureProviderKey(provider.id), provider.apiKey)
      }
      await persistCredentialGroupKeys(provider.id, provider.credentialGroups, { shouldYield: true, yieldEvery })
      const completed = index + 1
      if (completed === 1 || completed === total || completed % yieldEvery === 0) {
        options?.onProgress?.({ completed, total, currentProviderName: provider.name })
      }
      if (completed === total || completed % yieldEvery === 0) {
        await yieldToUi()
      }
    }
    set((state) => {
      const normalized = providers.map((provider) => normalizeProvider({ ...provider, apiKey: '' } as AIProvider))
      const existingIds = new Set(normalized.map((provider) => provider.id))
      const updated = [...normalized, ...state.providers.filter((provider) => !existingIds.has(provider.id))]
      const defaultProvider = state.settings.defaultProvider ?? normalized[0]?.id ?? null
      const settings = sanitizeSettingsUrlFields({ ...state.settings, defaultProvider })
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
    const provider = get().providers.find((item) => item.id === id)
    if (provider) await clearProviderArtifacts(provider, 'provider_removed')
    set((state) => {
      const updated = state.providers.filter((p) => p.id !== id)
      const defaultProvider = updated.some((item) => item.id === state.settings.defaultProvider)
        ? state.settings.defaultProvider
        : updated[0]?.id ?? null
      const settings = sanitizeSettingsUrlFields(defaultProvider === state.settings.defaultProvider
        ? state.settings
        : { ...state.settings, defaultProvider })
      saveData('PROVIDERS', updated)
      saveData('SETTINGS', settings)
      return {
        providers: updated,
        settings,
      }
    })
  },

  clearAllProviders: async () => {
    const allProviders = get().providers
    await Promise.all(allProviders.map(async (provider) => {
      await deleteSecureItem(secureProviderKey(provider.id))
      await Promise.all((provider.credentialGroups ?? []).map((group) => deleteSecureItem(secureProviderGroupKey(provider.id, group.id))))
    }).concat([clearProviderRuntimeState()]))
    set((state) => {
      const settings = sanitizeSettingsUrlFields({ ...state.settings, defaultProvider: null })
      saveData('PROVIDERS', [])
      saveData('SETTINGS', settings)
      return {
        providers: [],
        settings,
      }
    })
  },

  listInvalidProviders: async () => {
    return collectInvalidProviders(get().providers, (provider) => get().hydrateProviderKey(provider.id))
  },

  clearInvalidProviders: async (ids?: string[]) => {
    if (ids && !ids.length) return 0
    const targetIds = ids ? new Set(ids) : null
    const candidates = targetIds
      ? get().providers.filter((provider) => targetIds.has(provider.id))
      : get().providers
    const invalidProviders = await collectInvalidProviders(candidates, (provider) => get().hydrateProviderKey(provider.id))
    if (!invalidProviders.length) return 0

    const invalidIds = new Set(invalidProviders.map((provider) => provider.id))
    for (const provider of invalidProviders) {
      await clearProviderArtifacts(provider, 'invalid_provider_cleared')
    }
    set((state) => {
      const updated = state.providers.filter((provider) => !invalidIds.has(provider.id))
      const defaultProvider = updated.some((item) => item.id === state.settings.defaultProvider)
        ? state.settings.defaultProvider
        : updated[0]?.id ?? null
      const settings = sanitizeSettingsUrlFields(defaultProvider === state.settings.defaultProvider
        ? state.settings
        : { ...state.settings, defaultProvider })
      saveData('PROVIDERS', updated)
      saveData('SETTINGS', settings)
      return { providers: updated, settings }
    })
    return invalidProviders.length
  },

  setProviderApiKey: async (id: string, apiKey: string) => {
    if (apiKey) {
      await setSecureItem(secureProviderKey(id), apiKey)
    } else {
      await deleteSecureItem(secureProviderKey(id))
    }
  },

  getSecureApiKey: async (id: string) => {
    return getSecureItem(secureProviderKey(id))
  },

  setProviderCredentialGroupKey: async (providerId: string, groupId: string, apiKey: string) => {
    if (apiKey) {
      await setSecureItem(secureProviderGroupKey(providerId, groupId), apiKey)
    } else {
      await deleteSecureItem(secureProviderGroupKey(providerId, groupId))
    }
  },

  getProviderCredentialGroupKey: async (providerId: string, groupId: string) => {
    return getSecureItem(secureProviderGroupKey(providerId, groupId))
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
      await setSecureItem(TAVILY_KEY, apiKey)
    } else {
      await deleteSecureItem(TAVILY_KEY)
    }
  },

  getTavilyApiKey: async () => {
    return getSecureItem(TAVILY_KEY)
  },

  setGoogleSearchApiKey: async (apiKey: string) => setSecureKey(GOOGLE_SEARCH_KEY, apiKey),
  getGoogleSearchApiKey: async () => getSecureItem(GOOGLE_SEARCH_KEY),
  setBingSearchApiKey: async (apiKey: string) => setSecureKey(BING_SEARCH_KEY, apiKey),
  getBingSearchApiKey: async () => getSecureItem(BING_SEARCH_KEY),
  setCustomSearchApiKey: async (apiKey: string) => setSecureKey(CUSTOM_SEARCH_KEY, apiKey),
  getCustomSearchApiKey: async () => getSecureItem(CUSTOM_SEARCH_KEY),
  setObservabilitySinkApiKey: async (apiKey: string) => {
    const trimmed = apiKey.trim()
    await setSecureKey(OBSERVABILITY_SINK_API_KEY, trimmed)
    const stored = await getSecureItem(OBSERVABILITY_SINK_API_KEY)
    get().updateSettings({ observabilitySinkApiKeyConfigured: !!stored?.trim() })
  },
  getObservabilitySinkApiKey: async () => getSecureItem(OBSERVABILITY_SINK_API_KEY),

  hydrateProviderKey: async (id: string) => {
    const provider = get().providers.find((item) => item.id === id)
    if (!provider) return null
    const apiKey = await getSecureItem(secureProviderKey(id))
    const credentialGroups = await Promise.all((provider.credentialGroups ?? []).map(async (group) => ({
      ...group,
      apiKey: await getSecureItem(secureProviderGroupKey(id, group.id)) ?? group.apiKey ?? '',
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
      if (!providerHasPolicyAllowedModel(provider, get().settings)) return false
      if (!getPolicyPreferredProviderModel(provider, get().settings)) return false
      return !getProviderConfigIssue(provider, provider.apiKey)
    })
  },

  getPrimaryConfiguredProvider: async () => {
    const configured = await get().getConfiguredProviders()
    const defaultProvider = get().settings.defaultProvider
    return configured.find((provider) => provider.id === defaultProvider) ?? configured[0] ?? null
  },

  clearAll: async () => {
    const resetLanguage = resolveEffectiveLanguage(undefined, 'system', getSystemLanguage())
    const resetSettings = sanitizeSettingsUrlFields({ ...defaultSettings, language: resetLanguage, defaultProvider: null, providerCatalogVersion: PROVIDER_CATALOG_VERSION })
    const providers = get().providers
    const providerIds = new Set([...LEGACY_DEFAULT_PROVIDER_IDS, ...providers.map((provider) => provider.id)])
    await Promise.all([
      ...Array.from(providerIds).map((id) => deleteSecureItem(secureProviderKey(id))),
      deleteSecureItem(TAVILY_KEY),
      deleteSecureItem(GOOGLE_SEARCH_KEY),
      deleteSecureItem(BING_SEARCH_KEY),
      deleteSecureItem(CUSTOM_SEARCH_KEY),
      deleteSecureItem(OBSERVABILITY_SINK_API_KEY),
      ...providers.flatMap((provider) => (provider.credentialGroups ?? []).map((group) => deleteSecureItem(secureProviderGroupKey(provider.id, group.id)))),
      clearProviderRuntimeState(),
      clearLanguagePreferenceSource(),
    ])
    setServiceLanguage(resetLanguage)
    saveData('SETTINGS', resetSettings)
    const resetProviders: AIProvider[] = []
    saveData('PROVIDERS', resetProviders)
    set({ settings: resetSettings, providers: resetProviders })
  },
}))

function mergeProviders(saved: AIProvider[]): AIProvider[] {
  return saved.map((provider) => normalizeProvider({ ...provider, apiKey: '' } as AIProvider))
}

function stripLegacySettingsFields(settings: Settings): Settings {
  const currentSettings: Settings & Partial<Record<string, unknown>> = { ...settings }
  const currentKeys = new Set<string>([
    ...Object.keys(defaultSettings),
    ...OPTIONAL_SETTINGS_KEYS_WITHOUT_DEFAULT,
  ])
  for (const key of Object.keys(currentSettings)) {
    if (!currentKeys.has(key)) delete currentSettings[key]
  }
  return currentSettings
}

function normalizeProvider(provider: AIProvider): AIProvider {
  const models = normalizeProviderModels(provider)
  const manualModels = normalizeProviderManualModels(provider, models)
  const modelAliases = normalizeProviderModelAliases(provider)
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
    syncPolicy: normalizeProviderSyncPolicy(provider.syncPolicy),
    enabled: provider.enabled ?? false,
    models,
    manualModels,
    modelAliases,
    credentialMode: provider.type === 'xiaomi-mimo' ? provider.credentialMode ?? 'token-plan' : provider.credentialMode,
    tokenPlanRegion: provider.type === 'xiaomi-mimo' ? provider.tokenPlanRegion ?? 'cn' : provider.tokenPlanRegion,
    wireProtocol: provider.type === 'xiaomi-mimo' ? provider.wireProtocol ?? 'openai-compatible' : provider.wireProtocol,
    modelConfigs: uniqueStrings([...models, ...manualModels, ...modelAliases.map((item) => item.model)]).map((modelId) => getModelConfig(modelId, provider.type, provider.modelConfigs)),
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
  const baseUrl = sanitizeProviderBaseUrl(provider.baseUrl)
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

async function persistCredentialGroupKeys(
  providerId: string,
  groups: ProviderCredentialGroup[] | undefined,
  options?: { shouldYield?: boolean; yieldEvery?: number }
): Promise<void> {
  if (!options?.shouldYield) {
    await Promise.all((groups ?? []).map(async (group) => {
      if (!group.apiKey) return
      await setSecureItem(secureProviderGroupKey(providerId, group.id), group.apiKey)
    }))
    return
  }
  const yieldEvery = normalizeYieldEvery(options.yieldEvery)
  const groupsWithKeys = (groups ?? []).filter((group) => !!group.apiKey)
  for (let index = 0; index < groupsWithKeys.length; index += 1) {
    const group = groupsWithKeys[index]
    if (!group.apiKey) continue
    await setSecureItem(secureProviderGroupKey(providerId, group.id), group.apiKey)
    const completed = index + 1
    if (completed === groupsWithKeys.length || completed % yieldEvery === 0) {
      await yieldToUi()
    }
  }
}

function normalizeYieldEvery(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 8))
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function collectInvalidProviders(
  providers: AIProvider[],
  hydrateProvider: (provider: AIProvider) => Promise<AIProvider | null>
): Promise<AIProvider[]> {
  const entries = await Promise.all(providers.map(async (provider) => ({
    stored: provider,
    hydrated: await hydrateProvider(provider) ?? provider,
  })))
  return entries
    .filter(({ hydrated }) => isInvalidProviderConfiguration(hydrated))
    .map(({ stored }) => stored)
}

async function clearProviderCatalogSecrets(providers: AIProvider[]): Promise<void> {
  const ids = new Set([...LEGACY_DEFAULT_PROVIDER_IDS, ...providers.map((provider) => provider.id)])
  await Promise.all([
    ...Array.from(ids).map((id) => deleteSecureItem(secureProviderKey(id))),
    ...providers.flatMap((provider) => (provider.credentialGroups ?? []).map((group) => deleteSecureItem(secureProviderGroupKey(provider.id, group.id)))),
  ])
}

async function clearProviderArtifacts(provider: AIProvider, reason: string): Promise<void> {
  await Promise.all([
    deleteSecureItem(secureProviderKey(provider.id)),
    ...(provider.credentialGroups ?? []).map((group) => deleteSecureItem(secureProviderGroupKey(provider.id, group.id))),
    removeProviderHealthRecordsByProviderId(provider.id),
    invalidateCompactStatesByProvider(provider.id, reason),
  ])
}

async function clearProviderRuntimeState(): Promise<void> {
  await Promise.all([
    clearProviderHealthSnapshot(),
    invalidateAllCompactStates('providers_cleared'),
  ])
}

function isInvalidProviderConfiguration(provider: AIProvider): boolean {
  const credential = providerPrimaryCredential(provider)
  if (!credential) return true
  return !!getProviderConfigIssue(provider, credential)
}

function providerPrimaryCredential(provider: AIProvider): string {
  return provider.apiKey.trim() || provider.credentialGroups?.find((group) => group.apiKey?.trim())?.apiKey?.trim() || ''
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

function normalizeProviderManualModels(provider: AIProvider, normalizedModels: string[]): string[] {
  const source = Array.isArray(provider.manualModels) ? provider.manualModels : hasRemoteProviderModelEvidence(provider) ? [] : normalizedModels
  const cleaned = clearHistoricalInjectedProviderModels({ ...provider, models: source })
  return uniqueStrings(cleaned.filter((model) => !getModelConfig(model, provider.type, provider.modelConfigs).deprecated))
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false
      seen.add(value)
      return true
    })
}
