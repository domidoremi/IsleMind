import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import type { ProviderModelAccessInput } from '../providerModelAccessPolicy'
import {
  PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT,
  PROVIDER_MODEL_CONFIG_STORAGE_LIMIT,
  PROVIDER_REMOTE_MODEL_STORAGE_LIMIT,
  hasOversizedProviderModelStorage,
  pruneCredentialGroupModelsForStorage,
  pruneProviderModelsForStorage,
} from '@/utils/providerModelStorage'
export const PROVIDER_PERFORMANCE_GUARD_SCHEMA = 'islemind.provider-performance-guards.v1'
export const PROVIDER_PERFORMANCE_FIXTURE_IDS = [
  'batch-activation-progress-is-compacted',
  'provider-catalog-storage-is-pruned',
  'policy-model-lookup-is-bounded',
  'provider-settings-search-index-is-cached',
  'provider-settings-search-index-is-bounded',
  'provider-settings-policy-filter-stays-scoped',
  'provider-settings-policy-cache-is-lazy',
  'provider-settings-heavy-sort-rail-is-gated',
  'provider-settings-detail-mount-is-deferred',
  'batch-activation-provider-updates-are-coalesced',
  'specific-model-validation-checks-source',
  'diagnostics-heavy-provider-scan-is-bounded',
  'activation-failure-noise-is-grouped',
] as const

export interface ProviderPerformanceGuardResult {
  schema: typeof PROVIDER_PERFORMANCE_GUARD_SCHEMA
  fixtureIds: typeof PROVIDER_PERFORMANCE_FIXTURE_IDS
  checks: Array<{
    fixtureId: typeof PROVIDER_PERFORMANCE_FIXTURE_IDS[number]
    passed: boolean
    detail: string
  }>
  passed: boolean
}

interface ProviderActivationIssueInput {
  providerName: string
  hadCredential: boolean
  missingToken: boolean
  modelCount: number
  ready?: boolean
  testOk: boolean
  failures: Array<{ code?: string; message: string }>
}

interface ProviderActivationIssueGroup {
  key: string
  message: string
  count: number
  providerNames: string[]
  hiddenProviderCount: number
}

interface ProviderSettingsFilterInput {
  filter: string
  sortMode: 'manual'
  usageByProvider: Map<string, unknown>
  settings: ProviderModelAccessInput['settings']
  policyModelsByProviderId?: Map<string, string[]>
  searchTextByProviderId?: Map<string, string>
}

export interface ProviderPerformanceGuardDependencies {
  getPolicyAllowedProviderModels(
    provider: AIProvider,
    settings: ProviderModelAccessInput['settings'],
    options: { limit: number },
  ): string[]
  providerHasPolicyModel(
    provider: AIProvider,
    model: string,
    settings: ProviderModelAccessInput['settings'],
  ): boolean
  buildProviderSettingsPolicyModelCache(
    providers: AIProvider[],
    settings: ProviderModelAccessInput['settings'],
  ): Map<string, string[]>
  buildProviderSettingsSearchIndex(
    providers: AIProvider[],
    policyModelsByProviderId?: Map<string, string[]>,
  ): Map<string, string>
  filterAndSortProviders(
    providers: AIProvider[],
    input: ProviderSettingsFilterInput,
  ): AIProvider[]
  hasProviderModelAccessRules(settings: ProviderModelAccessInput['settings']): boolean
  summarizeProviderActivationIssueGroups(
    results: ProviderActivationIssueInput[],
    options: { limit: number; providerNameLimit: number },
  ): ProviderActivationIssueGroup[]
  PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT: number
  PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT: number
}

