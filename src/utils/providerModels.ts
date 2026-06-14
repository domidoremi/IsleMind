import { getModelConfig } from '@/types'
import type { AIProvider, ModelAlias, ProviderCredentialGroup } from '@/types'
import { normalizeModelId } from '@/utils/modelReasoning'

export type ModelQuickGroup = 'all' | 'gpt' | 'claude' | 'gemini' | 'deepseek' | 'qwen' | 'kimi' | 'doubao' | 'grok' | 'glm' | 'minimax' | 'mimo' | 'llama' | 'other'

export const MODEL_QUICK_GROUPS: ModelQuickGroup[] = ['all', 'gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'kimi', 'doubao', 'grok', 'glm', 'minimax', 'mimo', 'llama', 'other']

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
  const manualModels = getProviderManualModels(provider)
  const syncedGroupModels = (provider.credentialGroups ?? [])
    .filter((group) => group.enabled !== false && group.lastModelSyncStatus === 'ok')
    .flatMap((group) => clearHistoricalInjectedGroupModels(group, provider))
  if (syncedGroupModels.length) return filterChatCompatibleModels(provider, [...syncedGroupModels, ...manualModels])

  if (provider.lastModelSyncStatus === 'ok') {
    const syncedProviderModels = clearHistoricalInjectedProviderModels(provider)
    if (syncedProviderModels.length) return filterChatCompatibleModels(provider, [...syncedProviderModels, ...manualModels])
  }

  if (provider.lastTestStatus === 'ok' && provider.lastTestModel) {
    return filterChatCompatibleModels(provider, [provider.lastTestModel, ...manualModels])
  }

  return filterChatCompatibleModels(provider, manualModels)
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

export function getProviderManualModels(provider: AIProvider): string[] {
  const explicit = Array.isArray(provider.manualModels) ? provider.manualModels : []
  return uniqueModels(clearHistoricalInjectedModelList(explicit ?? [], provider))
}

export function normalizeProviderModelAliases(provider: Pick<AIProvider, 'modelAliases'>): ModelAlias[] {
  const byAlias = new Map<string, ModelAlias>()
  for (const item of provider.modelAliases ?? []) {
    const alias = item.alias?.trim()
    const model = item.model?.trim()
    if (!alias || !model || alias === model) continue
    byAlias.set(alias.toLowerCase(), { alias, model })
  }
  return Array.from(byAlias.values())
}

export function getProviderSelectableModels(provider: AIProvider): string[] {
  return uniqueModels([
    ...getProviderAvailableModels(provider),
    ...normalizeProviderModelAliases(provider).map((item) => item.alias),
  ])
}

export interface ProviderModelInventorySummary {
  remoteModels: number
  manualModels: number
  aliases: number
  selectableModels: number
  hasRemoteEvidence: boolean
}

export function summarizeProviderModelInventory(provider: AIProvider): ProviderModelInventorySummary {
  const manualModels = getProviderManualModels(provider)
  const aliases = normalizeProviderModelAliases(provider)
  const hasRemoteEvidence = hasRemoteProviderModelEvidence(provider)
  const remoteModels = hasRemoteEvidence
    ? uniqueModels([
      ...clearHistoricalInjectedProviderModels(provider),
      ...(provider.credentialGroups ?? []).flatMap((group) => clearHistoricalInjectedGroupModels(group, provider)),
    ]).length
    : 0
  return {
    remoteModels,
    manualModels: manualModels.length,
    aliases: aliases.length,
    selectableModels: getProviderSelectableModels(provider).length,
    hasRemoteEvidence,
  }
}

export function resolveProviderModelAlias(provider: Pick<AIProvider, 'modelAliases'>, model: string): string {
  const normalized = model.trim()
  if (!normalized) return model
  const match = normalizeProviderModelAliases(provider).find((item) => item.alias.toLowerCase() === normalized.toLowerCase())
  return match?.model ?? model
}

export function getProviderDisplayModel(provider: Pick<AIProvider, 'modelAliases'> | undefined, model: string): string {
  const normalized = model.trim()
  if (!normalized) return model
  const match = provider ? normalizeProviderModelAliases(provider).find((item) => item.alias.toLowerCase() === normalized.toLowerCase()) : undefined
  return match ? `${match.alias} (${match.model})` : getModelConfig(model).name
}

export function inferModelFamily(provider: AIProvider | undefined, model: string | undefined): ModelQuickGroup {
  const modelText = normalizeModelId(model ?? '')
  const modelFamily = inferModelFamilyFromText(modelText, false)
  if (modelFamily) return modelFamily

  const providerText = normalizeModelFamilyText([
    provider?.name,
    provider?.presetId,
    provider?.detectedPresetId,
    provider?.baseUrl,
  ].filter(Boolean).join(' '))
  const providerFamily = inferModelFamilyFromText(providerText, true)
  if (providerFamily) return providerFamily

  if (provider?.type === 'openai') return 'gpt'
  if (provider?.type === 'anthropic' || provider?.wireProtocol === 'anthropic-compatible') return 'claude'
  if (provider?.type === 'google') return 'gemini'
  if (provider?.type === 'xiaomi-mimo') return 'mimo'
  return 'other'
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

function inferModelFamilyFromText(text: string, includeProviderIdentity: boolean): Exclude<ModelQuickGroup, 'all'> | null {
  if (!text) return null
  if (/deepseek/.test(text)) return 'deepseek'
  if (/qwen|qwq|qvq|dashscope|tongyi|aliyun/.test(text)) return 'qwen'
  if (/kimi|moonshot/.test(text)) return 'kimi'
  if (/doubao|volcengine|bytedance/.test(text)) return 'doubao'
  if (/grok|(^|[-_./])xai($|[-_./])|api\.x\.ai/.test(text)) return 'grok'
  if (/glm|bigmodel|zhipu/.test(text)) return 'glm'
  if (/minimax|mini[-_ ]?max|minimaxi/.test(text)) return 'minimax'
  if (/mimo|xiaomi/.test(text)) return 'mimo'
  if (/claude|anthropic/.test(text)) return 'claude'
  if (/gemini|google/.test(text)) return 'gemini'
  if (/llama|(^|[-_./])meta($|[-_./])/.test(text)) return 'llama'
  if (/(^|[-_./])(gpt|o[1-9])/.test(text) || (includeProviderIdentity && /api\.openai\.com/.test(text))) return 'gpt'
  return null
}

function normalizeModelFamilyText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function isProviderChatCompatibleModel(provider: AIProvider, model: string): boolean {
  return getModelConfig(resolveProviderModelAlias(provider, model), provider.type, provider.modelConfigs).chatCompatible !== false
}

function filterChatCompatibleModels(provider: AIProvider, models: string[]): string[] {
  return uniqueModels(models).filter((model) => isProviderChatCompatibleModel(provider, model))
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
