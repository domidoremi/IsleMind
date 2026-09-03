import {
  clampConversationGenerationParameter,
  resolveConversationGenerationParameterDefault,
  resolveConversationGenerationParameterRanges,
} from '@/bootstrap/providerConversationGeneration'
import {
  getPolicyAllowedProviderModels as getAccessAllowedProviderModels,
  getPolicyPreferredProviderModel as getAccessPreferredProviderModel,
  providerHasPolicyAllowedModel as accessProviderHasPolicyAllowedModel,
  providerHasPolicyModel as accessProviderHasPolicyModel,
  hasProviderModelAccessRules,
  resolveProviderModelAliasAccess,
  type ProviderModelAccessInput,
} from '@/bootstrap/providerModelAccess'
import { PROVIDER_PLATFORM_DEFAULT_TEMPERATURE } from '@/modules/providers'
import { getModelConfig } from '@/types/modelCatalog'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import {
  getProviderDisplayModel,
  hasRemoteProviderModelEvidence,
  inferModelFamily,
  isProviderConversationReady,
  resolveProviderModelAlias,
  type ModelQuickGroup,
} from '@/utils/providerModels'

export const MODEL_QUICK_OPTION_PROVIDER_LIMIT = 24

const HOME_MODEL_HIGHLIGHT_LIMIT = 4
const DEFAULT_SETUP_TEMPERATURE = PROVIDER_PLATFORM_DEFAULT_TEMPERATURE

export type ModelAccessSettings = NonNullable<ProviderModelAccessInput['settings']>

export function pickModelAccessSettings(settings: ModelAccessSettings): ModelAccessSettings {
  return {
    providerAllowlist: settings.providerAllowlist,
    providerBlocklist: settings.providerBlocklist,
    modelAllowlist: settings.modelAllowlist,
    modelBlocklist: settings.modelBlocklist,
  }
}

export interface ModelQuickOption {
  id: string
  provider: AIProvider
  model: string
  family: ModelQuickGroup
}

export interface HomeModelHighlight extends ModelQuickOption {
  selected: boolean
}

export function hasOnlyHistoricalDefaultModels(provider: AIProvider): boolean {
  const models = provider.models.map((model) => model.trim().toLowerCase()).filter(Boolean)
  if (!models.length) return false
  if (hasRemoteProviderModelEvidence(provider)) return false
  const defaults = new Set(['deepseek-v4-pro', 'deepseek-v4-flash'])
  return models.every((model) => defaults.has(model))
}

export function buildModelQuickOptions(providers: AIProvider[], settings?: ProviderModelAccessInput['settings']): ModelQuickOption[] {
  return providers.flatMap((provider) =>
    getPolicyAllowedProviderModels(provider, settings, { limit: MODEL_QUICK_OPTION_PROVIDER_LIMIT }).map((model) => ({
      id: `${provider.id}:${model}`,
      provider,
      model,
      family: inferModelFamily(provider, model),
    }))
  )
}

export function buildHomeModelHighlights(
  conversation: Conversation,
  provider: AIProvider | undefined,
  readyProviders: AIProvider[],
  settings?: ProviderModelAccessInput['settings']
): HomeModelHighlight[] {
  const highlights: HomeModelHighlight[] = []
  const seen = new Set<string>()
  const availableByProviderId = new Map<string, string[]>()
  const getAvailable = (itemProvider: AIProvider): string[] => {
    const cached = availableByProviderId.get(itemProvider.id)
    if (cached) return cached
    const available = getPolicyAllowedProviderModels(itemProvider, settings, { limit: MODEL_QUICK_OPTION_PROVIDER_LIMIT })
    availableByProviderId.set(itemProvider.id, available)
    return available
  }
  const push = (itemProvider: AIProvider | undefined, model: string | undefined) => {
    if (!itemProvider || !model) return
    const available = getAvailable(itemProvider)
    if (!available.includes(model)) {
      const policyAllowsAlias = !hasProviderModelAccessRules(settings) || resolveProviderModelAliasAccess({ provider: itemProvider, model, settings }).allowed
      if (!policyAllowsAlias || !available.includes(resolveProviderModelAlias(itemProvider, model))) return
    }
    const id = `${itemProvider.id}:${model}`
    if (seen.has(id) || highlights.length >= HOME_MODEL_HIGHLIGHT_LIMIT) return
    seen.add(id)
    highlights.push({
      id,
      provider: itemProvider,
      model,
      family: inferModelFamily(itemProvider, model),
      selected: itemProvider.id === conversation.providerId && model === conversation.model,
    })
  }

  push(provider, conversation.model)
  if (provider) {
    push(provider, getPolicyPreferredProviderModel(provider, settings))
    for (const model of getPolicyAllowedProviderModels(provider, settings, { limit: HOME_MODEL_HIGHLIGHT_LIMIT })) push(provider, model)
  }

  for (const readyProvider of readyProviders) {
    push(readyProvider, getPolicyPreferredProviderModel(readyProvider, settings))
  }

  return highlights
}

export function pickReadyProviderForNewConversation(
  providers: AIProvider[],
  defaultProvider: string | null | undefined,
  settings?: ProviderModelAccessInput['settings'],
  hasRules = hasProviderModelAccessRules(settings)
): AIProvider | null {
  const enabled = providers.filter((provider) => isProviderConversationReady(provider) && (!hasRules || providerHasPolicyAllowedModel(provider, settings)))
  return enabled.find((provider) => provider.id === defaultProvider) ?? enabled[0] ?? null
}

