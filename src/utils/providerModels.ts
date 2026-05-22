import type { AIProvider, ProviderCredentialGroup } from '@/types'

const HISTORICAL_DEFAULT_MODEL_IDS = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
])

export function hasRemoteProviderModelEvidence(provider: AIProvider): boolean {
  return provider.lastModelSyncStatus === 'ok' ||
    provider.lastTestStatus === 'ok' ||
    provider.modelConfigs?.some((model) => model.source === 'remote') ||
    provider.credentialGroups?.some((group) => group.lastModelSyncStatus === 'ok') ||
    false
}

const HISTORICAL_DEFAULT_MODEL_SETS = [
  ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
]

export function clearHistoricalInjectedProviderModels(provider: AIProvider): string[] {
  return clearHistoricalInjectedModelList(provider.models ?? [], hasRemoteProviderModelEvidence(provider))
}

export function clearHistoricalInjectedGroupModels(group: ProviderCredentialGroup): string[] {
  return clearHistoricalInjectedModelList(group.availableModels ?? [], group.lastModelSyncStatus === 'ok')
}

export function clearHistoricalInjectedModelList(models: string[], hasSyncEvidence: boolean): string[] {
  if (hasSyncEvidence) return models
  const normalized = models.map((item) => item.trim()).filter(Boolean)
  if (HISTORICAL_DEFAULT_MODEL_SETS.some((set) => sameModelSet(normalized, set))) return []
  return normalized.filter((model) => !HISTORICAL_DEFAULT_MODEL_IDS.has(model.toLowerCase()))
}

function sameModelSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const normalized = new Set(left.map((item) => item.trim().toLowerCase()).filter(Boolean))
  return right.every((item) => normalized.has(item))
}
