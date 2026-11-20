import { snapshotPlainData } from '@/core'
import { modelRoutingPlanTargets, sameModelRoute, type ModelRoutingPlan } from '@/core/modelRoutingPlan'
import type { AIProvider, ProviderCredentialSource } from '@/types/providerContracts'
import type { ProviderChatResolutionDependencies, ProviderChatResolutionInput, ProviderChatResolutionReason, ProviderChatSelection } from './providerChatResolutionContracts'
import { chooseCredentialForModel } from './providerCredentialGroups'
import { providerExecutionIdentityKey } from './providerExecutionTarget'
import { resolveFailoverDecision, type ProviderFailoverCandidate } from './providerFailoverPolicy'
import { routingPlanPolicy } from './providerRoutingPlan'
import { annotateFailoverCandidatesWithHealth } from './providerHealth'

interface GroupSelectionPorts {
  inspect(provider: AIProvider, model: string, source: ProviderCredentialSource): Promise<{ selection: ProviderChatSelection } | { reason: ProviderChatResolutionReason }>
  unchanged(): boolean
  checkConfiguration(): void
}

type GroupSelectionResult = { kind: 'ready'; selection: ProviderChatSelection; complete(accepted: boolean): void }
  | { kind: 'blocked'; reason: ProviderChatResolutionReason }