export function getPolicyAllowedProviderModels(provider: AIProvider, settings?: ProviderModelAccessInput['settings'], options?: { limit?: number }): string[] {
  return getAccessAllowedProviderModels(provider, settings, options)
}

export function getPolicyPreferredProviderModel(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): string | undefined {
  return getAccessPreferredProviderModel(provider, settings)
}

export function providerHasPolicyAllowedModel(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): boolean {
  return accessProviderHasPolicyAllowedModel(provider, settings)
}

export function providerHasSpecificPolicyModel(provider: AIProvider, model: string, settings?: ProviderModelAccessInput['settings']): boolean {
  return accessProviderHasPolicyModel(provider, model, settings)
}

export function createSetupConversationShell(
  provider: AIProvider | null,
  model: string,
  reasoningEffort: Conversation['reasoningEffort'],
  systemPrompt: string,
  temperature?: number,
  maxTokens?: number,
  overrides: Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'maxTokens'>> = {}
): Conversation {
  const upstreamModel = provider ? resolveProviderModelAlias(provider, model) : model
  const config = getModelConfig(upstreamModel, provider?.type, provider?.modelConfigs)
  const parameterRanges = resolveConversationGenerationParameterRanges({
    provider,
    model: upstreamModel,
    reasoningEffort,
    temperature,
    maxTokens,
    modelConfig: config,
  })
  const conversation: Conversation = {
    id: '__setup__',
    title: '',
    providerId: provider?.id ?? 'setup',
    model,
    providerModelMode: 'inherited',
    systemPrompt,
    temperature: resolveConversationGenerationParameterDefault('temperature', parameterRanges, { temperature }) ?? DEFAULT_SETUP_TEMPERATURE,
    topP: resolveConversationGenerationParameterDefault('topP', parameterRanges) ?? 1,
    reasoningEffort,
    maxTokens: resolveConversationGenerationParameterDefault('maxTokens', parameterRanges, { maxTokens }) ?? config.defaultMaxTokens,
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  }
  if (typeof overrides.temperature === 'number') {
    conversation.temperature = clampConversationGenerationParameter('temperature', overrides.temperature, parameterRanges) ?? conversation.temperature
  }
  if (typeof overrides.topP === 'number') {
    conversation.topP = clampConversationGenerationParameter('topP', overrides.topP, parameterRanges)
  }
  if (typeof overrides.topK === 'number') {
    conversation.topK = clampConversationGenerationParameter('topK', overrides.topK, parameterRanges)
  } else if (Object.prototype.hasOwnProperty.call(overrides, 'topK')) {
    delete conversation.topK
  }
  if (typeof overrides.maxTokens === 'number') {
    conversation.maxTokens = clampConversationGenerationParameter('maxTokens', overrides.maxTokens, parameterRanges) ?? conversation.maxTokens
  }
  const generationParameterOverrides = buildSetupGenerationParameterOverrides(conversation, overrides, { temperature, maxTokens })
  conversation.generationParameterOverrides = generationParameterOverrides ?? {}
  return conversation
}

export function buildExplicitGenerationParameterOverridePatch(
  overrides: Conversation['generationParameterOverrides']
): NonNullable<Conversation['generationParameterOverrides']> {
  return {
    temperature: overrides?.temperature === true,
    topP: overrides?.topP === true,
    topK: overrides?.topK === true,
    maxTokens: overrides?.maxTokens === true,
  }
}

export function resolveRuntimeTarget(
  conversation: Conversation | null,
  providers: AIProvider[],
  settings?: ProviderModelAccessInput['settings']
): { conversation: Conversation; provider?: AIProvider } | null {
  if (!conversation) return null
  if (conversation.providerId === 'local-setup') return { conversation }
  const currentProvider = providers.find((item) => item.id === conversation.providerId)
  const currentModelValid = !!currentProvider && providerHasSpecificPolicyModel(currentProvider, conversation.model, settings)
  if ((conversation.providerModelMode ?? 'inherited') === 'manual' && currentProvider && currentModelValid) {
    return { conversation, provider: currentProvider }
  }
  if (currentProvider && currentProvider.enabled && currentModelValid) {
    return { conversation, provider: currentProvider }
  }
  return { conversation, provider: currentProvider }
}

function buildSetupGenerationParameterOverrides(
  conversation: Conversation,
  overrides: Partial<Pick<Conversation, 'temperature' | 'topP' | 'topK' | 'maxTokens'>>,
  configuredDefaults: { temperature?: number; maxTokens?: number } = {},
): Conversation['generationParameterOverrides'] {
  const overrideFlags: Conversation['generationParameterOverrides'] = {}
  // A configured global preference is a user decision, so the seeded value must reach the
  // provider request instead of being dropped as an unset provider default.
  if (typeof configuredDefaults.temperature === 'number' && Number.isFinite(configuredDefaults.temperature)) {
    overrideFlags.temperature = true
  }
  if (typeof configuredDefaults.maxTokens === 'number' && Number.isFinite(configuredDefaults.maxTokens)) {
    overrideFlags.maxTokens = true
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'temperature') && Number.isFinite(conversation.temperature)) {
    overrideFlags.temperature = true
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'topP') && Number.isFinite(conversation.topP)) {
    overrideFlags.topP = true
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'topK') && Number.isFinite(conversation.topK)) {
    overrideFlags.topK = true
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'maxTokens') && Number.isFinite(conversation.maxTokens)) {
    overrideFlags.maxTokens = true
  }
  return Object.keys(overrideFlags).length ? overrideFlags : undefined
}
