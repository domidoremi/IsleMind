import type { ProviderChatExecutionConstraint, ProviderChatSelection, ProviderChatResolutionInput, ProviderChatFallbackInput, ProviderChatResolutionReason, ProviderChatResolutionDependencies } from './providerChatResolutionContracts'
export type { ProviderChatExecutionConstraint, ProviderChatSelection, ProviderChatResolutionInput, ProviderChatFallbackInput, ProviderChatResolutionReason, ProviderChatResolutionDependencies } from './providerChatResolutionContracts'
import { snapshotPlainData } from '@/core'
import { isModelRoutingPlanTarget, modelRoutingPlanTargets, normalizeModelRoutingPlan, sameModelRoute } from '@/core/modelRoutingPlan'
import { routingPlanPolicy } from './providerRoutingPlan'
import { createProviderRoutingGroupSelector } from './providerRoutingGroupSelection'
import type { AIProvider, ProviderCredentialSource } from '@/types/providerContracts'
import { chooseCredentialForModel } from './providerCredentialGroups'
import { providerExecutionIdentityKey } from './providerExecutionTarget'
import { compareProviderFailoverCandidates, providerFailoverRouteIdentityKey, type ProviderFailoverRoute } from './providerFailoverPolicy'
import { PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA, type ProviderFallbackCandidateBuildResult } from './providerFallbackCandidates'
import { resolveLocalProviderRoute } from './providerLocalRouter'
import { isProviderModelAvailabilityBlocked } from './providerModelAvailability'
import type { ProviderModelAccessSettings } from './providerModelAccessPolicy'
import { providerForRuntimeFallback } from './providerRuntimeFallback'

/**
 * Admission for the existing Chat executor. Candidate construction, ranking,
 * constraints and consent are evaluated by the existing Providers authorities;
 * this use case never dispatches, retries, saves a preference or runs a route loop.
 */