/** Local allocation only. Revalidation and retries never advance this cursor. */
export function createProviderRoutingGroupSelector(dependencies: ProviderChatResolutionDependencies) {
  interface Reservation { offset: number; accepted?: boolean }
  interface Cursor { offset: number; reservations: Reservation[] }
  const cursors = new Map<string, Cursor>()
  function reserve(plan: ModelRoutingPlan, candidates: ProviderFailoverCandidate[]) {
    if (plan.group?.strategy !== 'round-robin' || !candidates.length) {
      return { ordered: candidates, complete: (_accepted: boolean) => {} }
    }
    const key = JSON.stringify([plan.id, plan.group])
    const cursor = cursors.get(key) ?? { offset: 0, reservations: [] }
    const reservation: Reservation = { offset: cursor.offset }
    const offset = cursor.offset % candidates.length
    cursor.offset++
    cursor.reservations.push(reservation)
    cursors.delete(key)
    cursors.set(key, cursor)
    if (cursors.size > 128) cursors.delete(cursors.keys().next().value!)
    let completed = false
    const complete = (accepted: boolean) => {
      if (completed) return
      completed = true
      reservation.accepted = accepted
      // Discard consecutive rejected reservations at the tail. An accepted
      // later request commits the order and cannot be undone by an older one.
      while (cursor.reservations.at(-1)?.accepted === false) {
        cursor.offset = cursor.reservations.pop()!.offset
      }
      for (let index = cursor.reservations.length - 1; index >= 0; index--) {
        if (cursor.reservations[index].accepted === true) {
          cursor.reservations.splice(0, index + 1)
          break
        }
      }
    }
    return { ordered: [...candidates.slice(offset), ...candidates.slice(0, offset)], complete }
  }
  return async function selectGroup(input: ProviderChatResolutionInput, providers: readonly AIProvider[], ports: GroupSelectionPorts): Promise<GroupSelectionResult> {
    const plan = input.routingPlan!
    const group = plan.group!
    const blocked = (reason: ProviderChatResolutionReason = 'policy_blocked'): GroupSelectionResult => ({ kind: 'blocked', reason })
    const current = () => !input.signal.aborted && ports.unchanged()
    const members = modelRoutingPlanTargets(plan)
    const healthRecords = snapshotPlainData(await dependencies.loadHealthRecords())
    if (!current()) return blocked()
    const built = dependencies.buildCandidates({
      providers: members.flatMap(member => {
        const provider = providers.find(item => item.id === member.providerId)
        return provider ? [{ ...provider, models: [member.model] }] : []
      }),
      original: input.preferred, healthRecords, requiredCapabilities: [...(input.requiredCapabilities ?? ['text'])], maxModelsPerProvider: 1,
    })
    // Provider strategy selects a connection. Its saved preferred key and key
    // rotation policy still select the credential; explicit key locks remain local.
    const candidates: ProviderFailoverCandidate[] = []
    const selections = new Map<string, ProviderChatSelection>()
    for (const member of members) {
      if (!current()) return blocked()
      const provider = providers.find(item => item.id === member.providerId)
      if (!provider?.enabled || input.targetCredentialGroupId !== undefined && provider.id !== input.preferred.providerId) continue
      if (input.allowFallback === false && !sameModelRoute(member, input.preferred)) continue
      if (!await dependencies.isOnline(provider)) continue
      const available = built.candidates.filter(item => sameModelRoute(item, member))
      const excluded: string[] = []
      // Remove revoked/unavailable keys before allocating a connection. The
      // connection keeps its saved key ordering among the surviving sources.
      for (let count = 0; count < available.length; count++) {
        if (!current()) return blocked()
        let source: ProviderCredentialSource
        try { source = chooseCredentialForModel(provider, member.model, { targetCredentialGroupId: input.targetCredentialGroupId, excludedCredentialGroupIds: excluded }).source }
        catch { break }
        const candidate = available.find(item => JSON.stringify(item.credentialSource) === JSON.stringify(source))
        if (source.kind === 'group') excluded.push(source.groupId)
        const health = candidate ? annotateFailoverCandidatesWithHealth([{ ...candidate, model: group.model }], healthRecords, Date.now())[0] : undefined
        if (candidate && health?.healthy !== false && !health?.cooldownActive) {
          const checked = await ports.inspect(provider, member.model, source)
          if ('selection' in checked && checked.selection.constraint.identity.model === group.model) {
            candidates.push({ ...candidate, ...health, model: member.model })
            selections.set(provider.id, checked.selection)
            break
          }
        }
        if (source.kind !== 'group' || input.targetCredentialGroupId !== undefined) break
      }
    }
    if (group.strategy === 'health-first') candidates.sort((a, b) =>
      (b.healthScore ?? 50) - (a.healthScore ?? 50)
      || (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER))
    ports.checkConfiguration()
    if (!current()) return blocked()
    const original = providers.find(provider => provider.id === input.preferred.providerId)
    const policy = routingPlanPolicy(plan, input.policy)
    const decisions = new Map<string, ReturnType<typeof resolveFailoverDecision>>()
    const eligible = candidates.filter(candidate => {
      if (sameModelRoute(candidate, input.preferred)) return true
      const selection = selections.get(candidate.providerId)!
      const decision = resolveFailoverDecision({ original: { ...input.preferred, region: original?.tokenPlanRegion },
        candidates: [{ ...candidate, ...selection.constraint.identity }], trigger: 'model_unavailable',
        requiredCapabilities: [...(input.requiredCapabilities ?? ['text'])],
        policy: { mode: 'ask-before-cross-provider', ...policy } })
      decisions.set(candidate.providerId, decision)
      return decision.eligible || decision.requiresUserConfirmation
    })
    const allocation = reserve(plan, eligible)
    let handedOff = false
    try {
      for (const candidate of allocation.ordered) {
        if (!current()) return blocked()
        const provider = providers.find(item => item.id === candidate.providerId)!
        const selection = selections.get(provider.id)!
        const route = { ...candidate, ...selection.constraint.identity }
        if (!sameModelRoute(candidate, input.preferred)) {
          const decision = decisions.get(candidate.providerId)!
          if (decision.requiresUserConfirmation) {
            if (!input.confirmFallback || !await input.confirmFallback(snapshotPlainData(route), input.signal)) return blocked('confirmation_declined')
            if (!current()) return blocked()
            const live = snapshotPlainData(await dependencies.readProviders(input.signal,
              input.providers === undefined ? undefined : { providers: input.providers }))
            const nextProvider = live.find(item => item.id === provider.id)
            if (!nextProvider) return blocked('candidate_changed')
            const next = await ports.inspect(nextProvider, candidate.model, candidate.credentialSource!)
            if (!('selection' in next) || !current()
              || next.selection.provider.apiKey !== selection.provider.apiKey
              || providerExecutionIdentityKey(next.selection.constraint.identity) !== providerExecutionIdentityKey(selection.constraint.identity)
              || next.selection.constraint.scope.scopeId !== selection.constraint.scope.scopeId
              || next.selection.constraint.scope.epoch !== selection.constraint.scope.epoch) return blocked('candidate_changed')
            ports.checkConfiguration()
            handedOff = true
            return { kind: 'ready', selection: next.selection, complete: allocation.complete }
          }
        }
        ports.checkConfiguration()
        if (!current()) return blocked()
        handedOff = true
        return { kind: 'ready', selection, complete: allocation.complete }
      }
      return blocked('model_unavailable')
    } finally {
      if (!handedOff) allocation.complete(false)
    }
  }
}
