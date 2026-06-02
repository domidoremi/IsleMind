import type { AIProvider, Settings } from '@/types'
import { getProviderPreferredModel, getProviderSelectableModels, inferModelFamily, resolveProviderModelAlias } from '@/utils/providerModels'

type ProviderModelAccessProvider = Pick<AIProvider, 'id' | 'type' | 'presetId' | 'detectedPresetId' | 'baseUrl'>
type ProviderModelAliasAccessProvider = ProviderModelAccessProvider & Pick<AIProvider, 'modelAliases'>

export type AccessPolicyDecision =
  | { allowed: true; providerId: string; model: string; matchedRules: string[] }
  | { allowed: false; providerId: string; model: string; reason: 'provider_blocked' | 'provider_not_allowed' | 'model_blocked' | 'model_not_allowed'; matchedRules: string[] }

export interface ProviderModelAccessInput {
  provider: ProviderModelAccessProvider
  model: string
  settings?: Pick<Settings, 'providerAllowlist' | 'providerBlocklist' | 'modelAllowlist' | 'modelBlocklist'>
}

export interface ProviderModelAliasAccessInput extends Omit<ProviderModelAccessInput, 'provider'> {
  provider: ProviderModelAliasAccessProvider
}

export interface ProviderModelDisplayPolicyInput {
  providers: AIProvider[]
  settings?: ProviderModelAccessInput['settings']
  includeDisabled?: boolean
  includeLocalSetup?: boolean
}

export interface ProviderModelDisplayCandidate {
  provider: AIProvider
  models: string[]
  preferredModel?: string
}

export function resolveProviderModelAccess(input: ProviderModelAccessInput): AccessPolicyDecision {
  const providerId = input.provider.id
  const model = input.model
  const providerBlock = matchProviderScope(input.provider, providerId, input.settings?.providerBlocklist)
  if (providerBlock) return { allowed: false, providerId, model, reason: 'provider_blocked', matchedRules: [`providerBlocklist:${providerBlock}`] }
  const providerAllowlist = normalizeList(input.settings?.providerAllowlist)
  const providerAllow = matchProviderScope(input.provider, providerId, providerAllowlist)
  if (providerAllowlist.length && !providerAllow) return { allowed: false, providerId, model, reason: 'provider_not_allowed', matchedRules: ['providerAllowlist'] }
  const modelBlock = matchModelScope(input.provider, model, input.settings?.modelBlocklist)
  if (modelBlock) return { allowed: false, providerId, model, reason: 'model_blocked', matchedRules: [`modelBlocklist:${modelBlock}`] }
  const modelAllowlist = normalizeList(input.settings?.modelAllowlist)
  const modelAllow = matchModelScope(input.provider, model, modelAllowlist)
  if (modelAllowlist.length && !modelAllow) return { allowed: false, providerId, model, reason: 'model_not_allowed', matchedRules: ['modelAllowlist'] }
  return {
    allowed: true,
    providerId,
    model,
    matchedRules: [
      ...(providerAllow ? [`providerAllowlist:${providerAllow}`] : []),
      ...(modelAllow ? [`modelAllowlist:${modelAllow}`] : []),
    ],
  }
}

export function resolveProviderModelAliasAccess(input: ProviderModelAliasAccessInput): AccessPolicyDecision {
  const upstreamModel = resolveProviderModelAlias(input.provider, input.model)
  const direct = resolveProviderModelAccess(input)
  if (upstreamModel === input.model) return direct
  const upstream = resolveProviderModelAccess({ ...input, model: upstreamModel })
  return mergeProviderAliasAccess(direct, upstream)
}

export function getPolicyAllowedProviderModels(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): string[] {
  return getProviderSelectableModels(provider).filter((model) =>
    resolveProviderModelAliasAccess({ provider, model, settings }).allowed
  )
}

export function getPolicyPreferredProviderModel(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): string | undefined {
  const preferred = getProviderPreferredModel(provider)
  if (preferred && resolveProviderModelAliasAccess({ provider, model: preferred, settings }).allowed) return preferred
  return getPolicyAllowedProviderModels(provider, settings)[0]
}

export function providerHasPolicyAllowedModel(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): boolean {
  return getPolicyAllowedProviderModels(provider, settings).length > 0
}

export function getProviderModelDisplayCandidates(input: ProviderModelDisplayPolicyInput): ProviderModelDisplayCandidate[] {
  return input.providers.flatMap((provider) => {
    if (!input.includeLocalSetup && provider.id === 'local-setup') return []
    if (!input.includeDisabled && !provider.enabled) return []
    const models = getPolicyAllowedProviderModels(provider, input.settings)
    if (!models.length) return []
    return [{
      provider,
      models,
      preferredModel: getPolicyPreferredProviderModel(provider, input.settings),
    }]
  })
}

function mergeProviderAliasAccess(direct: AccessPolicyDecision, upstream: AccessPolicyDecision): AccessPolicyDecision {
  if (!direct.allowed && direct.reason !== 'model_not_allowed') return direct
  if (!upstream.allowed && upstream.reason !== 'model_not_allowed') return upstream
  if (direct.allowed || upstream.allowed) {
    return {
      allowed: true,
      providerId: direct.providerId,
      model: direct.model,
      matchedRules: uniqueRules([...direct.matchedRules, ...upstream.matchedRules]),
    }
  }
  return direct
}

function matchProviderScope(provider: ProviderModelAccessProvider, value: string, list: string[] | undefined): string | null {
  return matchScopedValues([
    value,
    provider.id,
    provider.presetId ? `preset:${provider.presetId}` : '',
    provider.detectedPresetId ? `preset:${provider.detectedPresetId}` : '',
    provider.baseUrl ? `host:${getHost(provider.baseUrl)}` : '',
  ], list)
}

function matchModelScope(provider: ProviderModelAccessProvider, model: string, list: string[] | undefined): string | null {
  const family = inferModelFamily(provider as AIProvider, model)
  return matchScopedValues([
    model,
    family ? `family:${family}` : '',
  ], list)
}

function matchScopedValues(values: string[], list: string[] | undefined): string | null {
  const normalizedValues = values.map((item) => item.trim().toLowerCase()).filter(Boolean)
  for (const rule of normalizeList(list)) {
    for (const value of normalizedValues) {
      if (rule === value) return rule
      if (rule.endsWith('*') && value.startsWith(rule.slice(0, -1))) return rule
      if (rule.startsWith('*') && value.endsWith(rule.slice(1))) return rule
    }
  }
  return null
}

function normalizeList(list: string[] | undefined): string[] {
  return (list ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
}

function getHost(value: string): string {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return value.replace(/^https?:\/\//i, '').split('/')[0]?.toLowerCase() ?? ''
  }
}

function uniqueRules(rules: string[]): string[] {
  return Array.from(new Set(rules))
}
