import type { AIProvider, ProviderCredentialSource } from '@/types/providerContracts'
import { chooseCredentialForModel } from './providerCredentialGroups'
import { providerExecutionIdentityKey, type ProviderExecutionIdentity } from './providerExecutionTarget'
import { compareProviderFailoverCandidates, providerFailoverRouteIdentityKey, type ProviderFailoverPolicy, type ProviderFailoverRoute, type ProviderFailoverTrigger } from './providerFailoverPolicy'
import type { ProviderFallbackCandidateBuilder, ProviderFallbackCandidateBuildResult } from './providerFallbackCandidates'
import type { ProviderHealthRecord } from './providerHealth'
import { resolveLocalProviderRoute } from './providerLocalRouter'
import { isProviderModelAvailabilityBlocked, type ProviderModelAvailability } from './providerModelAvailability'
import type { ProviderModelAccessSettings } from './providerModelAccessPolicy'
import { providerForRuntimeFallback } from './providerRuntimeFallback'

/** Request-local admission fence, not a persisted preference or approval. */
export interface ProviderChatExecutionConstraint {
  identity: ProviderExecutionIdentity
  scope: { scopeId: string; epoch: string }
  fallbackUsed: boolean
}

export interface ProviderChatSelection {
  /** Hydrated runtime-only provider. Never passed to Presentation or persisted. */
  provider: AIProvider
  model: string
  constraint: ProviderChatExecutionConstraint
}

export interface ProviderChatResolutionInput {
  preferred: { providerId: string; model: string }
  signal: AbortSignal
  settings?: ProviderModelAccessSettings
  requiredCapabilities?: readonly string[]
  policy?: Partial<ProviderFailoverPolicy>
  allowFallback?: boolean
  targetCredentialGroupId?: string
  confirmFallback?: (candidate: ProviderFailoverRoute, signal: AbortSignal) => Promise<boolean>
}

export interface ProviderChatFallbackInput extends ProviderChatResolutionInput {
  original: ProviderFailoverRoute
  trigger: ProviderFailoverTrigger
  /** Already-serialized native declarations can only be replayed by their adapter. */
  requiredProtocolAdapterId?: ProviderExecutionIdentity['protocolAdapterId']
  streamStarted?: boolean
  continuationBound?: boolean
  fallbackUsed?: boolean
}

export type ProviderChatResolutionReason = 'offline' | 'disabled_provider' | 'missing_key' | 'invalid_configuration' | 'model_unavailable' | 'policy_blocked' | 'confirmation_declined' | 'candidate_changed'

export interface ProviderChatResolutionDependencies {
  readProviders(signal: AbortSignal): Promise<readonly AIProvider[]>
  isOnline(): Promise<boolean>
  buildCandidates: ProviderFallbackCandidateBuilder
  loadHealthRecords(): Promise<Record<string, ProviderHealthRecord>>
  configurationValid(provider: AIProvider): boolean
  accessAllowed(provider: AIProvider, model: string, settings?: ProviderModelAccessSettings): boolean
  resolveIdentity(provider: AIProvider, model: string, source: ProviderCredentialSource): ProviderExecutionIdentity
  getAvailability(identity: ProviderExecutionIdentity): Promise<{ scope: { scopeId: string; epoch: string }; availability: ProviderModelAvailability }>
  healthAllows(identity: ProviderExecutionIdentity): Promise<boolean>
  captureConfiguration?(): () => void
}

/**
 * Admission for the existing Chat executor. Candidate construction, ranking,
 * constraints and consent are evaluated by the existing Providers authorities;
 * this use case never dispatches, retries, saves a preference or runs a route loop.
 */
