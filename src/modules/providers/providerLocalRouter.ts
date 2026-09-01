import {
  resolveFailoverDecision,
  type ProviderFailoverCandidate,
  type ProviderFailoverDecision,
  type ProviderFailoverPolicy,
  type ProviderFailoverRoute,
  type ProviderFailoverTrigger,
} from './providerFailoverPolicy'

export const PROVIDER_LOCAL_ROUTER_SCHEMA = 'islemind.provider-local-router.v1' as const

export interface ProviderLocalRouterPolicy extends ProviderFailoverPolicy {
  maxCandidates: number
  maxFailovers: number
}

export interface ProviderLocalRouterInput {
  original: ProviderFailoverRoute
  candidates: readonly ProviderFailoverCandidate[]
  trigger: ProviderFailoverTrigger
  requiredCapabilities?: readonly string[]
  streamStarted?: boolean
  attemptedRoutes?: readonly ProviderFailoverRoute[]
  policy?: Partial<ProviderLocalRouterPolicy>
}

export interface ProviderLocalRouterResult {
  schema: typeof PROVIDER_LOCAL_ROUTER_SCHEMA
  policy: ProviderLocalRouterPolicy
  decision: ProviderFailoverDecision
  trace: {
    original: ProviderFailoverRoute
    trigger: ProviderFailoverTrigger
    attemptedRoutes: ProviderFailoverRoute[]
    selected?: ProviderFailoverRoute
    failoverCount: number
    candidateCount: number
    rejectedBeforePolicy: number
  }
}

export const DEFAULT_PROVIDER_LOCAL_ROUTER_POLICY: ProviderLocalRouterPolicy = {
  mode: 'capability-equivalent',
  preserveRegion: true,
  maxCostTier: 'medium',
  allowHigherCostTier: false,
  allowCredentialFailover: false,
  maxCandidates: 8,
  maxFailovers: 2,
}

/**
 * Deterministic local route selection with bounded candidates and attempts.
 * Capability matching and health filtering remain delegated to the provider
 * failover policy; this layer adds loop/cost protection and an auditable trace.
 */
export function resolveLocalProviderRoute(input: ProviderLocalRouterInput): ProviderLocalRouterResult {
  const policy = normalizePolicy(input.policy)
  const attemptedRoutes = input.attemptedRoutes ?? []
  const originalKey = routeKey(input.original)
  const attemptedKeys = new Set(attemptedRoutes.map(routeKey))
  attemptedKeys.add(originalKey)
  const priorFailoverCount = [...new Set(attemptedRoutes.map(routeKey))]
    .filter((key) => key !== originalKey)
    .length
  const boundedCandidates = input.candidates
    .filter((candidate) => !attemptedKeys.has(routeKey(candidate)))
    .slice(0, policy.maxCandidates)
  const rejectedBeforePolicy = Math.max(0, input.candidates.length - boundedCandidates.length)
  const candidateLimitReached = input.candidates
    .filter((candidate) => !attemptedKeys.has(routeKey(candidate)))
    .length > boundedCandidates.length
  const decision = resolveFailoverDecision({
    policy,
    trigger: input.trigger,
    original: input.original,
    candidates: [...boundedCandidates],
    requiredCapabilities: input.requiredCapabilities ? [...input.requiredCapabilities] : undefined,
    streamStarted: input.streamStarted,
  })
  const failoverLimitReached = priorFailoverCount >= policy.maxFailovers
  const boundedDecision = failoverLimitReached || (decision.selected !== undefined && priorFailoverCount + 1 > policy.maxFailovers)
    ? {
        ...decision,
        eligible: false,
        selected: undefined,
        blockedReasons: decision.blockedReasons.includes('failover_limit_reached')
          ? decision.blockedReasons
          : [...decision.blockedReasons, 'failover_limit_reached' as const],
        reason: 'blocked' as const,
      }
    : decision
  const finalDecision = !boundedDecision.selected && candidateLimitReached && !boundedDecision.blockedReasons.includes('candidate_limit_reached')
    ? {
        ...boundedDecision,
        blockedReasons: [...boundedDecision.blockedReasons, 'candidate_limit_reached' as const],
      }
    : boundedDecision
  const selected = finalDecision.selected
  const failoverCount = priorFailoverCount + (selected ? 1 : 0)
  return {
    schema: PROVIDER_LOCAL_ROUTER_SCHEMA,
    policy,
    decision: finalDecision,
    trace: {
      original: input.original,
      trigger: input.trigger,
      attemptedRoutes: [...attemptedRoutes],
      selected,
      failoverCount,
      candidateCount: boundedCandidates.length,
      rejectedBeforePolicy,
    },
  }
}

export function providerRouteKey(route: Pick<ProviderFailoverRoute, 'providerId' | 'model' | 'credentialGroupId'>): string {
  return routeKey(route)
}

function normalizePolicy(input: Partial<ProviderLocalRouterPolicy> | undefined): ProviderLocalRouterPolicy {
  const source = input ?? {}
  return {
    ...DEFAULT_PROVIDER_LOCAL_ROUTER_POLICY,
    ...source,
    maxCandidates: clampInteger(source.maxCandidates, DEFAULT_PROVIDER_LOCAL_ROUTER_POLICY.maxCandidates, 1, 32),
    maxFailovers: clampInteger(source.maxFailovers, DEFAULT_PROVIDER_LOCAL_ROUTER_POLICY.maxFailovers, 0, 8),
    approvedProviderIds: source.approvedProviderIds?.filter(Boolean),
  }
}

function routeKey(route: Pick<ProviderFailoverRoute, 'providerId' | 'model' | 'credentialGroupId'>): string {
  return `${route.providerId}|${route.model}|${route.credentialGroupId ?? '*'}`
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.max(min, Math.min(max, candidate))
}
