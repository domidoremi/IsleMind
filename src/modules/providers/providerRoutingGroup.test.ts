import { isModelRoutingPlanTarget, normalizeModelRoutingPlan, type ModelRoutingPlan } from '@/core/modelRoutingPlan'
import type { AIProvider } from '@/types/providerContracts'
import { createProviderChatResolutionRuntime } from './providerChatResolution'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import { createProviderHealthRecord, indexProviderHealthRecords, type ProviderHealthRecord } from './providerHealth'
import { isProviderModelEnabled } from './providerModelSelection'
import { resolveProviderModelAlias } from '@/utils/providerModels'

const plan: ModelRoutingPlan = {
  schema: 'islemind.model-routing-plan.v1', id: 'shared-model', name: 'Shared model', mode: 'group',
  primary: { providerId: 'a', model: 'same-model' }, crossProvider: 'allow',
  group: { model: 'same-model', strategy: 'round-robin', members: [
    { providerId: 'a', model: 'same-model' }, { providerId: 'b', model: 'alias' }, { providerId: 'c', model: 'same-model' },
  ] },
}

function fixture() {
  const providers: AIProvider[] = ['a', 'b', 'c', 'unlisted'].map(id => ({ id, name: id, type: 'openai', enabled: true,
    apiKey: '', models: ['same-model'], enabledModels: [id === 'b' ? 'alias' : 'same-model'],
    ...(id === 'b' ? { modelAliases: [{ alias: 'alias', model: 'same-model' }] } : {}),
    credentialGroups: [1, 2].map(index => ({ id: `${id}-${index}`, label: `Key ${index}`, enabled: true,
      apiKey: `fixture-${id}-${index}`, availableModels: ['same-model'] })),
  }))
  const health: ProviderHealthRecord[] = []
  const unavailable = new Set<string>()
  const runtime = createProviderChatResolutionRuntime({
    readProviders: async () => providers, isOnline: async () => true,
    buildCandidates: createProviderFallbackCandidateBuilder({ projectModel: (provider, model) => ({
      deprecated: false, upstreamModel: resolveProviderModelAlias(provider, model), capabilities: ['text'],
    }) }),
    loadHealthRecords: async () => indexProviderHealthRecords(health), configurationValid: () => true,
    accessAllowed: (provider, model, settings) => isProviderModelEnabled(provider, model) && !settings?.modelBlocklist?.includes(model),
    resolveIdentity: (provider, model, credentialSource) => ({ providerId: provider.id, model: resolveProviderModelAlias(provider, model),
      credentialSource, protocolAdapterId: 'openai-chat', endpointVariant: 'native' }),
    getAvailability: async identity => ({ scope: { scopeId: identity.providerId, epoch: 'epoch' }, availability: unavailable.has(identity.providerId) ? 'unavailable' : 'unknown' }),
    healthAllows: async () => true,
  })
  const request = (routingPlan: ModelRoutingPlan = structuredClone(plan)) => ({ preferred: routingPlan.primary, routingPlan, signal: new AbortController().signal })
  return { providers, health, unavailable, runtime, request }
}

it('copies only bounded group identities and accepts a surviving member as the conversation preference', () => {
  const normalized = normalizeModelRoutingPlan({ ...plan, group: { ...plan.group, token: 'must-not-survive', members: plan.group!.members.map(member => ({ ...member, apiKey: 'secret' })) } })!
  expect(normalized).toEqual(plan)
  expect(normalized.group!.members).not.toBe(plan.group!.members)
  expect(isModelRoutingPlanTarget(normalized, { providerId: 'b', model: 'alias' })).toBe(true)
  expect(isModelRoutingPlanTarget(normalized, { providerId: 'unlisted', model: 'same-model' })).toBe(false)
  for (const group of [{ ...plan.group, members: [] }, { ...plan.group, strategy: 'random' },
    { ...plan.group, members: [plan.primary, plan.primary] }, { ...plan.group, model: ' ' },
    { ...plan.group, members: Array.from({ length: 65 }, (_, index) => ({ providerId: String(index), model: 'same-model' })) }]) {
    expect(normalizeModelRoutingPlan({ ...plan, group })).toBeUndefined()
  }
})