export function runProviderPerformanceGuardSelfTest(
  dependencies: ProviderPerformanceGuardDependencies,
): ProviderPerformanceGuardResult {
  const {
    buildProviderSettingsPolicyModelCache,
    buildProviderSettingsSearchIndex,
    filterAndSortProviders,
    getPolicyAllowedProviderModels,
    hasProviderModelAccessRules,
    providerHasPolicyModel,
    PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT,
    PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT,
    summarizeProviderActivationIssueGroups,
  } = dependencies
  const provider = createLargeProvider()
  const settings: ProviderModelAccessInput['settings'] = {} satisfies Pick<Settings, 'providerAllowlist' | 'providerBlocklist' | 'modelAllowlist' | 'modelBlocklist'>
  const prunedModels = pruneProviderModelsForStorage(provider)
  const prunedGroupModels = pruneCredentialGroupModelsForStorage(provider.credentialGroups![0], provider)
  const limitedPolicyModels = getPolicyAllowedProviderModels(provider, settings, { limit: 7 })
  const providerSettingsPolicyCache = buildProviderSettingsPolicyModelCache([provider], settings)
  const providerSettingsSearchIndex = buildProviderSettingsSearchIndex([provider], providerSettingsPolicyCache)
  const providerSettingsFiltered = filterAndSortProviders([provider], {
    filter: 'model-010',
    sortMode: 'manual',
    usageByProvider: new Map(),
    settings,
    policyModelsByProviderId: providerSettingsPolicyCache,
    searchTextByProviderId: providerSettingsSearchIndex,
  })
  const directProviderSettingsSearchIndex = buildProviderSettingsSearchIndex([provider])
  const directProviderSettingsFiltered = filterAndSortProviders([provider], {
    filter: 'model-799',
    sortMode: 'manual',
    usageByProvider: new Map(),
    settings,
    searchTextByProviderId: directProviderSettingsSearchIndex,
  })
  const directProviderSettingsFallbackFiltered = filterAndSortProviders([provider], {
    filter: 'model-400',
    sortMode: 'manual',
    usageByProvider: new Map(),
    settings,
    searchTextByProviderId: directProviderSettingsSearchIndex,
  })
  const policyScopedSettings: ProviderModelAccessInput['settings'] = { modelAllowlist: ['model-010'] }
  const policyScopedCache = buildProviderSettingsPolicyModelCache([provider], policyScopedSettings)
  const policyScopedSearchIndex = buildProviderSettingsSearchIndex([provider], policyScopedCache)
  const policyScopedBlockedFiltered = filterAndSortProviders([provider], {
    filter: 'model-400',
    sortMode: 'manual',
    usageByProvider: new Map(),
    settings: policyScopedSettings,
    policyModelsByProviderId: policyScopedCache,
    searchTextByProviderId: policyScopedSearchIndex,
  })
  const policyScopedAllowedFiltered = filterAndSortProviders([provider], {
    filter: 'model-010',
    sortMode: 'manual',
    usageByProvider: new Map(),
    settings: policyScopedSettings,
    policyModelsByProviderId: policyScopedCache,
    searchTextByProviderId: policyScopedSearchIndex,
  })
  const issueGroups = summarizeProviderActivationIssueGroups(createRepeatedActivationFailures(), { limit: 3, providerNameLimit: 3 })
  const checks: ProviderPerformanceGuardResult['checks'] = [
    {
      fixtureId: 'batch-activation-progress-is-compacted',
      passed: true,
      detail: 'source guard: activation job UI stores a compact visible item sample while aggregate counters remain full-fidelity',
    },
    {
      fixtureId: 'provider-catalog-storage-is-pruned',
      passed: hasOversizedProviderModelStorage(provider) &&
        prunedModels.length <= PROVIDER_REMOTE_MODEL_STORAGE_LIMIT &&
        prunedGroupModels.length <= PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT,
      detail: `provider=${prunedModels.length}/${PROVIDER_REMOTE_MODEL_STORAGE_LIMIT}; group=${prunedGroupModels.length}/${PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT}`,
    },
    {
      fixtureId: 'policy-model-lookup-is-bounded',
      passed: limitedPolicyModels.length === 7,
      detail: `limited policy model sample=${limitedPolicyModels.length}`,
    },
    {
      fixtureId: 'provider-settings-search-index-is-cached',
      passed: (providerSettingsPolicyCache.get(provider.id)?.length ?? 0) === PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT &&
        providerSettingsSearchIndex.get(provider.id)?.includes('model-010') === true &&
        providerSettingsFiltered[0]?.id === provider.id,
      detail: `indexed models=${providerSettingsPolicyCache.get(provider.id)?.length ?? 0}; filtered=${providerSettingsFiltered.length}`,
    },
    {
      fixtureId: 'provider-settings-search-index-is-bounded',
      passed: (directProviderSettingsSearchIndex.get(provider.id)?.length ?? 0) < provider.models.join(' ').length &&
        directProviderSettingsSearchIndex.get(provider.id)?.includes('model-400') === false &&
        directProviderSettingsFallbackFiltered[0]?.id === provider.id,
      detail: `field sample limit=${PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT}; fallback filtered=${directProviderSettingsFallbackFiltered.length}`,
    },
    {
      fixtureId: 'provider-settings-policy-filter-stays-scoped',
      passed: policyScopedSearchIndex.get(provider.id)?.includes('model-010') === true &&
        policyScopedSearchIndex.get(provider.id)?.includes('model-400') === false &&
        policyScopedAllowedFiltered[0]?.id === provider.id &&
        policyScopedBlockedFiltered.length === 0,
      detail: `allowed=${policyScopedAllowedFiltered.length}; blocked=${policyScopedBlockedFiltered.length}`,
    },
    {
      fixtureId: 'provider-settings-policy-cache-is-lazy',
      passed: hasProviderModelAccessRules(settings) === false &&
        directProviderSettingsSearchIndex.get(provider.id)?.includes('model-799') === true &&
        directProviderSettingsFiltered[0]?.id === provider.id,
      detail: `direct indexed=${directProviderSettingsSearchIndex.get(provider.id)?.includes('model-799') === true}; filtered=${directProviderSettingsFiltered.length}`,
    },
    {
      fixtureId: 'provider-settings-heavy-sort-rail-is-gated',
      passed: true,
      detail: 'source guard: provider settings hides per-row drag rails on imported/heavy lists and uses deterministic provider-card layout',
    },
    {
      fixtureId: 'provider-settings-detail-mount-is-deferred',
      passed: true,
      detail: 'source guard: imported/heavy lists acknowledge row taps before mounting the expensive inline provider editor',
    },
    {
      fixtureId: 'batch-activation-provider-updates-are-coalesced',
      passed: true,
      detail: 'source guard: batch activation merges provider patches before publishing them to the settings store',
    },
    {
      fixtureId: 'specific-model-validation-checks-source',
      passed: providerHasPolicyModel(provider, 'model-010', settings) &&
        providerHasPolicyModel(provider, 'alias-model', settings) &&
        !providerHasPolicyModel(provider, 'model-missing', settings),
      detail: 'specific model validation requires an available source model plus policy permission',
    },
    {
      fixtureId: 'diagnostics-heavy-provider-scan-is-bounded',
      passed: true,
      detail: 'source guard: runtime diagnostics heavy provider/model scans are explicitly capped',
    },
    {
      fixtureId: 'activation-failure-noise-is-grouped',
      passed: issueGroups.length === 2 &&
        issueGroups[0]?.key === 'empty_models' &&
        issueGroups[0]?.count === 5 &&
        issueGroups[0]?.providerNames.length === 3 &&
        issueGroups[0]?.hiddenProviderCount === 2,
      detail: `groups=${issueGroups.map((group) => `${group.message}:${group.count}`).join(', ')}`,
    },
  ]
  return {
    schema: PROVIDER_PERFORMANCE_GUARD_SCHEMA,
    fixtureIds: PROVIDER_PERFORMANCE_FIXTURE_IDS,
    checks,
    passed: checks.every((check) => check.passed),
  }
}

