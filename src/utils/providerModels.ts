import type { AIProvider, ProviderCredentialGroup } from '@/types'

const HISTORICAL_DEEPSEEK_MODEL_IDS = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
])

const HISTORICAL_DEEPSEEK_MODEL_SETS = [
  ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
]

export function hasRemoteProviderModelEvidence(provider: AIProvider): boolean {
  return provider.lastModelSyncStatus === 'ok' ||
    provider.lastTestStatus === 'ok' ||
    provider.modelConfigs?.some((model) => model.source === 'remote') ||
    provider.credentialGroups?.some((group) => group.lastModelSyncStatus === 'ok') ||
    false
}

export function clearHistoricalInjectedProviderModels(provider: AIProvider): string[] {
  return clearHistoricalInjectedModelList(provider.models ?? [], provider)
}

export function clearHistoricalInjectedGroupModels(group: ProviderCredentialGroup, provider?: AIProvider): string[] {
  return clearHistoricalInjectedModelList(group.availableModels ?? [], provider)
}

export function getProviderAvailableModels(provider: AIProvider): string[] {
  const models = [
    ...clearHistoricalInjectedProviderModels(provider),
    ...(provider.credentialGroups ?? [])
      .filter((group) => group.enabled !== false)
      .flatMap((group) => clearHistoricalInjectedGroupModels(group, provider)),
  ]
  return uniqueModels(models)
}

export function getProviderPreferredModel(provider: AIProvider): string | undefined {
  const models = getProviderAvailableModels(provider)
  if (!models.length) return undefined
  if (provider.lastTestStatus === 'ok' && provider.lastTestModel) {
    const tested = models.find((model) => model === provider.lastTestModel)
    if (tested) return tested
  }
  return models[0]
}

export function isProviderConversationReady(provider: AIProvider): boolean {
  return provider.id !== 'local-setup' &&
    provider.enabled &&
    provider.lastTestStatus === 'ok' &&
    !!getProviderPreferredModel(provider)
}

export function clearHistoricalInjectedModelList(models: string[], provider?: AIProvider): string[] {
  const normalized = uniqueModels(models.map((item) => item.trim()).filter(Boolean))
  if (!normalized.length) return []
  if (isDeepSeekProvider(provider)) return normalized
  if (HISTORICAL_DEEPSEEK_MODEL_SETS.some((set) => sameModelSet(normalized, set))) return []
  return normalized.filter((model) => !HISTORICAL_DEEPSEEK_MODEL_IDS.has(model.toLowerCase()))
}

function sameModelSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const normalized = new Set(left.map((item) => item.trim().toLowerCase()).filter(Boolean))
  return right.every((item) => normalized.has(item))
}

function isDeepSeekProvider(provider?: AIProvider): boolean {
  if (!provider) return false
  if (provider.presetId === 'deepseek' || provider.detectedPresetId === 'deepseek') return true
  const baseUrl = (provider.baseUrl ?? '').toLowerCase()
  return baseUrl.includes('api.deepseek.com')
}

function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>()
  return models
    .map((model) => model.trim())
    .filter((model) => {
      if (!model || seen.has(model)) return false
      seen.add(model)
      return true
    })
}
