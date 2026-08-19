import { create } from 'zustand'
import { AppState } from 'react-native'
import { getModelConfig } from '@/types/modelCatalog'
import { getProviderConfigIssue, XIAOMI_MIMO_PAYG_BASE_URL, getXiaomiMimoOfficialBaseUrl, sanitizeProviderBaseUrl } from '@/types/providerBaseUrls'
import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'
import type { Settings, Language, ThemeId, ThemeMode } from '@/types/settingsContracts'
import {
  loadPersistedProviderMetadata,
  loadPersistedSettings,
  flushPersistedSettings,
  savePersistedProviderMetadata,
  savePersistedSettings,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import {
  OBSERVABILITY_SINK_API_KEY,
  providerCredentialStorage,
  secureKeyValueStorage,
} from '@/bootstrap/secureCredentialStorage'
import { applyProviderPreset, detectProviderPreset, getProviderPreset, normalizeProviderSyncPolicy } from '@/bootstrap/providerRegistry'
import { normalizeProviderClientCompatibilityMode, normalizeProviderCredentialGroups, normalizeProviderPresetId, normalizeProviderPresetSelection, sanitizeProviderUsageQueryConfiguration, type ProviderCredentialMutation } from '@/modules/providers'
import { legacySearchModeForProvider, resolveSearchProvider } from '@/modules/integrations'
import { clearHistoricalInjectedProviderModels, getProviderPreferredModel, hasRemoteProviderModelEvidence, isProviderConversationReady, normalizeProviderModelAliases } from '@/utils/providerModels'
import { buildProviderModelConfigsForStorage, hasOversizedProviderModelStorage, pruneCredentialGroupModelsForStorage, pruneProviderModelsForStorage } from '@/utils/providerModelStorage'
import { getPolicyPreferredProviderModel, providerHasPolicyAllowedModel } from '@/bootstrap/providerModelAccess'
import { st } from '@/i18n/service'
import { getSystemLanguage, setServiceLanguage } from '@/i18n/service'
import { clearLanguagePreferenceSource, loadLanguagePreferenceSource, resolveEffectiveLanguage, saveLanguagePreferenceSource } from '@/i18n/languagePreference'
import { normalizeThemeId } from '@/theme/colors'
import { normalizeSettingsIdentityPreferences, normalizeSettingsThemeAccent, normalizeSettingsThemeFamily, normalizeSettingsThemeMode, sanitizeSettingsUrlFields } from '@/modules/settings'
import { removeProviderHealthRecordsByProviderId, clearProviderHealthSnapshot } from '@/bootstrap/providerHealthRepository'
import { invalidateAllCompactStates, invalidateCompactStatesByProvider } from '@/bootstrap/providerCompactStateRepository'

interface SettingsState {
  settings: Settings
  providers: AIProvider[]

  load: () => Promise<void>
  updateSettings: (updates: Partial<Settings>) => void
  setTheme: (theme: ThemeMode) => void
  setThemeId: (themeId: ThemeId) => void
  setThemeAccent: (themeAccent: string | undefined) => void
  setLanguage: (language: Language) => void
  addProvider: (provider: AIProvider) => Promise<void>
  addProviders: (providers: AIProvider[], options?: AddProvidersOptions) => Promise<void>
  updateProvider: (id: string, updates: Partial<AIProvider>, options?: ProviderUpdateOptions) => Promise<void>
  updateProviderPatches: (patches: ProviderPatch[], options?: ProviderUpdateOptions) => Promise<void>
  updateProviders: (ids: string[], updates: Partial<AIProvider>, options?: ProviderUpdateOptions) => Promise<void>
  flushProviderPersistence: () => Promise<void>
  compactProviderStorage: () => boolean
  reorderProviders: (providerIds: string[]) => void
  removeProvider: (id: string) => Promise<void>
  clearAllProviders: () => Promise<void>
  listInvalidProviders: () => Promise<AIProvider[]>
  clearInvalidProviders: (ids?: string[]) => Promise<number>
  setProviderApiKey: (id: string, apiKey: string) => Promise<void>
  getSecureApiKey: (id: string) => Promise<string | null>
  setProviderCredentialGroupKey: (providerId: string, groupId: string, apiKey: string) => Promise<void>
  getProviderCredentialGroupKey: (providerId: string, groupId: string) => Promise<string | null>
  updateProviderCredentialGroupHealth: (providerId: string, groupId: string | undefined, ok: boolean, options?: ProviderUpdateOptions) => Promise<void>
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
  persist?: 'immediate' | 'deferred'
}

interface ProviderUpdateOptions {
  persist?: 'immediate' | 'deferred'
}

interface ProviderPatch {
  id: string
  updates: Partial<AIProvider>
}

const defaultSettings: Settings = {
  theme: 'light',
  themeId: 'minimal',
  themeAccent: undefined,
  assistantDisplayName: undefined,
  modelDisplayAliases: undefined,
  language: 'zh-CN',
  defaultProvider: null,
  fontSize: 16,
  hapticsEnabled: true,
  systemStatusNotificationsEnabled: false,
  defaultTemperature: undefined,
  defaultMaxTokens: undefined,
  memoryEnabled: false,
  knowledgeEnabled: false,
  webSearchEnabled: true,
  webSearchMode: 'tavily',
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
  searchProvider: 'islemind',
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
  remoteCompactMode: 'auto',
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

const PROVIDER_PERSISTENCE_DEBOUNCE_MS = 900
let pendingProviderPersistenceSnapshot: AIProvider[] | null = null
let providerPersistenceTimer: ReturnType<typeof setTimeout> | null = null
let providerPersistenceQueue = Promise.resolve()
let latestProviderPersistence = Promise.resolve()

const TAVILY_KEY = 'islemind.key.tavily'
const GOOGLE_SEARCH_KEY = 'islemind.key.google-search'
const BING_SEARCH_KEY = 'islemind.key.bing-search'
const CUSTOM_SEARCH_KEY = 'islemind.key.custom-search'

async function setSecureKey(key: string, value: string): Promise<void> {
  if (value) {
    await secureKeyValueStorage.setItem(key, value)
  } else {
    await secureKeyValueStorage.removeItem(key)
  }
}

function persistSettingsSnapshot(settings: Settings): void {
  void savePersistedSettings(settings)
}

function persistProvidersSnapshot(providers: AIProvider[], mode: ProviderUpdateOptions['persist'] = 'immediate'): void {
  if (mode === 'deferred') {
    pendingProviderPersistenceSnapshot = providers
    if (providerPersistenceTimer) clearTimeout(providerPersistenceTimer)
    providerPersistenceTimer = setTimeout(() => {
      void flushPendingProviderPersistence().catch(() => undefined)
    }, PROVIDER_PERSISTENCE_DEBOUNCE_MS)
    return
  }
  if (providerPersistenceTimer) {
    clearTimeout(providerPersistenceTimer)
    providerPersistenceTimer = null
  }
  pendingProviderPersistenceSnapshot = null
  enqueueProviderPersistence(providers)
}

async function flushPendingProviderPersistence(snapshot?: AIProvider[]): Promise<void> {
  if (providerPersistenceTimer) {
    clearTimeout(providerPersistenceTimer)
    providerPersistenceTimer = null
  }
  const nextSnapshot = snapshot ?? pendingProviderPersistenceSnapshot
  pendingProviderPersistenceSnapshot = null
  if (nextSnapshot) {
    await enqueueProviderPersistence(nextSnapshot)
    return
  }
  await latestProviderPersistence
}

function enqueueProviderPersistence(providers: AIProvider[]): Promise<void> {
  const write = providerPersistenceQueue.then(() => savePersistedProviderMetadata(providers))
  providerPersistenceQueue = write.catch(() => undefined)
  latestProviderPersistence = write
  return write
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  providers: [],

  load: async () => {
    const [settings, providers, languageSource, observabilitySinkApiKey] = await Promise.all([
      loadPersistedSettings(),
      loadPersistedProviderMetadata(),
      loadLanguagePreferenceSource(),
      secureKeyValueStorage.getItem(OBSERVABILITY_SINK_API_KEY),
    ])
    const storedSettings = stripLegacySettingsFields(settings ? { ...defaultSettings, ...settings } : defaultSettings)
    const urlSettings = sanitizeSettingsUrlFields(storedSettings)
    const rawSettings = normalizeSettingsIdentityPreferences(urlSettings)
    const effectiveLanguage = resolveEffectiveLanguage(rawSettings.language, languageSource, getSystemLanguage())
    const resolvedSearchProvider = resolveSearchProvider(rawSettings)
    const resetCatalog = (rawSettings.providerCatalogVersion ?? PROVIDER_CATALOG_VERSION) < PROVIDER_CATALOG_VERSION
    const savedProviders = providers ? [...providers] : []
    if (resetCatalog) {
      await clearProviderCatalogSecrets(savedProviders)
    }
    const normalizedThemeId = normalizeThemeId(rawSettings.themeId)
    const normalizedThemeMode = normalizeSettingsThemeMode(rawSettings.theme) ?? defaultSettings.theme
    const normalizedThemeAccent = normalizeSettingsThemeAccent(rawSettings.themeAccent)
    const observabilitySinkApiKeyConfigured = !!observabilitySinkApiKey?.trim()
    const mergedSettings = sanitizeSettingsUrlFields({
      ...rawSettings,
      theme: normalizedThemeMode,
      language: effectiveLanguage,
      themeId: normalizedThemeId,
      themeAccent: normalizedThemeAccent,
      providerCatalogVersion: PROVIDER_CATALOG_VERSION,
      defaultProvider: resetCatalog ? null : rawSettings.defaultProvider,
      observabilitySinkApiKeyConfigured,
      searchProvider: resolvedSearchProvider,
      webSearchMode: legacySearchModeForProvider(resolvedSearchProvider),
      webSearchEnabled: resolvedSearchProvider !== 'off',
    })
    const mergedProviders = resetCatalog ? [] : mergeProviders(savedProviders)
    const providerIdentityMetadataMigrated = savedProviders.some((provider, index) => {
      const normalized = mergedProviders[index]
      return provider.presetId !== normalized?.presetId
        || provider.detectedPresetId !== normalized?.detectedPresetId
        || provider.wireProtocol !== normalized?.wireProtocol
    })
    const defaultProvider = mergedProviders.some((provider) => provider.id === mergedSettings.defaultProvider)
      ? mergedSettings.defaultProvider
      : null
    set({
      settings: { ...mergedSettings, defaultProvider },
      providers: mergedProviders,
    })
    setServiceLanguage(effectiveLanguage)
    const themeIdMigrated = rawSettings.themeId !== normalizedThemeId
    const themeModeMigrated = rawSettings.theme !== normalizedThemeMode
    const themeAccentMigrated = rawSettings.themeAccent !== normalizedThemeAccent
    const settingsUrlMigrated = urlSettings !== storedSettings
    const settingsIdentityMigrated = rawSettings !== urlSettings
    const observabilitySecretStateMigrated = rawSettings.observabilitySinkApiKeyConfigured !== observabilitySinkApiKeyConfigured
    if (resetCatalog || themeModeMigrated || themeIdMigrated || themeAccentMigrated || settingsUrlMigrated || settingsIdentityMigrated || observabilitySecretStateMigrated) {
      persistSettingsSnapshot({ ...mergedSettings, defaultProvider: resetCatalog ? null : defaultProvider })
    }
    if (resetCatalog) {
      persistProvidersSnapshot([])
    } else if (providerIdentityMetadataMigrated || savedProviders.some(hasOversizedProviderModelStorage)) {
      persistProvidersSnapshot(mergedProviders, 'deferred')
    }
  },

  updateSettings: (updates: Partial<Settings>) => {
    set((state) => {
      const hasThemeAccentUpdate = Object.prototype.hasOwnProperty.call(updates, 'themeAccent')
      const hasThemeModeUpdate = Object.prototype.hasOwnProperty.call(updates, 'theme')
      const hasThemeFamilyUpdate = Object.prototype.hasOwnProperty.call(updates, 'themeId')
      const draft = normalizeSettingsIdentityPreferences({
        ...state.settings,
        ...updates,
        ...(hasThemeModeUpdate ? { theme: normalizeSettingsThemeMode(updates.theme) ?? state.settings.theme } : {}),
        ...(hasThemeFamilyUpdate ? { themeId: normalizeSettingsThemeFamily(updates.themeId) ?? state.settings.themeId } : {}),
        ...(hasThemeAccentUpdate ? { themeAccent: normalizeSettingsThemeAccent(updates.themeAccent) } : {}),
      })
      const resolved = updates.searchProvider ?? (
        updates.webSearchMode || updates.webSearchEnabled !== undefined
          ? resolveSearchProvider(draft)
          : draft.searchProvider
      )
      const nextSearchProvider = updates.webSearchEnabled === true && resolved === 'off' ? 'islemind' : resolved
      const updated = sanitizeSettingsUrlFields(nextSearchProvider
        ? {
            ...draft,
            searchProvider: nextSearchProvider,
            webSearchMode: legacySearchModeForProvider(nextSearchProvider),
            webSearchEnabled: nextSearchProvider !== 'off',
          }
        : draft)
      persistSettingsSnapshot(updated)
      return { settings: updated }
    })
  },

  setTheme: (theme: ThemeMode) => {
    get().updateSettings({ theme })
  },

  setThemeId: (themeId: ThemeId) => {
    get().updateSettings({ themeId })
  },

  setThemeAccent: (themeAccent: string | undefined) => {
    get().updateSettings({ themeAccent: normalizeSettingsThemeAccent(themeAccent) })
  },

  setLanguage: (language: Language) => {
    void saveLanguagePreferenceSource('user')
    setServiceLanguage(language)
    get().updateSettings({ language })
  },

  addProvider: async (provider: AIProvider) => {
    await providerCredentialStorage.applyMutations(providerCredentialMutationsForAdd(provider))
    set((state) => {
      const updated = [normalizeProvider({ ...provider, apiKey: '' } as AIProvider), ...state.providers]
      persistProvidersSnapshot(updated)
      if (!state.settings.defaultProvider) {
        get().updateSettings({ defaultProvider: provider.id })
      }
      return { providers: updated }
    })
  },

  updateProvider: async (id: string, updates: Partial<AIProvider>, options?: ProviderUpdateOptions) => {
    const previous = get().providers.find((provider) => provider.id === id)
    await providerCredentialStorage.applyMutations(providerCredentialMutationsForUpdate(id, updates, previous))
    set((state) => {
      const updated = state.providers.map((p) =>
        p.id === id ? normalizeProvider({ ...p, ...updates, apiKey: '' } as AIProvider) : p
      )
      persistProvidersSnapshot(updated, options?.persist)
      return { providers: updated }
    })
  },

  updateProviderPatches: async (patches: ProviderPatch[], options?: ProviderUpdateOptions) => {
    const mergedPatches = new Map<string, Partial<AIProvider>>()
    for (const patch of patches) {
      if (!patch.id) continue
      mergedPatches.set(patch.id, { ...(mergedPatches.get(patch.id) ?? {}), ...patch.updates })
    }
    if (!mergedPatches.size) return

    const currentProviders = get().providers
    const credentialMutations: ProviderCredentialMutation[] = []
    for (const [id, updates] of mergedPatches) {
      credentialMutations.push(...providerCredentialMutationsForUpdate(
        id,
        updates,
        currentProviders.find((provider) => provider.id === id),
      ))
    }
    await providerCredentialStorage.applyMutations(credentialMutations)

    set((state) => {
      const updated = state.providers.map((provider) => {
        const updates = mergedPatches.get(provider.id)
        return updates ? normalizeProvider({ ...provider, ...updates, apiKey: '' } as AIProvider) : provider
      })
      persistProvidersSnapshot(updated, options?.persist)
      return { providers: updated }
    })
  },

  addProviders: async (providers: AIProvider[], options?: AddProvidersOptions) => {
    if (!providers.length) return
    const total = providers.length
    const yieldEvery = normalizeYieldEvery(options?.yieldEvery)
    options?.onProgress?.({ completed: 0, total })
    await yieldToUi()
    await providerCredentialStorage.applyMutations(
      providers.flatMap(providerCredentialMutationsForAdd),
    )
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index]
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
      persistProvidersSnapshot(updated, options?.persist)
      persistSettingsSnapshot(settings)
      return { providers: updated, settings }
    })
  },

  updateProviders: async (ids: string[], updates: Partial<AIProvider>, options?: ProviderUpdateOptions) => {
    const uniqueIds = Array.from(new Set(ids))
    if (!uniqueIds.length) return
    if (updates.apiKey || updates.credentialGroups) {
      await get().updateProviderPatches(
        uniqueIds.map((id) => ({ id, updates })),
        options,
      )
      return
    }
    const targetIds = new Set(uniqueIds)
    set((state) => {
      const updated = state.providers.map((provider) =>
        targetIds.has(provider.id) ? normalizeProvider({ ...provider, ...updates, apiKey: '' } as AIProvider) : provider
      )
      persistProvidersSnapshot(updated, options?.persist)
      return { providers: updated }
    })
  },

  flushProviderPersistence: async () => {
    await flushPendingProviderPersistence()
  },

  compactProviderStorage: () => {
    const current = get().providers
    if (!current.some(hasOversizedProviderModelStorage)) return false
    const updated = current.map((provider) => normalizeProvider(provider))
    set({ providers: updated })
    persistProvidersSnapshot(updated, 'deferred')
    return true
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
      persistProvidersSnapshot(updated)
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
      persistProvidersSnapshot(updated)
      persistSettingsSnapshot(settings)
      return {
        providers: updated,
        settings,
      }
    })
  },

  clearAllProviders: async () => {
    const allProviders = get().providers
    await providerCredentialStorage.applyMutations(
      allProviders.flatMap(providerCredentialDeletionMutations),
    )
    await clearProviderRuntimeState()
    set((state) => {
      const settings = sanitizeSettingsUrlFields({ ...state.settings, defaultProvider: null })
      persistProvidersSnapshot([])
      persistSettingsSnapshot(settings)
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
      persistProvidersSnapshot(updated)
      persistSettingsSnapshot(settings)
      return { providers: updated, settings }
    })
    return invalidProviders.length
  },

  setProviderApiKey: async (id: string, apiKey: string) => {
    if (apiKey) {
      await providerCredentialStorage.setProviderCredential(id, apiKey)
    } else {
      await providerCredentialStorage.deleteProviderCredential(id)
    }
  },

  getSecureApiKey: async (id: string) => {
    return providerCredentialStorage.getProviderCredential(id)
  },

  setProviderCredentialGroupKey: async (providerId: string, groupId: string, apiKey: string) => {
    if (apiKey) {
      await providerCredentialStorage.setCredentialGroupCredential(providerId, groupId, apiKey)
    } else {
      await providerCredentialStorage.deleteCredentialGroupCredential(providerId, groupId)
    }
  },

  getProviderCredentialGroupKey: async (providerId: string, groupId: string) => {
    return providerCredentialStorage.getCredentialGroupCredential(providerId, groupId)
  },

  updateProviderCredentialGroupHealth: async (providerId: string, groupId: string | undefined, ok: boolean, options?: ProviderUpdateOptions) => {
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
      persistProvidersSnapshot(updated, options?.persist)
      return { providers: updated }
    })
  },

  setTavilyApiKey: async (apiKey: string) => {
    await setSecureKey(TAVILY_KEY, apiKey)
  },

  getTavilyApiKey: async () => {
    return secureKeyValueStorage.getItem(TAVILY_KEY)
  },

  setGoogleSearchApiKey: async (apiKey: string) => setSecureKey(GOOGLE_SEARCH_KEY, apiKey),
  getGoogleSearchApiKey: async () => secureKeyValueStorage.getItem(GOOGLE_SEARCH_KEY),
  setBingSearchApiKey: async (apiKey: string) => setSecureKey(BING_SEARCH_KEY, apiKey),
  getBingSearchApiKey: async () => secureKeyValueStorage.getItem(BING_SEARCH_KEY),
  setCustomSearchApiKey: async (apiKey: string) => setSecureKey(CUSTOM_SEARCH_KEY, apiKey),
  getCustomSearchApiKey: async () => secureKeyValueStorage.getItem(CUSTOM_SEARCH_KEY),
  setObservabilitySinkApiKey: async (apiKey: string) => {
    const trimmed = apiKey.trim()
    await setSecureKey(OBSERVABILITY_SINK_API_KEY, trimmed)
    const stored = await secureKeyValueStorage.getItem(OBSERVABILITY_SINK_API_KEY)
    get().updateSettings({ observabilitySinkApiKeyConfigured: !!stored?.trim() })
    await flushPersistedSettings()
  },
  getObservabilitySinkApiKey: async () => secureKeyValueStorage.getItem(OBSERVABILITY_SINK_API_KEY),

  hydrateProviderKey: async (id: string) => {
    const provider = get().providers.find((item) => item.id === id)
    if (!provider) return null
    const apiKey = await providerCredentialStorage.getProviderCredential(id)
    const credentialGroups = await Promise.all((provider.credentialGroups ?? []).map(async (group) => ({
      ...group,
      apiKey: await providerCredentialStorage.getCredentialGroupCredential(id, group.id) ?? group.apiKey ?? '',
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
      providerCredentialStorage.applyMutations([
        ...Array.from(providerIds).map((providerId) => ({ providerId, credential: null })),
        ...providers.flatMap((provider) => (provider.credentialGroups ?? []).map((group) => ({
          providerId: provider.id,
          groupId: group.id,
          credential: null,
        }))),
      ]),
      secureKeyValueStorage.removeItem(TAVILY_KEY),
      secureKeyValueStorage.removeItem(GOOGLE_SEARCH_KEY),
      secureKeyValueStorage.removeItem(BING_SEARCH_KEY),
      secureKeyValueStorage.removeItem(CUSTOM_SEARCH_KEY),
      secureKeyValueStorage.removeItem(OBSERVABILITY_SINK_API_KEY),
      clearProviderRuntimeState(),
      clearLanguagePreferenceSource(),
    ])
    setServiceLanguage(resetLanguage)
    const resetProviders: AIProvider[] = []
    set({ settings: resetSettings, providers: resetProviders })
    await Promise.all([
      savePersistedSettings(resetSettings),
      flushPendingProviderPersistence(resetProviders),
    ])
  },
}))

