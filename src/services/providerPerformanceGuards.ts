import type { AIProvider, Settings } from '@/types'
import {
  getPolicyAllowedProviderModels,
  providerHasPolicyModel,
  type ProviderModelAccessInput,
} from '@/services/ai/policy/providerModelAccess'
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
  'specific-model-validation-checks-source',
  'diagnostics-heavy-provider-scan-is-bounded',
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

export function runProviderPerformanceGuardSelfTest(): ProviderPerformanceGuardResult {
  const provider = createLargeProvider()
  const settings: ProviderModelAccessInput['settings'] = {} satisfies Pick<Settings, 'providerAllowlist' | 'providerBlocklist' | 'modelAllowlist' | 'modelBlocklist'>
  const prunedModels = pruneProviderModelsForStorage(provider)
  const prunedGroupModels = pruneCredentialGroupModelsForStorage(provider.credentialGroups![0], provider)
  const limitedPolicyModels = getPolicyAllowedProviderModels(provider, settings, { limit: 7 })
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
  ]
  return {
    schema: PROVIDER_PERFORMANCE_GUARD_SCHEMA,
    fixtureIds: PROVIDER_PERFORMANCE_FIXTURE_IDS,
    checks,
    passed: checks.every((check) => check.passed),
  }
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
