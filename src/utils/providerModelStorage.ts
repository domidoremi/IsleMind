import type { AIModel, AIProvider, ModelAlias, ProviderCredentialGroup } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import { clearHistoricalInjectedGroupModels, clearHistoricalInjectedProviderModels } from '@/utils/providerModels'
// Catalogs are persisted in full. Presentation samples and pages bound rendering,
// while deduplication reduces redundant storage without removing selectable IDs.
export function normalizeProviderModelsForStorage(provider: AIProvider): string[] {
  return orderModelIdsForStorage(
    clearHistoricalInjectedProviderModels(provider),
    providerPriorityModelIds(provider),
  )
}

export function normalizeCredentialGroupModelsForStorage(group: ProviderCredentialGroup, provider: AIProvider): string[] {
  return orderModelIdsForStorage(
    clearHistoricalInjectedGroupModels(group, provider),
    providerPriorityModelIds(provider),
  )
}

export function buildProviderModelConfigsForStorage(
  provider: AIProvider,
  models: readonly string[],
  manualModels: readonly string[],
  modelAliases: readonly ModelAlias[]
): AIModel[] {
  const ids = orderModelIdsForStorage(
    [
      ...models,
      ...(provider.credentialGroups ?? []).flatMap(group => group.availableModels ?? []),
      ...manualModels,
      ...modelAliases.map((item) => item.model),
      ...(provider.modelConfigs ?? []).map((item) => item.id),
    ],
    providerPriorityModelIds(provider, manualModels, modelAliases),
    true
  )
  const configsById = new Map<string, AIModel>()
  for (const config of provider.modelConfigs ?? []) {
    const id = config.id.trim()
    if (id && !configsById.has(id)) configsById.set(id, config)
  }
  return ids.map((modelId) => {
    const config = configsById.get(modelId)
    return getModelConfig(modelId, provider.type, config ? [{ ...config, id: modelId }] : [])
  })
}

export function hasRedundantProviderModelStorage(provider: AIProvider): boolean {
  const redundant = (ids: readonly string[]) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (!id.trim() || id !== id.trim() || seen.has(id)) return true
      seen.add(id)
    }
    return false
  }
  return redundant(provider.models ?? [])
    || redundant((provider.modelConfigs ?? []).map(model => model.id))
    || redundant((provider.modelAvailability ?? []).map(model => model.modelId))
    || (provider.credentialGroups ?? []).some(group => redundant(group.availableModels ?? []))
}

function orderModelIdsForStorage(
  models: readonly string[],
  priorityModels: readonly (string | undefined)[] = [],
  includePriorityOutsideSource = false
): string[] {
  const normalized = uniqueModelIds(models)
  const source = new Set(normalized)
  const ordered: string[] = []
  const orderedSet = new Set<string>()
  const push = (model: string | undefined) => {
    const value = model?.trim()
    if (!value) return
    if (!includePriorityOutsideSource && !source.has(value)) return
    if (orderedSet.has(value)) return
    ordered.push(value)
    orderedSet.add(value)
  }
  for (const model of priorityModels) push(model)
  for (const model of normalized) push(model)
  return ordered
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
