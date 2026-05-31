import type { AIProvider, Settings } from '@/types'

export type AccessPolicyDecision =
  | { allowed: true; providerId: string; model: string; matchedRules: string[] }
  | { allowed: false; providerId: string; model: string; reason: 'provider_blocked' | 'provider_not_allowed' | 'model_blocked' | 'model_not_allowed'; matchedRules: string[] }

export interface ProviderModelAccessInput {
  provider: Pick<AIProvider, 'id'>
  model: string
  settings?: Pick<Settings, 'providerAllowlist' | 'providerBlocklist' | 'modelAllowlist' | 'modelBlocklist'>
}

export function resolveProviderModelAccess(input: ProviderModelAccessInput): AccessPolicyDecision {
  const providerId = input.provider.id
  const model = input.model
  const providerBlock = matchList(providerId, input.settings?.providerBlocklist)
  if (providerBlock) return { allowed: false, providerId, model, reason: 'provider_blocked', matchedRules: [`providerBlocklist:${providerBlock}`] }
  const providerAllowlist = normalizeList(input.settings?.providerAllowlist)
  const providerAllow = matchList(providerId, providerAllowlist)
  if (providerAllowlist.length && !providerAllow) return { allowed: false, providerId, model, reason: 'provider_not_allowed', matchedRules: ['providerAllowlist'] }
  const modelBlock = matchList(model, input.settings?.modelBlocklist)
  if (modelBlock) return { allowed: false, providerId, model, reason: 'model_blocked', matchedRules: [`modelBlocklist:${modelBlock}`] }
  const modelAllowlist = normalizeList(input.settings?.modelAllowlist)
  const modelAllow = matchList(model, modelAllowlist)
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

function matchList(value: string, list: string[] | undefined): string | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  for (const rule of normalizeList(list)) {
    if (rule === normalized) return rule
    if (rule.endsWith('*') && normalized.startsWith(rule.slice(0, -1))) return rule
    if (rule.startsWith('*') && normalized.endsWith(rule.slice(1))) return rule
  }
  return null
}

function normalizeList(list: string[] | undefined): string[] {
  return (list ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
}
