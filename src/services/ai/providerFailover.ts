export type ProviderFailoverMode =
  | 'off'
  | 'same-provider'
  | 'approved-providers'
  | 'capability-equivalent'
  | 'ask-before-cross-provider'
  | 'auto-safe'

export type ProviderFailoverTrigger =
  | 'timeout'
  | 'network_error'
  | 'rate_limited'
  | 'server_error'
  | 'model_unavailable'
  | 'overloaded'
  | 'credential_unhealthy'
  | 'payload_error'
  | 'safety_refusal'
  | 'stream_started'
  | 'unknown'

export type ProviderFailoverBlockReason =
  | 'policy_off'
  | 'trigger_not_allowed'
  | 'stream_already_started'
  | 'explicit_model_lock'
  | 'no_eligible_candidates'
  | 'cross_provider_confirmation_required'

type ProviderCostTier = 'low' | 'medium' | 'high' | 'unknown'

export interface ProviderFailoverPolicy {
  mode: ProviderFailoverMode
  approvedProviderIds?: string[]
  allowAfterStreamStart?: boolean
  explicitModelLock?: boolean
  allowedRegions?: string[]
  preserveRegion?: boolean
  maxCostTier?: ProviderCostTier
  allowHigherCostTier?: boolean
}

export interface ProviderFailoverRoute {
  providerId: string
  model: string
  credentialGroupId?: string
  family?: string
  region?: string
  costTier?: ProviderCostTier
  capabilities?: string[]
}

export interface ProviderFailoverCandidate extends ProviderFailoverRoute {
  healthy?: boolean
  cooldownActive?: boolean
  healthScore?: number
  latencyMs?: number
  lastSuccessAtMs?: number
  lastFailureAtMs?: number
}

export interface ProviderFailoverCandidateRejection {
  providerId: string
  model: string
  reason:
    | 'same_route'
    | 'unhealthy'
    | 'cooldown'
    | 'provider_not_approved'
    | 'cross_provider_disallowed'
    | 'capability_mismatch'
    | 'region_not_allowed'
    | 'region_changed'
    | 'cost_tier_exceeded'
    | 'cost_tier_increase'
}

export interface ProviderFailoverInput {
  policy: ProviderFailoverPolicy
  trigger: ProviderFailoverTrigger
  original: ProviderFailoverRoute
  candidates: ProviderFailoverCandidate[]
  requiredCapabilities?: string[]
  streamStarted?: boolean
}

export interface ProviderFailoverDecision {
  mode: ProviderFailoverMode
  trigger: ProviderFailoverTrigger
  eligible: boolean
  selected?: ProviderFailoverRoute
  acceptedCandidates: ProviderFailoverRoute[]
  rejectedCandidates: ProviderFailoverCandidateRejection[]
  blockedReasons: ProviderFailoverBlockReason[]
  requiresUserConfirmation: boolean
  reason:
    | 'not_configured'
    | 'selected'
    | 'blocked'
    | 'confirmation_required'
}

export interface ProviderFailureClassificationInput {
  status?: number
  errorName?: string
  errorCode?: string
  errorMessage?: string
  timedOut?: boolean
  networkError?: boolean
  streamStarted?: boolean
  payloadRejected?: boolean
  safetyRefusal?: boolean
  credentialUnhealthy?: boolean
  rateLimited?: boolean
  modelUnavailable?: boolean
  overloaded?: boolean
}

export interface ProviderFailureClassification {
  trigger: ProviderFailoverTrigger
  retryable: boolean
  source: 'explicit' | 'status' | 'error_code' | 'message' | 'stream' | 'unknown'
  evidence: {
    status?: number
    errorName?: string
    errorCode?: string
  }
}

const ALLOWED_TRIGGERS = new Set<ProviderFailoverTrigger>([
  'timeout',
  'network_error',
  'rate_limited',
  'server_error',
  'model_unavailable',
  'overloaded',
  'credential_unhealthy',
])

const COST_TIER_RANK: Record<ProviderCostTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
  unknown: 3,
}

