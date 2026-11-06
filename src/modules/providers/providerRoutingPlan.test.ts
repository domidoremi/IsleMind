import { normalizeModelRoutingPlan, normalizeModelRoutingPlans, type ModelRoutingPlan } from '@/core/modelRoutingPlan'
import { createProviderChatResolutionRuntime } from './providerChatResolution'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import type { AIProvider } from '@/types/providerContracts'
import { routingPlanPolicy } from './providerRoutingPlan'

const plan: ModelRoutingPlan = {
  schema: 'islemind.model-routing-plan.v1', id: 'stable', name: 'Stable', mode: 'fallback',
  primary: { providerId: 'a', model: 'one' }, backup: { providerId: 'b', model: 'alias' }, crossProvider: 'ask',
}
function fixture() {
  const providers: AIProvider[] = ['a', 'b', 'unlisted'].map(id => ({
    id, name: id, type: 'openai', enabled: true, apiKey: `fixture-${id}`, models: ['one', 'other'],
  }))
  providers[1].modelAliases = [{ alias: 'alias', model: 'two' }]
  const unavailable = new Set<string>()
  const runtime = createProviderChatResolutionRuntime({
    readProviders: async () => providers,
    isOnline: async () => true,
    buildCandidates: createProviderFallbackCandidateBuilder({ projectModel: (_provider, model) => ({
      deprecated: false, upstreamModel: model === 'alias' ? 'two' : model, capabilities: ['text'],
    }) }),
    loadHealthRecords: async () => ({}), configurationValid: () => true,
    accessAllowed: (_provider, model, settings) => !settings?.modelBlocklist?.includes(model),
    resolveIdentity: (provider, model, credentialSource) => ({ providerId: provider.id, model: model === 'alias' ? 'two' : model,
      credentialSource, protocolAdapterId: 'openai-chat', endpointVariant: 'native' }),
    getAvailability: async identity => ({ scope: { scopeId: identity.providerId, epoch: 'epoch' }, availability: unavailable.has(`${identity.providerId}:${identity.model}`) ? 'unavailable' : 'unknown' }),
    healthAllows: async () => true,
  })
  const request = (routingPlan = plan) => ({ preferred: routingPlan.primary, routingPlan, signal: new AbortController().signal })
  return { runtime, providers, unavailable, request }
}

it('validates bounded plans and copies only reference fields without credentials', () => {
  const normalized = normalizeModelRoutingPlan({ ...plan, apiKey: 'must-not-survive', backup: { ...plan.backup, token: 'secret' } })!
  expect(normalized).toEqual(plan)
  expect(normalized.primary).not.toBe(plan.primary)
  for (const invalid of [{ ...plan, schema: 'v99' }, { ...plan, backup: plan.primary }, { ...plan, backup: undefined }, { ...plan, crossProvider: 'auto' }]) {
    expect(normalizeModelRoutingPlan(invalid)).toBeUndefined()
    expect(() => normalizeModelRoutingPlans([invalid])).toThrow()
  }
  expect(() => normalizeModelRoutingPlans([plan, plan])).toThrow()
})

it('retains the selected plan snapshot on preferred admission and revalidation', async () => {
  const f = fixture()
  const result = await f.runtime.resolvePreferred(f.request())
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw Error('blocked')
  expect(result.selection.constraint.routingPlan).toEqual(plan)
  expect(result.selection.constraint.routingPlan).not.toBe(plan)
  expect(await f.runtime.revalidate(result.selection.constraint, { ...f.request(), routingPlan: undefined })).toBeDefined()
})

it('limits fallback to the requested alias even beyond catalog samples and ignores same-provider alternatives', async () => {
  const f = fixture()
  f.providers[1].models = Array.from({ length: 100 }, (_, index) => `other-${index}`)
  f.unavailable.add('a:one')
  const confirmFallback = jest.fn(async () => true)
  const result = await f.runtime.resolvePreferred({ ...f.request(), confirmFallback })
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw Error('blocked')
  expect(result.selection).toMatchObject({ provider: { id: 'b' }, model: 'alias', constraint: { identity: { model: 'two' }, fallbackUsed: true, routingPlan: plan } })
  expect(confirmFallback).toHaveBeenCalledTimes(1)
})

it('honors saved cross-connection consent while preserving global model access', async () => {
  const f = fixture()
  f.unavailable.add('a:one')
  const approved = { ...plan, crossProvider: 'allow' as const }
  expect((await f.runtime.resolvePreferred(f.request(approved))).kind).toBe('ready')
  const result = await f.runtime.resolvePreferred({ ...f.request(approved), settings: { modelBlocklist: ['alias'] } })
  expect(result.kind).toBe('blocked')
  expect(routingPlanPolicy(approved)).toMatchObject({ mode: 'approved-providers', approvedProviderIds: ['b'] })
  expect(routingPlanPolicy(plan, { mode: 'approved-providers', approvedProviderIds: ['b'] }).mode).toBe('ask-before-cross-provider')
  expect(routingPlanPolicy(plan, { mode: 'approved-providers', approvedProviderIds: [] }).mode).toBe('approved-providers')
  expect(routingPlanPolicy(plan, { mode: 'off' }).mode).toBe('off')
})

it('does not route elsewhere when the configured backup is missing, disabled, or unavailable', async () => {
  for (const reason of ['missing', 'disabled', 'unavailable'] as const) {
    const f = fixture(); f.unavailable.add('a:one')
    if (reason === 'missing') f.providers.splice(1, 1)
    if (reason === 'disabled') f.providers[1].enabled = false
    if (reason === 'unavailable') f.unavailable.add('b:two')
    expect((await f.runtime.resolvePreferred(f.request({ ...plan, crossProvider: 'allow' }))).kind).toBe('blocked')
  }
})

it('never widens fixed plans or permits switching during output, continuation, or after the fallback budget', async () => {
  const f = fixture()
  for (const extra of [{ routingPlan: { ...plan, mode: 'fixed' as const } }, { streamStarted: true }, { continuationBound: true }, { fallbackUsed: true }, { allowFallback: false }, { requiredCapabilities: ['image'] }]) {
    const result = await f.runtime.resolveFallback({ ...f.request({ ...plan, crossProvider: 'allow' }), original: plan.primary, trigger: 'timeout', ...extra })
    expect(result.selection).toBeUndefined()
  }
})

it('revokes pending consent when its route plan changes, and rejects malformed or mismatched plans', async () => {
  const f = fixture(); f.unavailable.add('a:one')
  const mutable = structuredClone(plan)
  expect((await f.runtime.resolvePreferred({ ...f.request(mutable), confirmFallback: async () => {
    mutable.backup = { providerId: 'unlisted', model: 'one' }; return true
  } })).kind).toBe('blocked')
  for (const invalid of [{ ...plan, primary: { providerId: 'a', model: 'other' } }, { ...plan, backup: undefined }]) {
    expect((await f.runtime.resolvePreferred({ ...f.request(), routingPlan: invalid })).kind).toBe('blocked')
  }
})

it('returns to the primary on the next independent turn', async () => {
  const f = fixture(); f.unavailable.add('a:one')
  const first = await f.runtime.resolvePreferred(f.request({ ...plan, crossProvider: 'allow' }))
  expect(first.kind === 'ready' && first.selection.provider.id).toBe('b')
  f.unavailable.clear()
  const next = await f.runtime.resolvePreferred(f.request())
  expect(next.kind === 'ready' && next.selection.provider.id).toBe('a')
})