export function createProviderChatResolutionRuntime(dependencies: ProviderChatResolutionDependencies) {
  const selectGroup = createProviderRoutingGroupSelector(dependencies)
  interface AdmissionSafety {
    currentSettings(): ProviderModelAccessSettings | undefined
    fallbackPolicyUnchanged(): boolean
  }

  function captureInput<Input extends ProviderChatResolutionInput>(source: Input) {
    const input = {
      ...source,
      preferred: snapshotPlainData(source.preferred),
      providers: snapshotPlainData(source.providers),
      settings: snapshotPlainData(source.settings),
      requiredCapabilities: snapshotPlainData(source.requiredCapabilities),
      policy: snapshotPlainData(source.policy),
      routingPlan: snapshotPlainData(source.routingPlan),
    }
    const policy = JSON.stringify(input.policy)
    const routingPlan = JSON.stringify(input.routingPlan)
    const fallback = source as ProviderChatResolutionInput & Partial<ProviderChatFallbackInput>
    const fallbackUsed = fallback.fallbackUsed
    const continuationBound = fallback.continuationBound
    const streamStarted = fallback.streamStarted
    const readCurrentAccessSettings = source.readCurrentAccessSettings
    const isSelectionPolicyCurrent = source.isSelectionPolicyCurrent
    const safety: AdmissionSafety = {
      // Selection is captured; the original caller's authority may only revoke it.
      currentSettings: () => readCurrentAccessSettings ? readCurrentAccessSettings() : source.settings,
      fallbackPolicyUnchanged: () => {
        try {
          return JSON.stringify(source.policy) === policy
            && JSON.stringify(source.routingPlan) === routingPlan
            && source.allowFallback === input.allowFallback
            && source.targetCredentialGroupId === input.targetCredentialGroupId
            && fallback.fallbackUsed === fallbackUsed
            && fallback.continuationBound === continuationBound
            && fallback.streamStarted === streamStarted
            && (isSelectionPolicyCurrent?.() ?? true)
        } catch {
          return false
        }
      },
    }
    return { input, safety }
  }

  function throwIfCancelled(signal: AbortSignal): void {
    if (!signal.aborted) return
    const error = new Error('Provider admission was cancelled.')
    error.name = 'AbortError'
    throw error
  }

  function isCancelled(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted || error instanceof Error && error.name === 'AbortError'
  }

  function accessAllowed(provider: AIProvider, model: string, input: ProviderChatResolutionInput, safety: AdmissionSafety): boolean {
    try {
      return dependencies.accessAllowed(provider, model, input.settings)
        && dependencies.accessAllowed(provider, model, safety.currentSettings())
    } catch {
      return false
    }
  }

  async function inspect(
    provider: AIProvider | undefined,
    model: string,
    input: ProviderChatResolutionInput,
    safety: AdmissionSafety,
    source?: ProviderCredentialSource,
  ): Promise<{ selection: ProviderChatSelection } | { reason: ProviderChatResolutionReason }> {
    throwIfCancelled(input.signal)
    if (!provider?.enabled) return { reason: 'disabled_provider' }
    if (!accessAllowed(provider, model, input, safety)) return { reason: 'policy_blocked' }
    throwIfCancelled(input.signal)
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
    hydrated = snapshotPlainData(hydrated)
    const identity = snapshotPlainData(dependencies.resolveIdentity(hydrated, model, hydrated.apiKeySource ?? { kind: 'none' }))
    // Capability evidence comes from the existing manifest/compatibility builder,
    // never from availability or from the mere presence of a cached model ID.
    const projected = dependencies.buildCandidates({ providers: [{ ...hydrated, models: [model] }], original: identity,
      requiredCapabilities: [...(input.requiredCapabilities ?? ['text'])], maxModelsPerProvider: 1 })
    if (!projected.candidates.length) return { reason: 'policy_blocked' }
    throwIfCancelled(input.signal)
    const current = snapshotPlainData(await dependencies.getAvailability(identity))
    throwIfCancelled(input.signal)
    if (isProviderModelAvailabilityBlocked(current.availability)) return { reason: 'model_unavailable' }
    const healthy = await dependencies.healthAllows(identity)
    throwIfCancelled(input.signal)
    if (!healthy) return { reason: 'provider_cooldown' }
    // Admission may await SQL/health reads; policy changes during those reads
    // must not authorize a route under an earlier settings snapshot.
    if (!accessAllowed(provider, model, input, safety)) return { reason: 'policy_blocked' }
    throwIfCancelled(input.signal)
    return { selection: { provider: hydrated, model, constraint: { identity, scope: current.scope, fallbackUsed: false, requestedModel: model,
      ...(input.routingPlan ? { routingPlan: input.routingPlan } : {}),
      ...(input.providers === undefined ? {} : { providerCatalog: input.providers }) } } }
  }

  function emptyFallback(input: ProviderChatFallbackInput) {
    const candidates: ProviderFallbackCandidateBuildResult = {
      schema: PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA, candidates: [], rejectedCandidates: [],
      evidence: { providerCount: 0, modelCount: 0, credentialGroupCount: 0,
        requiredCapabilities: [...(input.requiredCapabilities ?? ['text'])] },
    }
    const decision = resolveLocalProviderRoute({ original: input.original, candidates: [], trigger: input.trigger,
      policy: { mode: 'off', allowAfterStreamStart: false, maxCandidates: 8, maxFailovers: 0 } }).decision
    return { decision, candidates, selections: new Map<string, ProviderChatSelection>() }
  }

  async function evaluateFallback(input: ProviderChatFallbackInput, safety: AdmissionSafety, confirmedRoute?: ProviderFailoverRoute) {
    throwIfCancelled(input.signal)
    if (!safety.fallbackPolicyUnchanged()) return { ...emptyFallback(input), policyChanged: true }
    const checkConfiguration = dependencies.captureConfiguration?.()
    checkConfiguration?.()
    throwIfCancelled(input.signal)
    const providers = snapshotPlainData(await dependencies.readProviders(input.signal,
      input.providers === undefined ? undefined : { providers: input.providers }))
    throwIfCancelled(input.signal)
    const healthRecords = snapshotPlainData(await dependencies.loadHealthRecords())
    throwIfCancelled(input.signal)
    const plan = input.routingPlan
    if (plan && (!normalizeModelRoutingPlan(plan) || plan.mode === 'fixed')) return { ...emptyFallback(input), policyChanged: false }
    // Build the exact requested backup first, including aliases beyond catalog
    // pagination. Other models on the same connection never become candidates.
    const targets = plan ? plan.mode === 'group' ? modelRoutingPlanTargets(plan) : [plan.backup!] : []
    const backupProviders = plan ? targets.flatMap(target => {
      const provider = providers.find(item => item.id === target.providerId)
      return provider ? [{ ...provider, models: [target.model] }] : []
    }) : [...providers]
    const built = snapshotPlainData(dependencies.buildCandidates({ providers: backupProviders, original: input.original,
      requiredCapabilities: [...(input.requiredCapabilities ?? ['text'])], healthRecords,
      ...(plan ? { maxModelsPerProvider: 1 } : {}) }))
    const candidates: ProviderFallbackCandidateBuildResult = { ...built, candidates: [] }
    const selections = new Map<string, ProviderChatSelection>()
    // Preserve Chat's existing candidate ceiling. No second pass can replenish it.
    const bounded = built.candidates.filter(candidate => !plan || targets.some(target => sameModelRoute(candidate, target)))
      .sort((a, b) => compareProviderFailoverCandidates(input.original, a, b)).slice(0, 8)
    const onlineProviders = new Map<string, boolean>()
    for (const candidate of bounded) {
      throwIfCancelled(input.signal)
      if (input.targetCredentialGroupId !== undefined && (candidate.providerId !== input.preferred.providerId
        || candidate.credentialSource?.kind !== 'group' || candidate.credentialSource.groupId !== input.targetCredentialGroupId)) continue
      const provider = providers.find((item) => item.id === candidate.providerId)
      if (!provider) continue
      if (!onlineProviders.has(provider.id)) onlineProviders.set(provider.id, await dependencies.isOnline(provider))
      throwIfCancelled(input.signal)
      if (!onlineProviders.get(provider.id)) continue
      const checked = await inspect(provider, candidate.model, input, safety, candidate.credentialSource)
      if (!('selection' in checked)) continue
      if (plan?.mode === 'group' && checked.selection.constraint.identity.model !== plan.group!.model) continue
      if (input.requiredProtocolAdapterId && checked.selection.constraint.identity.protocolAdapterId !== input.requiredProtocolAdapterId) continue
      const route = { ...candidate, ...checked.selection.constraint.identity }
      candidates.candidates.push(route)
      selections.set(providerFailoverRouteIdentityKey(route), checked.selection)
    }
    const policy = {
      mode: 'ask-before-cross-provider' as const, ...(plan ? routingPlanPolicy(plan, input.policy) : input.policy),
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
    throwIfCancelled(input.signal)
    return safety.fallbackPolicyUnchanged()
      ? { decision: routed.decision, candidates, selections, policyChanged: false }
      : { ...emptyFallback(input), policyChanged: true }
  }

  async function resolveCapturedFallback(input: ProviderChatFallbackInput, safety: AdmissionSafety) {
    let result = await evaluateFallback(input, safety)
    let reason: ProviderChatResolutionReason | undefined
    if (result.policyChanged) reason = 'policy_blocked'
    const confirmation = result.decision.requiresUserConfirmation
      && result.decision.blockedReasons.every((item) => item === 'cross_provider_confirmation_required')
      ? snapshotPlainData(result.decision.acceptedCandidates[0]) : undefined
    if (confirmation) {
      const before = result.selections.get(providerFailoverRouteIdentityKey(confirmation))
      if (!input.signal.aborted && input.confirmFallback && await input.confirmFallback(confirmation, input.signal)) {
        // Re-read configuration, keys, access, capabilities, availability epoch and
        // route policy. Consent is never transferred to a newly selected route.
        result = await evaluateFallback(input, safety, confirmation)
        const after = result.selections.get(providerFailoverRouteIdentityKey(confirmation))
        if (!before || !after || before.constraint.scope.scopeId !== after.constraint.scope.scopeId
          || before.constraint.scope.epoch !== after.constraint.scope.epoch
          || before.provider.apiKey !== after.provider.apiKey || !result.decision.selected
          || providerFailoverRouteIdentityKey(result.decision.selected) !== providerFailoverRouteIdentityKey(confirmation)) reason = 'candidate_changed'
      } else reason = 'confirmation_declined'
    }
    throwIfCancelled(input.signal)
    const selected = result.decision.selected
    const candidate = selected ? result.selections.get(providerFailoverRouteIdentityKey(selected)) : undefined
    if (!await dependencies.isOnline(candidate?.provider)) reason = 'offline'
    throwIfCancelled(input.signal)
    if (!safety.fallbackPolicyUnchanged()
      || candidate && !accessAllowed(candidate.provider, candidate.model, input, safety)) reason = 'policy_blocked'
    throwIfCancelled(input.signal)
    const selection = !reason && selected ? result.selections.get(providerFailoverRouteIdentityKey(selected)) : undefined
    return { decision: result.decision, candidates: result.candidates,
      ...(selection ? { selection: { ...selection, constraint: { ...selection.constraint, fallbackUsed: true } } } : {}),
      ...(reason ? { reason } : {}),
    }
  }

  async function resolveFallback(source: ProviderChatFallbackInput) {
    const captured = captureInput(source)
    const input = { ...captured.input, original: snapshotPlainData(source.original) }
    try {
      return await resolveCapturedFallback(input, captured.safety)
    } catch (error) {
      if (!isCancelled(error, input.signal)) throw error
      const { decision, candidates } = emptyFallback(input)
      return { decision, candidates, reason: 'offline' as const }
    }
  }

  async function resolvePreferred(source: ProviderChatResolutionInput) {
    const { input, safety } = captureInput(source)
    if (input.routingPlan && (!normalizeModelRoutingPlan(input.routingPlan) || !isModelRoutingPlanTarget(input.routingPlan, input.preferred))) return { kind: 'blocked' as const, reason: 'policy_blocked' as const }
    if (input.signal.aborted) return { kind: 'cancelled' as const }
    if (!safety.fallbackPolicyUnchanged()) return { kind: 'blocked' as const, reason: 'policy_blocked' as const }
    try {
      if (!safety.fallbackPolicyUnchanged()) return { kind: 'blocked' as const, reason: 'policy_blocked' as const }
      const checkConfiguration = dependencies.captureConfiguration?.()
      checkConfiguration?.()
      throwIfCancelled(input.signal)
      const providers = snapshotPlainData(await dependencies.readProviders(input.signal,
        input.providers === undefined ? undefined : { providers: input.providers }))
      throwIfCancelled(input.signal)
      if (input.routingPlan?.mode === 'group') {
        const result = await selectGroup(input, providers, {
          inspect: (provider, model, source) => inspect(provider, model, input, safety, source),
          unchanged: safety.fallbackPolicyUnchanged, checkConfiguration: () => checkConfiguration?.(),
        })
        let accepted = false
        try {
          throwIfCancelled(input.signal)
          if (result.kind === 'blocked') return result
          if (!safety.fallbackPolicyUnchanged()
            || !accessAllowed(result.selection.provider, result.selection.model, input, safety)) {
            return { kind: 'blocked' as const, reason: 'policy_blocked' as const }
          }
          throwIfCancelled(input.signal)
          accepted = true
          return { kind: 'ready' as const, selection: result.selection }
        } finally {
          if (result.kind === 'ready') result.complete(accepted)
        }
      }
      const provider = providers.find((item) => item.id === input.preferred.providerId)
      const online = await dependencies.isOnline(provider)
      throwIfCancelled(input.signal)
      if (!online) return { kind: 'blocked' as const, reason: 'offline' as const }
      const checked = await inspect(provider, input.preferred.model, input, safety)
      checkConfiguration?.()
      if (input.signal.aborted) return { kind: 'cancelled' as const }
      if ('selection' in checked) {
        if (!safety.fallbackPolicyUnchanged()
          || !accessAllowed(checked.selection.provider, checked.selection.model, input, safety)) {
          return { kind: 'blocked' as const, reason: 'policy_blocked' as const }
        }
        throwIfCancelled(input.signal)
        return { kind: 'ready' as const, selection: checked.selection }
      }
      // Policy/configuration/credential failures do not become lifecycle evidence.
      const trigger = checked.reason === 'missing_key' ? 'credential_unhealthy'
        : checked.reason === 'provider_cooldown' ? 'provider_cooldown' : 'model_unavailable'
      const fallback = await resolveCapturedFallback({ ...input, trigger,
        original: { ...input.preferred, ...(provider ? { region: provider.tokenPlanRegion } : {}) } }, safety)
      if (input.signal.aborted) return { kind: 'cancelled' as const }
      return fallback.selection ? { kind: 'ready' as const, selection: fallback.selection }
        : { kind: 'blocked' as const, reason: fallback.reason ?? checked.reason }
    } catch (error) {
      if (isCancelled(error, input.signal)) return { kind: 'cancelled' as const }
      throw error
    }
  }

  async function revalidate(constraint: ProviderChatExecutionConstraint, source: ProviderChatResolutionInput) {
    constraint = snapshotPlainData(constraint)
    const captured = captureInput(source)
    const input = { ...captured.input, routingPlan: constraint.routingPlan ?? captured.input.routingPlan, providers: constraint.providerCatalog ?? captured.input.providers }
    const { safety } = captured
    if (input.signal.aborted || !safety.fallbackPolicyUnchanged()) return undefined
    try {
      const checkConfiguration = dependencies.captureConfiguration?.()
      checkConfiguration?.()
      throwIfCancelled(input.signal)
      const providers = snapshotPlainData(await dependencies.readProviders(input.signal,
        { providers: input.providers, providerId: constraint.identity.providerId }))
      throwIfCancelled(input.signal)
      const provider = providers.find((item) => item.id === constraint.identity.providerId)
      if (!await dependencies.isOnline(provider)) return undefined
      throwIfCancelled(input.signal)
      const checkCurrentAdmission = dependencies.captureDispatchValidation?.(constraint, input)
      checkCurrentAdmission?.()
      const checked = await inspect(provider, constraint.requestedModel ?? input.preferred.model, input, safety, constraint.identity.credentialSource)
      checkConfiguration?.()
      if (!('selection' in checked) || input.signal.aborted || !safety.fallbackPolicyUnchanged()
        || !accessAllowed(checked.selection.provider, checked.selection.model, input, safety)) return undefined
      throwIfCancelled(input.signal)
      const actual = checked.selection.constraint
      if (input.routingPlan?.mode === 'group' && (!isModelRoutingPlanTarget(input.routingPlan, { providerId: actual.identity.providerId, model: checked.selection.model })
        || actual.identity.model !== input.routingPlan.group!.model)) return undefined
      if (providerExecutionIdentityKey(actual.identity) !== providerExecutionIdentityKey(constraint.identity)
        || actual.scope.scopeId !== constraint.scope.scopeId || actual.scope.epoch !== constraint.scope.epoch) return undefined
      checkCurrentAdmission?.()
      return { ...checked.selection, constraint, ...(checkCurrentAdmission ? { checkCurrentAdmission } : {}) }
    } catch (error) {
      if (isCancelled(error, input.signal)) return undefined
      throw error
    }
  }

  return { resolvePreferred, resolveFallback, revalidate }
}
