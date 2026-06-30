import type { AIModel, AIProvider, ModelAlias, ProviderCredentialGroup } from '@/types'
import { getModelConfig } from '@/types'
import { clearHistoricalInjectedGroupModels, clearHistoricalInjectedProviderModels } from '@/utils/providerModels'

export const PROVIDER_REMOTE_MODEL_STORAGE_LIMIT = 256
export const PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT = 256
export const PROVIDER_MODEL_CONFIG_STORAGE_LIMIT = 256
export const PROVIDER_MODEL_AVAILABILITY_INDEX_LIMIT = 512

export function pruneProviderModelsForStorage(provider: AIProvider): string[] {
  return limitModelIdsForStorage(
    clearHistoricalInjectedProviderModels(provider),
    providerPriorityModelIds(provider),
    PROVIDER_REMOTE_MODEL_STORAGE_LIMIT
  )
}

export function pruneCredentialGroupModelsForStorage(group: ProviderCredentialGroup, provider: AIProvider): string[] {
  return limitModelIdsForStorage(
    clearHistoricalInjectedGroupModels(group, provider),
    providerPriorityModelIds(provider),
    PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT
  )
}

export function buildProviderModelConfigsForStorage(
  provider: AIProvider,
  models: readonly string[],
  manualModels: readonly string[],
  modelAliases: readonly ModelAlias[]
): AIModel[] {
  const ids = limitModelIdsForStorage(
    [
      ...models,
      ...manualModels,
      ...modelAliases.map((item) => item.model),
    ],
    providerPriorityModelIds(provider, manualModels, modelAliases),
    PROVIDER_MODEL_CONFIG_STORAGE_LIMIT,
    true
  )
  return ids.map((modelId) => getModelConfig(modelId, provider.type, provider.modelConfigs))
}

export function hasOversizedProviderModelStorage(provider: AIProvider): boolean {
  if ((provider.models ?? []).length > PROVIDER_REMOTE_MODEL_STORAGE_LIMIT) return true
  if ((provider.modelConfigs ?? []).length > PROVIDER_MODEL_CONFIG_STORAGE_LIMIT) return true
  if ((provider.modelAvailability ?? []).length > PROVIDER_MODEL_AVAILABILITY_INDEX_LIMIT) return true
  return (provider.credentialGroups ?? []).some((group) =>
    (group.availableModels ?? []).length > PROVIDER_CREDENTIAL_GROUP_MODEL_STORAGE_LIMIT
  )
}

export function limitModelIdsForStorage(
  models: readonly string[],
  priorityModels: readonly (string | undefined)[] = [],
  limit: number,
  includePriorityOutsideSource = false
): string[] {
  const normalized = uniqueModelIds(models)
  const source = new Set(normalized)
  const ordered: string[] = []
  const orderedSet = new Set<string>()
  const normalizedLimit = normalizeLimit(limit)
  const push = (model: string | undefined) => {
    const value = model?.trim()
    if (!value) return
    if (!includePriorityOutsideSource && !source.has(value)) return
    if (orderedSet.has(value)) return
    ordered.push(value)
    orderedSet.add(value)
  }
  for (const model of priorityModels) push(model)
  for (const model of normalized) {
    if (ordered.length >= normalizedLimit) break
    push(model)
  }
  return ordered.slice(0, normalizedLimit)
}

function providerPriorityModelIds(
  provider: AIProvider,
  manualModels: readonly string[] = provider.manualModels ?? [],
  modelAliases: readonly ModelAlias[] = provider.modelAliases ?? []
): string[] {
  return uniqueModelIds([
    provider.lastTestModel,
    ...manualModels,
    ...modelAliases.map((item) => item.model),
  ].filter((model): model is string => !!model?.trim()))
}

function uniqueModelIds(models: readonly string[]): string[] {
  const seen = new Set<string>()
  return models
    .map((model) => model.trim())
    .filter((model) => {
      if (!model || seen.has(model)) return false
      seen.add(model)
      return true
    })
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return PROVIDER_REMOTE_MODEL_STORAGE_LIMIT
  return Math.max(1, Math.floor(limit))
}
