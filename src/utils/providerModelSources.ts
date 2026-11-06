import type { AIModel, AIProvider } from '@/types/providerContracts'
import { resolveProviderModelAlias } from './providerModels'

export interface ProviderModelSource {
  id: string
  name: string
  automatic?: boolean
  models: string[]
}

export function getProviderModelSource(provider: AIProvider, modelId: string): AIModel['upstreamProvider'] {
  const upstreamId = resolveProviderModelAlias(provider, modelId)
  return provider.modelConfigs?.find(model => model.id === upstreamId)?.upstreamProvider
}

export function groupProviderModelsBySource(provider: AIProvider, modelIds: readonly string[]): ProviderModelSource[] {
  const configs = new Map(provider.modelConfigs?.map(model => [model.id, model]))
  const groups = new Map<string, ProviderModelSource>()
  for (const modelId of modelIds) {
    const source = configs.get(resolveProviderModelAlias(provider, modelId))?.upstreamProvider
    const id = source?.id ?? ''
    let group = groups.get(id)
    if (!group) {
      group = { id, name: source?.name ?? provider.name, ...(source?.automatic ? { automatic: true } : {}), models: [] }
      groups.set(id, group)
    }
    group.models.push(modelId)
  }
  return [...groups.values()]
}
