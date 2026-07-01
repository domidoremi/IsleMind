import type { AIProvider, Settings } from '@/types'
import {
  getProviderManualModels,
  getProviderPreferredModel,
  inferModelFamily,
  isProviderChatCompatibleModel,
  normalizeProviderModelAliases,
  resolveProviderModelAlias,
} from '@/utils/providerModels'

type ProviderModelAccessProvider = Pick<AIProvider, 'id' | 'type' | 'presetId' | 'detectedPresetId' | 'baseUrl'>
type ProviderModelAliasAccessProvider = ProviderModelAccessProvider & Pick<AIProvider, 'modelAliases'>

const HISTORICAL_DEEPSEEK_MODEL_IDS = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
])
const HISTORICAL_DEEPSEEK_DEFAULT_MODEL_SET = new Set([
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-chat',
  'deepseek-reasoner',
])

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
  modelLimit?: number
  includePreferredModel?: boolean
}

export interface ProviderModelDisplayCandidate {
  provider: AIProvider
  models: string[]
  preferredModel?: string
}

export function hasProviderModelAccessRules(settings?: ProviderModelAccessInput['settings']): boolean {
  return Boolean(
    settings?.providerAllowlist?.length ||
    settings?.providerBlocklist?.length ||
    settings?.modelAllowlist?.length ||
    settings?.modelBlocklist?.length
  )
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

export function mergeRuntimeAliasAccessPolicy(requested: AccessPolicyDecision, upstream: AccessPolicyDecision): AccessPolicyDecision {
  if (!requested.allowed && requested.reason !== 'model_not_allowed') return requested
  if (!upstream.allowed && upstream.reason !== 'model_not_allowed') return upstream
  if (requested.allowed || upstream.allowed) {
    return {
      allowed: true,
      providerId: requested.providerId,
      model: requested.model,
      matchedRules: [...requested.matchedRules, ...upstream.matchedRules],
    }
  }
  return upstream
}

export function getPolicyAllowedProviderModels(provider: AIProvider, settings?: ProviderModelAccessInput['settings'], options: { limit?: number } = {}): string[] {
  const limit = normalizeModelLimit(options.limit)
  const enforceAccessRules = hasProviderModelAccessRules(settings)
  const allowed: string[] = []
  const seen = new Set<string>()
  const pushAllowed = (model: string | undefined): boolean => {
    const normalized = model?.trim()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    if (!isProviderChatCompatibleModel(provider, normalized)) return false
    if (enforceAccessRules && !resolveProviderModelAliasAccess({ provider, model: normalized, settings }).allowed) return false
    allowed.push(normalized)
    return limit !== undefined && allowed.length >= limit
  }

  const manualModels = getProviderManualModels(provider)
  const enabledGroups = provider.credentialGroups?.filter((group) => group.enabled !== false && group.lastModelSyncStatus === 'ok') ?? []
  let usedSyncedSource = false
  for (const group of enabledGroups) {
    let groupHadModels = false
    for (const model of iteratePolicySourceModels(group.availableModels ?? [], provider)) {
      groupHadModels = true
      if (pushAllowed(model)) return allowed
    }
    if (groupHadModels) usedSyncedSource = true
  }
  if (!usedSyncedSource && provider.lastModelSyncStatus === 'ok') {
    let hasSyncedProviderModels = false
    for (const model of iteratePolicySourceModels(provider.models ?? [], provider)) {
      hasSyncedProviderModels = true
      usedSyncedSource = true
      if (pushAllowed(model)) return allowed
    }
    if (!hasSyncedProviderModels) usedSyncedSource = false
  }
  if (!usedSyncedSource && provider.lastTestStatus === 'ok' && provider.lastTestModel) {
    if (pushAllowed(provider.lastTestModel)) return allowed
  }
  for (const model of manualModels) {
    if (pushAllowed(model)) return allowed
  }
  for (const alias of normalizeProviderModelAliases(provider)) {
    if (pushAllowed(alias.alias)) return allowed
  }
  return allowed
}

export function getPolicyPreferredProviderModel(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): string | undefined {
  const preferred = getProviderPreferredModel(provider)
  if (preferred && (!hasProviderModelAccessRules(settings) || resolveProviderModelAliasAccess({ provider, model: preferred, settings }).allowed)) return preferred
  return getPolicyAllowedProviderModels(provider, settings, { limit: 1 })[0]
}

export function providerHasPolicyAllowedModel(provider: AIProvider, settings?: ProviderModelAccessInput['settings']): boolean {
  return getPolicyAllowedProviderModels(provider, settings, { limit: 1 }).length > 0
}

export function providerHasPolicyModel(provider: AIProvider, model: string, settings?: ProviderModelAccessInput['settings']): boolean {
  const normalized = model.trim()
  return !!normalized &&
    isProviderChatCompatibleModel(provider, normalized) &&
    (!hasProviderModelAccessRules(settings) || resolveProviderModelAliasAccess({ provider, model: normalized, settings }).allowed) &&
    providerHasAvailableSourceModel(provider, normalized)
}

export function getProviderModelDisplayCandidates(input: ProviderModelDisplayPolicyInput): ProviderModelDisplayCandidate[] {
  return input.providers.flatMap((provider) => {
    if (!input.includeLocalSetup && provider.id === 'local-setup') return []
    if (!input.includeDisabled && !provider.enabled) return []
    const models = getPolicyAllowedProviderModels(provider, input.settings, { limit: input.modelLimit })
    if (!models.length) return []
    return [{
      provider,
      models,
      preferredModel: input.includePreferredModel === false ? undefined : getPolicyPreferredProviderModel(provider, input.settings),
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

function normalizeModelLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isFinite(limit)) return undefined
  return Math.max(1, Math.floor(limit))
}

function* iteratePolicySourceModels(models: string[], provider: ProviderModelAccessProvider): Iterable<string> {
  const allowHistorical = isDeepSeekProvider(provider)
  if (!allowHistorical && isHistoricalDeepSeekDefaultSet(models)) return
  for (const model of models) {
    if (!allowHistorical && HISTORICAL_DEEPSEEK_MODEL_IDS.has(model.trim().toLowerCase())) continue
    yield model
  }
}

function providerHasAvailableSourceModel(provider: AIProvider, targetModel: string): boolean {
  const manualModels = getProviderManualModels(provider)
  const enabledGroups = provider.credentialGroups?.filter((group) => group.enabled !== false && group.lastModelSyncStatus === 'ok') ?? []
  let usedSyncedSource = false
  for (const group of enabledGroups) {
    let groupHadModels = false
    for (const model of iteratePolicySourceModels(group.availableModels ?? [], provider)) {
      groupHadModels = true
      if (samePolicyModel(model, targetModel)) return true
    }
    if (groupHadModels) usedSyncedSource = true
  }
  if (!usedSyncedSource && provider.lastModelSyncStatus === 'ok') {
    let hasSyncedProviderModels = false
    for (const model of iteratePolicySourceModels(provider.models ?? [], provider)) {
      hasSyncedProviderModels = true
      usedSyncedSource = true
      if (samePolicyModel(model, targetModel)) return true
    }
    if (!hasSyncedProviderModels) usedSyncedSource = false
  }
  if (!usedSyncedSource && provider.lastTestStatus === 'ok' && samePolicyModel(provider.lastTestModel, targetModel)) return true
  if (manualModels.some((model) => samePolicyModel(model, targetModel))) return true
  return normalizeProviderModelAliases(provider).some((alias) =>
    samePolicyModel(alias.alias, targetModel) || samePolicyModel(alias.model, targetModel)
  )
}

function samePolicyModel(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = left?.trim().toLowerCase()
  const normalizedRight = right?.trim().toLowerCase()
  return !!normalizedLeft && !!normalizedRight && normalizedLeft === normalizedRight
}

function isHistoricalDeepSeekDefaultSet(models: string[]): boolean {
  if (models.length !== HISTORICAL_DEEPSEEK_DEFAULT_MODEL_SET.size) return false
  const normalized = new Set(models.map((model) => model.trim().toLowerCase()).filter(Boolean))
  if (normalized.size !== HISTORICAL_DEEPSEEK_DEFAULT_MODEL_SET.size) return false
  for (const model of HISTORICAL_DEEPSEEK_DEFAULT_MODEL_SET) {
    if (!normalized.has(model)) return false
  }
  return true
}

function isDeepSeekProvider(provider: ProviderModelAccessProvider): boolean {
  if (provider.presetId === 'deepseek' || provider.detectedPresetId === 'deepseek') return true
  const baseUrl = (provider.baseUrl ?? '').toLowerCase()
  return baseUrl.includes('api.deepseek.com')
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