export function classifyProviderFailure(input: ProviderFailureClassificationInput): ProviderFailureClassification {
  const evidence = {
    status: input.status,
    errorName: input.errorName,
    errorCode: input.errorCode,
  }
  if (input.streamStarted) return { trigger: 'stream_started', retryable: false, source: 'stream', evidence }
  if (input.payloadRejected) return { trigger: 'payload_error', retryable: false, source: 'explicit', evidence }
  if (input.safetyRefusal) return { trigger: 'safety_refusal', retryable: false, source: 'explicit', evidence }
  if (input.timedOut) return { trigger: 'timeout', retryable: true, source: 'explicit', evidence }
  if (input.networkError) return { trigger: 'network_error', retryable: true, source: 'explicit', evidence }
  if (input.credentialUnhealthy) return { trigger: 'credential_unhealthy', retryable: true, source: 'explicit', evidence }
  if (input.rateLimited) return { trigger: 'rate_limited', retryable: true, source: 'explicit', evidence }
  if (input.modelUnavailable) return { trigger: 'model_unavailable', retryable: true, source: 'explicit', evidence }
  if (input.overloaded) return { trigger: 'overloaded', retryable: true, source: 'explicit', evidence }

  const statusTrigger = classifyStatus(input.status)
  if (statusTrigger) {
    return {
      trigger: statusTrigger,
      retryable: ALLOWED_TRIGGERS.has(statusTrigger),
      source: 'status',
      evidence,
    }
  }

  const textTrigger = classifyErrorText(input.errorName, input.errorCode, input.errorMessage)
  if (textTrigger) {
    return {
      trigger: textTrigger.trigger,
      retryable: ALLOWED_TRIGGERS.has(textTrigger.trigger),
      source: textTrigger.source,
      evidence,
    }
  }

  return { trigger: 'unknown', retryable: false, source: 'unknown', evidence }
}

export function resolveFailoverDecision(input: ProviderFailoverInput): ProviderFailoverDecision {
  const blockedReasons: ProviderFailoverBlockReason[] = []
  if (input.policy.mode === 'off') blockedReasons.push('policy_off')
  if (!ALLOWED_TRIGGERS.has(input.trigger)) blockedReasons.push('trigger_not_allowed')
  if ((input.streamStarted || input.trigger === 'stream_started') && input.policy.allowAfterStreamStart !== true) blockedReasons.push('stream_already_started')
  if (input.policy.explicitModelLock === true) blockedReasons.push('explicit_model_lock')

  const evaluated = evaluateCandidates(input)
  if (!evaluated.accepted.length && !blockedReasons.length) blockedReasons.push('no_eligible_candidates')

  const crossProviderSelected = evaluated.accepted[0] && evaluated.accepted[0].providerId !== input.original.providerId
  const requiresUserConfirmation = input.policy.mode === 'ask-before-cross-provider' && !!crossProviderSelected
  if (requiresUserConfirmation) blockedReasons.push('cross_provider_confirmation_required')

  const eligible = !blockedReasons.length && !!evaluated.accepted.length
  return {
    mode: input.policy.mode,
    trigger: input.trigger,
    eligible,
    selected: eligible ? routeFromCandidate(evaluated.accepted[0]) : undefined,
    acceptedCandidates: evaluated.accepted.map(routeFromCandidate),
    rejectedCandidates: evaluated.rejected,
    blockedReasons,
    requiresUserConfirmation,
    reason: input.policy.mode === 'off'
      ? 'not_configured'
      : requiresUserConfirmation
        ? 'confirmation_required'
        : eligible
          ? 'selected'
          : 'blocked',
  }
}

function evaluateCandidates(input: ProviderFailoverInput): { accepted: ProviderFailoverCandidate[]; rejected: ProviderFailoverCandidateRejection[] } {
  const accepted: ProviderFailoverCandidate[] = []
  const rejected: ProviderFailoverCandidateRejection[] = []
  for (const candidate of input.candidates) {
    const reason = rejectCandidate(input, candidate)
    if (reason) {
      rejected.push({ providerId: candidate.providerId, model: candidate.model, reason })
      continue
    }
    accepted.push(candidate)
  }
  accepted.sort((left, right) => {
    return candidateRank(input, right) - candidateRank(input, left)
  })
  return { accepted, rejected }
}

function rejectCandidate(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): ProviderFailoverCandidateRejection['reason'] | undefined {
  if (candidate.providerId === input.original.providerId && candidate.model === input.original.model) return 'same_route'
  if (candidate.cooldownActive === true) return 'cooldown'
  if (candidate.healthy === false) return 'unhealthy'
  if (!providerAllowed(input, candidate)) return 'provider_not_approved'
  if (!crossProviderAllowed(input, candidate)) return 'cross_provider_disallowed'
  if (!capabilitiesSatisfied(input.requiredCapabilities ?? [], candidate.capabilities ?? [])) return 'capability_mismatch'
  if (!regionAllowed(input, candidate)) return 'region_not_allowed'
  if (!regionPreserved(input, candidate)) return 'region_changed'
  if (!costWithinMaximum(input, candidate)) return 'cost_tier_exceeded'
  if (!costIncreaseAllowed(input, candidate)) return 'cost_tier_increase'
  return undefined
}