it('allocates concurrent requests in order and revalidates the actual alias without advancing rotation', async () => {
  const f = fixture()
  const results = await Promise.all(Array.from({ length: 6 }, () => f.runtime.resolvePreferred(f.request())))
  expect(results.map(result => result.kind === 'ready' && result.selection.provider.id)).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  const second = results[1]
  if (second.kind !== 'ready') throw Error('blocked')
  expect(second.selection).toMatchObject({ model: 'alias', constraint: { requestedModel: 'alias', fallbackUsed: false, identity: { model: 'same-model' } } })
  expect((await f.runtime.revalidate(second.selection.constraint, f.request()))?.model).toBe('alias')
  const next = await f.runtime.resolvePreferred(f.request())
  expect(next.kind === 'ready' && next.selection.provider.id).toBe('a')
})

it('honors member order and each connection’s preferred key', async () => {
  const f = fixture()
  f.providers[0].credentialSelection = { strategy: 'balanced', preferredGroupId: 'a-2' }
  const priority = { ...plan, group: { ...plan.group!, strategy: 'priority' as const } }
  const first = await f.runtime.resolvePreferred(f.request(priority))
  expect(first.kind === 'ready' && first.selection.constraint.identity.credentialSource).toEqual({ kind: 'group', groupId: 'a-2' })
  f.providers[0].credentialGroups!.forEach(key => { key.enabled = false })
  const second = await f.runtime.resolvePreferred(f.request(priority))
  expect(second.kind === 'ready' && second.selection.provider.id).toBe('b')
})

it('ranks healthy members above unknown members without treating unrelated providers as group members', async () => {
  const f = fixture()
  f.health.push({ ...createProviderHealthRecord({ providerId: 'b', model: 'same-model', credentialGroupId: 'b-1' }), status: 'healthy', successes: 10, averageLatencyMs: 50 })
  const result = await f.runtime.resolvePreferred(f.request({ ...plan, group: { ...plan.group!, strategy: 'health-first' } }))
  expect(result.kind === 'ready' && result.selection.provider.id).toBe('b')
})

it('skips disabled, unselected and retargeted members while preserving the saved membership', async () => {
  const f = fixture()
  f.providers[0].enabled = false
  f.providers[1].modelAliases![0].model = 'different-model'
  const result = await f.runtime.resolvePreferred(f.request())
  expect(result.kind === 'ready' && result.selection.provider.id).toBe('c')
  f.providers[2].enabledModels = []
  expect((await f.runtime.resolvePreferred(f.request())).kind).toBe('blocked')
  expect(f.request().routingPlan.group!.members).toHaveLength(3)
})

it('keeps an explicit key target on its provider and rejects missing key targets', async () => {
  const f = fixture()
  for (let i = 0; i < 3; i++) {
    const result = await f.runtime.resolvePreferred({ ...f.request(), targetCredentialGroupId: 'a-2' })
    expect(result.kind === 'ready' && result.selection.constraint.identity).toMatchObject({ providerId: 'a', credentialSource: { groupId: 'a-2' } })
  }
  expect((await f.runtime.resolvePreferred({ ...f.request(), targetCredentialGroupId: 'b-1' })).kind).toBe('blocked')
})

it('rotates across admitted members when an earlier member is unavailable', async () => {
  const f = fixture(); f.unavailable.add('a')
  const selected = []
  for (let index = 0; index < 4; index++) {
    const result = await f.runtime.resolvePreferred(f.request())
    selected.push(result.kind === 'ready' && result.selection.provider.id)
  }
  expect(selected).toEqual(['b', 'c', 'b', 'c'])
})

