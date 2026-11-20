import { MAX_MODEL_ROUTING_GROUP_MEMBERS, modelRoutingPlanTargets, normalizeModelRoutingPlan, sha256Hex, type ModelRouteTarget, type ModelRoutingPlan } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { getPolicyAllowedProviderModels, resolveProviderModelAliasAccess, type ProviderModelAccessSettings } from './providerModelAccess'

/** Local enabled catalogs only. No fuzzy equivalence, network calls or secrets. */
export function collectSameModelRoutingMembers(providers: readonly AIProvider[], settings?: ProviderModelAccessSettings): Map<string, ModelRouteTarget[]> {
  const groups = new Map<string, ModelRouteTarget[]>()
  for (const provider of providers) {
    if (!provider.enabled || provider.id === 'local-setup') continue
    const targets = new Map<string, string>()
    for (const model of getPolicyAllowedProviderModels(provider, settings)) {
      const upstream = resolveProviderModelAlias(provider, model)
      if (!targets.has(upstream) || model === upstream) targets.set(upstream, model)
    }
    for (const [upstream, model] of targets) {
      const members = groups.get(upstream) ?? []
      members.push({ providerId: provider.id, model })
      groups.set(upstream, members)
    }
  }
  return groups
}

export function buildSameModelRoutingPlans(providers: readonly AIProvider[], settings: ProviderModelAccessSettings | undefined, name: (model: string) => string): ModelRoutingPlan[] {
  return [...collectSameModelRoutingMembers(providers, settings)].flatMap(([model, members]) => {
    if (members.length < 2 || members.length > MAX_MODEL_ROUTING_GROUP_MEMBERS) return []
    const plan = normalizeModelRoutingPlan({ schema: 'islemind.model-routing-plan.v1', id: `model-group-${sha256Hex(model).slice(0, 20)}`,
      name: name(model).slice(0, 80).trim(), mode: 'group', primary: members[0], crossProvider: 'ask',
      group: { model, members, strategy: 'round-robin' } })
    return plan ? [plan] : []
  })
}

export function resolveRoutingPlanSelection(plan: ModelRoutingPlan, providers: readonly AIProvider[], settings?: ProviderModelAccessSettings): { provider: AIProvider; model: string } | undefined {
  const targets = plan.mode === 'group' ? modelRoutingPlanTargets(plan) : [plan.primary]
  for (const target of targets) {
    const provider = providers.find(item => item.id === target.providerId)
    if (!provider?.enabled || !resolveProviderModelAliasAccess({ provider, model: target.model, settings }).allowed) continue
    if (plan.mode === 'group' && resolveProviderModelAlias(provider, target.model) !== plan.group?.model) continue
    return { provider, model: target.model }
  }
  return undefined
}