export function createProviderChatResolutionRuntime(dependencies: ProviderChatResolutionDependencies) {
  async function inspect(
    provider: AIProvider | undefined,
    model: string,
    input: ProviderChatResolutionInput,
    source?: ProviderCredentialSource,
  ): Promise<{ selection: ProviderChatSelection } | { reason: ProviderChatResolutionReason }> {
    if (!provider?.enabled) return { reason: 'disabled_provider' }
    if (!dependencies.accessAllowed(provider, model, input.settings)) return { reason: 'policy_blocked' }
    let hydrated: AIProvider
    try {
      if (source) {
        hydrated = providerForRuntimeFallback({ provider, model }, { providerId: provider.id, model, credentialSource: source })
      } else {
        const credential = chooseCredentialForModel(provider, model, { targetCredentialGroupId: input.targetCredentialGroupId })
        hydrated = { ...provider, apiKey: credential.apiKey, apiKeySource: credential.source }
      }
    } catch { return { reason: 'missing_key' } }
    if (!hydrated.apiKey?.trim()) return { reason: 'missing_key' }
    if (!dependencies.configurationValid(hydrated)) return { reason: 'invalid_configuration' }
    const identity = dependencies.resolveIdentity(hydrated, model, hydrated.apiKeySource ?? { kind: 'none' })
    // Capability evidence comes from the existing manifest/compatibility builder,
    // never from availability or from the mere presence of a cached model ID.
    const projected = dependencies.buildCandidates({ providers: [{ ...hydrated, models: [model] }], original: identity,
      requiredCapabilities: [...(input.requiredCapabilities ?? ['text'])], maxModelsPerProvider: 1 })
    if (!projected.candidates.length) return { reason: 'policy_blocked' }
    const current = await dependencies.getAvailability(identity)
    if (isProviderModelAvailabilityBlocked(current.availability)) return { reason: 'model_unavailable' }
    if (!await dependencies.healthAllows(identity)) return { reason: 'model_unavailable' }
    // Admission may await SQL/health reads; policy changes during those reads
    // must not authorize a route under an earlier settings snapshot.
    if (!dependencies.accessAllowed(provider, model, input.settings)) return { reason: 'policy_blocked' }
    return { selection: { provider: hydrated, model, constraint: { identity, scope: current.scope, fallbackUsed: false } } }
  }

  async function evaluateFallback(input: ProviderChatFallbackInput, confirmedRoute?: ProviderFailoverRoute) {
    const checkConfiguration = dependencies.captureConfiguration?.()
    checkConfiguration?.()
    const providers = await dependencies.readProviders(input.signal)
    const healthRecords = await dependencies.loadHealthRecords()
    const built = dependencies.buildCandidates({ providers: [...providers], original: input.original,
      requiredCapabilities: [...(input.requiredCapabilities ?? ['text'])], healthRecords })
    const candidates: ProviderFallbackCandidateBuildResult = { ...built, candidates: [] }
    const selections = new Map<string, ProviderChatSelection>()
    // Preserve Chat's existing candidate ceiling. No second pass can replenish it.
    const bounded = built.candidates.sort((a, b) => compareProviderFailoverCandidates(input.original, a, b)).slice(0, 8)
    for (const candidate of bounded) {
      if (input.signal.aborted) break
      if (input.targetCredentialGroupId !== undefined && (candidate.providerId !== input.preferred.providerId
        || candidate.credentialSource?.kind !== 'group' || candidate.credentialSource.groupId !== input.targetCredentialGroupId)) continue
      const checked = await inspect(providers.find((provider) => provider.id === candidate.providerId), candidate.model, input, candidate.credentialSource)
      if (!('selection' in checked)) continue
      if (input.requiredProtocolAdapterId && checked.selection.constraint.identity.protocolAdapterId !== input.requiredProtocolAdapterId) continue
      const route = { ...candidate, ...checked.selection.constraint.identity }
      candidates.candidates.push(route)
      selections.set(providerFailoverRouteIdentityKey(route), checked.selection)
    }
    const policy = {
      mode: 'ask-before-cross-provider' as const, ...input.policy,
      // A caller cannot enlarge the Chat operation budget or bypass continuation safety.
      allowAfterStreamStart: false, maxCandidates: 8, maxFailovers: input.fallbackUsed ? 0 : 1,
      ...(input.allowFallback === false || input.continuationBound ? { mode: 'off' as const } : {}),
    }
    const routingInput = { original: input.original, candidates: candidates.candidates,
      trigger: input.trigger, requiredCapabilities: input.requiredCapabilities, streamStarted: input.streamStarted, confirmedRoute }
    // Narrow the existing policy for the first pass; never turn an off/empty
    // approved-provider policy into permission. Both passes share one candidate
    // set and one attempt budget and neither pass dispatches anything.
    const canNarrow = policy.mode !== 'off' && !(['approved-providers', 'auto-safe'].includes(policy.mode)
      && !policy.approvedProviderIds?.length)
    const sameProvider = canNarrow ? resolveLocalProviderRoute({ ...routingInput, policy: { ...policy, mode: 'same-provider' } }) : undefined
    const routed = sameProvider?.decision.eligible ? sameProvider : resolveLocalProviderRoute({ ...routingInput, policy })
    checkConfiguration?.()
    return { decision: routed.decision, candidates, selections }
  }

  async function resolveFallback(input: ProviderChatFallbackInput) {
    let result = await evaluateFallback(input)
    let reason: ProviderChatResolutionReason | undefined
    const confirmation = result.decision.requiresUserConfirmation
      && result.decision.blockedReasons.every((item) => item === 'cross_provider_confirmation_required')
      ? result.decision.acceptedCandidates[0] : undefined
    if (confirmation) {
      const before = result.selections.get(providerFailoverRouteIdentityKey(confirmation))
      if (!input.signal.aborted && input.confirmFallback && await input.confirmFallback(confirmation, input.signal)) {
        // Re-read configuration, keys, access, capabilities, availability epoch and
        // route policy. Consent is never transferred to a newly selected route.
        result = await evaluateFallback(input, confirmation)
        const after = result.selections.get(providerFailoverRouteIdentityKey(confirmation))
        if (!before || !after || before.constraint.scope.scopeId !== after.constraint.scope.scopeId
          || before.constraint.scope.epoch !== after.constraint.scope.epoch || !result.decision.selected
          || providerFailoverRouteIdentityKey(result.decision.selected) !== providerFailoverRouteIdentityKey(confirmation)) reason = 'candidate_changed'
      } else reason = 'confirmation_declined'
    }
    if (input.signal.aborted || !await dependencies.isOnline()) reason = 'offline'
    const selected = result.decision.selected
    const selection = !reason && selected ? result.selections.get(providerFailoverRouteIdentityKey(selected)) : undefined
    return { decision: result.decision, candidates: result.candidates,
      ...(selection ? { selection: { ...selection, constraint: { ...selection.constraint, fallbackUsed: true } } } : {}),
      ...(reason ? { reason } : {}),
    }
  }

  async function resolvePreferred(input: ProviderChatResolutionInput) {
    if (input.signal.aborted) return { kind: 'cancelled' as const }
    if (!await dependencies.isOnline()) return { kind: 'blocked' as const, reason: 'offline' as const }
    const checkConfiguration = dependencies.captureConfiguration?.()
    checkConfiguration?.()
    const providers = await dependencies.readProviders(input.signal)
    const provider = providers.find((item) => item.id === input.preferred.providerId)
    const checked = await inspect(provider, input.preferred.model, input)
    checkConfiguration?.()
    if (input.signal.aborted) return { kind: 'cancelled' as const }
    if ('selection' in checked) return { kind: 'ready' as const, selection: checked.selection }
    // Policy/configuration/credential failures do not become lifecycle evidence.
    const trigger = checked.reason === 'missing_key' ? 'credential_unhealthy' : 'model_unavailable'
    const fallback = await resolveFallback({ ...input, trigger,
      original: { ...input.preferred, ...(provider ? { region: provider.tokenPlanRegion } : {}) } })
    if (input.signal.aborted) return { kind: 'cancelled' as const }
    return fallback.selection ? { kind: 'ready' as const, selection: fallback.selection }
      : { kind: 'blocked' as const, reason: fallback.reason ?? checked.reason }
  }

  async function revalidate(constraint: ProviderChatExecutionConstraint, input: ProviderChatResolutionInput) {
    if (input.signal.aborted || !await dependencies.isOnline()) return undefined
    const checkConfiguration = dependencies.captureConfiguration?.()
    checkConfiguration?.()
    const providers = await dependencies.readProviders(input.signal)
    const checked = await inspect(providers.find((provider) => provider.id === constraint.identity.providerId), input.preferred.model, input, constraint.identity.credentialSource)
    checkConfiguration?.()
    if (!('selection' in checked) || input.signal.aborted) return undefined
    const actual = checked.selection.constraint
    if (providerExecutionIdentityKey(actual.identity) !== providerExecutionIdentityKey(constraint.identity)
      || actual.scope.scopeId !== constraint.scope.scopeId || actual.scope.epoch !== constraint.scope.epoch) return undefined
    return { ...checked.selection, constraint }
  }

  return { resolvePreferred, resolveFallback, revalidate }
}