it('skips a cooled-down preferred key while retaining the healthy key on that member', async () => {
  const f = fixture()
  f.providers[0].credentialSelection = { strategy: 'balanced', preferredGroupId: 'a-1' }
  f.health.push({ ...createProviderHealthRecord({ providerId: 'a', model: 'same-model', credentialGroupId: 'a-1' }),
    status: 'cooldown', cooldownUntilMs: Date.now() + 60_000 })
  const result = await f.runtime.resolvePreferred(f.request({ ...plan, group: { ...plan.group!, strategy: 'priority' } }))
  expect(result.kind === 'ready' && result.selection.constraint.identity).toMatchObject({ providerId: 'a', credentialSource: { groupId: 'a-2' } })
})

it('does not turn denied cross-provider restrictions into group authorization', async () => {
  for (const policy of [{ mode: 'off' as const }, { mode: 'same-provider' as const }, { mode: 'approved-providers' as const, approvedProviderIds: [] }, { explicitModelLock: true }]) {
    const f = fixture(); f.providers[0].enabled = false
    expect((await f.runtime.resolvePreferred({ ...f.request(), policy })).kind).toBe('blocked')
  }
  const f = fixture(); f.providers[0].enabled = false
  expect((await f.runtime.resolvePreferred({ ...f.request(), allowFallback: false })).kind).toBe('blocked')
})

it('asks for the exact selected member and retains the fallback budget after an ordinary allocation', async () => {
  const f = fixture(); f.providers[0].enabled = false
  const confirmFallback = jest.fn(async () => true)
  const result = await f.runtime.resolvePreferred({ ...f.request({ ...plan, crossProvider: 'ask' }), confirmFallback })
  expect(confirmFallback).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'b', model: 'same-model', credentialSource: { kind: 'group', groupId: 'b-1' } }), expect.anything())
  expect(result.kind === 'ready' && result.selection.constraint.fallbackUsed).toBe(false)
  const denied = await f.runtime.resolvePreferred({ ...f.request({ ...plan, crossProvider: 'ask' }), confirmFallback: async () => false })
  expect(denied).toMatchObject({ kind: 'blocked', reason: 'confirmation_declined' })
})

it.each(['key', 'alias', 'plan', 'cancel'] as const)('rejects %s changes while awaiting member consent', async change => {
  const f = fixture(); f.providers[0].enabled = false
  const mutable = structuredClone({ ...plan, crossProvider: 'ask' as const })
  const controller = new AbortController()
  const result = await f.runtime.resolvePreferred({ ...f.request(mutable), signal: controller.signal, confirmFallback: async () => {
    if (change === 'key') f.providers[1].credentialGroups![0].apiKey = 'changed-key'
    if (change === 'alias') f.providers[1].modelAliases![0].model = 'changed-model'
    if (change === 'plan') mutable.group!.members.pop()
    if (change === 'cancel') controller.abort()
    return true
  } })
  expect(result.kind).toBe(change === 'cancel' ? 'cancelled' : 'blocked')
})

it('limits fallback to group members and preserves stream, continuation and one-fallback fences', async () => {
  const f = fixture()
  const first = await f.runtime.resolvePreferred(f.request())
  if (first.kind !== 'ready') throw Error('blocked')
  f.providers[0].enabled = false
  const input = { ...f.request(), original: first.selection.constraint.identity, trigger: 'timeout' as const }
  const fallback = await f.runtime.resolveFallback(input)
  expect(fallback.selection?.provider.id).toBe('b')
  expect(fallback.selection?.constraint.fallbackUsed).toBe(true)
  for (const extra of [{ streamStarted: true }, { continuationBound: true }, { fallbackUsed: true }, { allowFallback: false }]) {
    expect((await f.runtime.resolveFallback({ ...input, ...extra })).selection).toBeUndefined()
  }
  f.providers[1].enabled = false; f.providers[2].enabled = false
  expect((await f.runtime.resolveFallback(input)).selection).toBeUndefined()
})