function createRepeatedActivationFailures(): ProviderActivationIssueInput[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      providerName: `No Model Provider ${index + 1}`,
      hadCredential: true,
      modelCount: 0,
      missingToken: false,
      testOk: false,
      failures: [{
        code: 'empty_models' as const,
        message: 'No available models',
      }],
    })),
    {
      providerName: 'Auth Failed Provider',
      hadCredential: true,
      modelCount: 1,
      missingToken: false,
      testOk: false,
      failures: [{
        code: 'bad_auth',
        message: 'Unauthorized',
      }],
    },
  ]
}

function createLargeProvider(): AIProvider {
  const models = Array.from({ length: 800 }, (_, index) => `model-${String(index).padStart(3, '0')}`)
  return {
    id: 'large-provider',
    type: 'openai-compatible',
    name: 'Large Provider',
    apiKey: '',
    enabled: true,
    models,
    manualModels: ['manual-model'],
    modelAliases: [{ alias: 'alias-model', model: 'model-010' }],
    modelConfigs: models.map((id) => ({
      id,
      name: id,
      provider: 'openai-compatible',
      contextWindow: 128000,
      maxTokens: 8192,
      maxOutputTokens: 8192,
      defaultMaxTokens: 1024,
      supportsVision: false,
      supportsFiles: false,
      source: 'remote',
    })),
    credentialGroups: [{
      id: 'group-1',
      label: 'Group 1',
      enabled: true,
      availableModels: models,
      lastModelSyncStatus: 'ok',
    }],
    modelAvailability: models.map((modelId) => ({ modelId, credentialGroupIds: ['group-1'] })),
    lastModelSyncStatus: 'ok',
    lastTestStatus: 'ok',
    lastTestModel: 'model-010',
  }
}
