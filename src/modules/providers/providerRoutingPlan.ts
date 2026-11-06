import { normalizeModelRoutingPlan, type ModelRoutingPlan } from '@/core/modelRoutingPlan'
import type { ProviderFailoverPolicy } from './providerFailoverPolicy'

export function routingPlanPolicy(plan: ModelRoutingPlan, restrictions?: Partial<ProviderFailoverPolicy>): Partial<ProviderFailoverPolicy> {
  if (!normalizeModelRoutingPlan(plan)) return { mode: 'off' }
  const policy: Partial<ProviderFailoverPolicy> = plan.mode === 'fixed' ? { mode: 'off' } : {
    mode: plan.crossProvider === 'allow' ? 'approved-providers' : 'ask-before-cross-provider',
    approvedProviderIds: [plan.backup!.providerId],
    // Choosing a named backup explicitly permits its price class. No claim is
    // made about its actual price; capability/access/continuation checks remain.
    allowHigherCostTier: true,
    maxCostTier: 'unknown',
  }
  const merged = { ...policy, ...restrictions }
  // The request can narrow a saved plan, never turn its per-request question
  // into an automatic grant. Explicit deny and empty allowlists remain denies.
  if (plan.mode === 'fixed') merged.mode = 'off'
  else if (plan.crossProvider === 'ask' && !['off', 'same-provider'].includes(merged.mode ?? '')
    && !(['approved-providers', 'auto-safe'].includes(merged.mode ?? '') && !merged.approvedProviderIds?.length)) {
    merged.mode = 'ask-before-cross-provider'
  }
  return merged
}