function providerAllowed(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): boolean {
  const approved = input.policy.approvedProviderIds
  if (!approved?.length) return input.policy.mode !== 'approved-providers' && input.policy.mode !== 'auto-safe'
  return approved.includes(candidate.providerId)
}

function crossProviderAllowed(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): boolean {
  if (candidate.providerId === input.original.providerId) return true
  return ['approved-providers', 'capability-equivalent', 'ask-before-cross-provider', 'auto-safe'].includes(input.policy.mode)
}

function capabilitiesSatisfied(required: string[], available: string[]): boolean {
  if (!required.length) return true
  const availableSet = new Set(available)
  return required.every((capability) => availableSet.has(capability))
}

function regionAllowed(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): boolean {
  const allowedRegions = input.policy.allowedRegions
  if (!allowedRegions?.length || !candidate.region) return true
  return allowedRegions.includes(candidate.region)
}

function regionPreserved(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): boolean {
  if (input.policy.preserveRegion !== true) return true
  if (!input.original.region || !candidate.region) return true
  return input.original.region === candidate.region
}

function costWithinMaximum(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): boolean {
  if (!input.policy.maxCostTier || !candidate.costTier) return true
  return COST_TIER_RANK[candidate.costTier] <= COST_TIER_RANK[input.policy.maxCostTier]
}

function costIncreaseAllowed(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): boolean {
  if (input.policy.allowHigherCostTier === true) return true
  if (!input.original.costTier || !candidate.costTier) return true
  return COST_TIER_RANK[candidate.costTier] <= COST_TIER_RANK[input.original.costTier]
}

function classifyStatus(status?: number): ProviderFailoverTrigger | undefined {
  if (!status) return undefined
  if (status === 408) return 'timeout'
  if (status === 401 || status === 403) return 'credential_unhealthy'
  if (status === 404 || status === 410) return 'model_unavailable'
  if (status === 429) return 'rate_limited'
  if (status === 529) return 'overloaded'
  if (status >= 500 && status <= 599) return status === 503 ? 'overloaded' : 'server_error'
  if (status === 400 || status === 413 || status === 422) return 'payload_error'
  return undefined
}

function classifyErrorText(
  errorName?: string,
  errorCode?: string,
  errorMessage?: string,
): { trigger: ProviderFailoverTrigger; source: 'error_code' | 'message' } | undefined {
  const code = (errorCode ?? '').toLowerCase()
  const message = `${errorName ?? ''} ${errorMessage ?? ''}`.toLowerCase()
  if (code.includes('rate') || message.includes('rate limit')) return { trigger: 'rate_limited', source: code ? 'error_code' : 'message' }
  if (code.includes('timeout') || message.includes('timeout') || message.includes('aborterror')) return { trigger: 'timeout', source: code ? 'error_code' : 'message' }
  if (code.includes('overload') || message.includes('overload')) return { trigger: 'overloaded', source: code ? 'error_code' : 'message' }
  if (code.includes('model') && (code.includes('unavailable') || code.includes('not_found'))) return { trigger: 'model_unavailable', source: 'error_code' }
  if (message.includes('model') && (message.includes('unavailable') || message.includes('not found'))) return { trigger: 'model_unavailable', source: 'message' }
  if (code.includes('econnreset') || code.includes('enotfound') || code.includes('network')) return { trigger: 'network_error', source: 'error_code' }
  if (message.includes('network') || message.includes('fetch failed')) return { trigger: 'network_error', source: 'message' }
  return undefined
}

function candidateRank(input: ProviderFailoverInput, candidate: ProviderFailoverCandidate): number {
  const sameProviderBonus = candidate.providerId === input.original.providerId ? 1000 : 0
  const healthScore = candidate.healthScore ?? (candidate.healthy === true ? 100 : 50)
  const costScore = candidate.costTier ? 30 - COST_TIER_RANK[candidate.costTier] * 10 : 0
  const latencyScore = typeof candidate.latencyMs === 'number' ? Math.max(0, 30 - Math.round(candidate.latencyMs / 1000)) : 0
  const recentSuccessScore = candidate.lastSuccessAtMs && (!candidate.lastFailureAtMs || candidate.lastSuccessAtMs > candidate.lastFailureAtMs) ? 15 : 0
  return sameProviderBonus + healthScore + costScore + latencyScore + recentSuccessScore
}

function routeFromCandidate(candidate: ProviderFailoverCandidate): ProviderFailoverRoute {
  return {
    providerId: candidate.providerId,
    model: candidate.model,
    credentialGroupId: candidate.credentialGroupId,
    family: candidate.family,
    region: candidate.region,
    costTier: candidate.costTier,
    capabilities: candidate.capabilities,
  }
}