function mergeProviders(saved: readonly AIProvider[]): AIProvider[] {
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
  const detected = provider.detectedPresetId
    ? { presetId: provider.detectedPresetId, wireProtocol: provider.wireProtocol }
    : detectProviderPreset({ baseUrl, apiKey: provider.apiKey, name: provider.name })
  const selection = normalizeProviderPresetSelection({
    presetId: provider.presetId ?? (provider.id === 'custom-openai' ? 'custom-endpoint' : detected.presetId),
    detectedPresetId: provider.detectedPresetId,
    baseUrl,
    wireProtocol: provider.wireProtocol ?? detected.wireProtocol,
  })
  const presetId = selection.presetId
  const detectedPresetId = provider.detectedPresetId ? normalizeProviderPresetId(provider.detectedPresetId) : detected.presetId
  const preset = getProviderPreset(presetId)
  const credentialGroups = sanitizeCredentialGroups(provider.credentialGroups, { ...provider, models, manualModels, modelAliases } as AIProvider)
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
    wireProtocol: presetId === 'custom-endpoint'
      ? selection.wireProtocol
      : provider.type === 'xiaomi-mimo'
        ? provider.wireProtocol ?? 'openai-compatible'
        : undefined,
    clientCompatibilityProfile: normalizeProviderClientCompatibilityMode(provider.clientCompatibilityProfile),
    usageQueryConfiguration: sanitizeProviderUsageQueryConfiguration(provider.usageQueryConfiguration),
    credentialGroups,
    modelConfigs: buildProviderModelConfigsForStorage({ ...provider, credentialGroups }, models, manualModels, modelAliases),
    lastTestStatus: provider.lastTestStatus ?? 'idle',
    lastModelSyncStatus: provider.lastModelSyncStatus ?? 'idle',
  } as AIProvider, presetId)
  return normalizeProviderCredentialGroups({
    ...normalized,
    apiKey: '',
    credentialGroups,
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

function providerCredentialMutationsForAdd(provider: AIProvider): ProviderCredentialMutation[] {
  return [
    ...(provider.apiKey ? [{ providerId: provider.id, credential: provider.apiKey }] : []),
    ...(provider.credentialGroups ?? [])
      .filter((group) => Boolean(group.apiKey))
      .map((group) => ({
        providerId: provider.id,
        groupId: group.id,
        credential: group.apiKey as string,
      })),
  ]
}

function providerCredentialMutationsForUpdate(
  providerId: string,
  updates: Partial<AIProvider>,
  previous: AIProvider | undefined,
): ProviderCredentialMutation[] {
  const mutations: ProviderCredentialMutation[] = []
  if (updates.apiKey) {
    mutations.push({ providerId, credential: updates.apiKey })
  }
  if (!updates.credentialGroups) return mutations

  const nextIds = new Set(updates.credentialGroups.map((group) => group.id))
  for (const group of previous?.credentialGroups ?? []) {
    if (!nextIds.has(group.id)) {
      mutations.push({ providerId, groupId: group.id, credential: null })
    }
  }
  for (const group of updates.credentialGroups) {
    if (group.apiKey) {
      mutations.push({ providerId, groupId: group.id, credential: group.apiKey })
    }
  }
  return mutations
}

function providerCredentialDeletionMutations(provider: AIProvider): ProviderCredentialMutation[] {
  return [
    { providerId: provider.id, credential: null },
    ...(provider.credentialGroups ?? []).map((group) => ({
      providerId: provider.id,
      groupId: group.id,
      credential: null,
    })),
  ]
}

function normalizeYieldEvery(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 8))
}

async function yieldToUi(): Promise<void> {
  if (AppState.currentState !== 'active') return
  await new Promise<void>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let appStateSubscription: { remove: () => void } | null = null
    const settle = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      appStateSubscription?.remove()
      resolve()
    }
    appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') settle()
    })
    timer = setTimeout(settle, 0)
  })
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
  await providerCredentialStorage.applyMutations([
    ...Array.from(ids).map((providerId) => ({ providerId, credential: null })),
    ...providers.flatMap((provider) => (provider.credentialGroups ?? []).map((group) => ({
      providerId: provider.id,
      groupId: group.id,
      credential: null,
    }))),
  ])
}

async function clearProviderArtifacts(provider: AIProvider, reason: string): Promise<void> {
  await providerCredentialStorage.applyMutations(providerCredentialDeletionMutations(provider))
  await Promise.all([
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
    availableModels: group.availableModels?.length ? pruneCredentialGroupModelsForStorage(group, provider) : [],
    failureCount: group.failureCount ?? 0,
  }))
}

function normalizeProviderModels(provider: AIProvider): string[] {
  const models = pruneProviderModelsForStorage(provider)
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
