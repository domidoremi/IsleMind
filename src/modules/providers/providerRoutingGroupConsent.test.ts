import type { ModelRoutingPlan } from '@/core/modelRoutingPlan'
import type { AIProvider } from '@/types/providerContracts'
import { createProviderChatResolutionRuntime } from './providerChatResolution'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import { isProviderModelEnabled } from './providerModelSelection'

function fixture() {
  const providers: AIProvider[] = ['a', 'b', 'c'].map(id => ({
    id, name: id, type: 'openai', enabled: id !== 'a', apiKey: '',
    models: ['same-model'], enabledModels: ['same-model'],
    credentialGroups: [{ id: id + '-1', label: id, enabled: true,
      apiKey: 'owned-consent-' + id, availableModels: ['same-model'] }],
  }))
  const plan: ModelRoutingPlan = {
    schema: 'islemind.model-routing-plan.v1', id: 'owned-consent', name: 'Owned consent',
    mode: 'group', primary: { providerId: 'a', model: 'same-model' }, crossProvider: 'ask',
    group: { model: 'same-model', strategy: 'round-robin',
      members: providers.map(provider => ({ providerId: provider.id, model: 'same-model' })) },
  }
  const runtime = createProviderChatResolutionRuntime({
    readProviders: async () => providers, isOnline: async () => true,
    buildCandidates: createProviderFallbackCandidateBuilder({
      projectModel: () => ({ deprecated: false, upstreamModel: 'same-model', capabilities: ['text'] }),
    }),
    loadHealthRecords: async () => ({}), configurationValid: () => true,
    accessAllowed: (provider, model) => isProviderModelEnabled(provider, model),
    resolveIdentity: (provider, model, credentialSource) => ({
      providerId: provider.id, model, credentialSource, protocolAdapterId: 'openai-chat', endpointVariant: 'native',
    }),
    getAvailability: async identity => ({
      scope: { scopeId: identity.providerId, epoch: 'owned-consent-epoch' }, availability: 'unknown',
    }),
    healthAllows: async () => true,
  })
  const request = () => ({
    preferred: plan.primary, routingPlan: plan, signal: new AbortController().signal,
  })
  return { providers, runtime, request }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

it.each(['decline', 'cancel', 'changed-key'] as const)(
  'retains the next round-robin member after %s during confirmation',
  async scenario => {
    const f = fixture()
    const controller = new AbortController()
    const confirmedProviders: string[] = []
    const originalKey = f.providers[1].credentialGroups![0].apiKey
    const result = await f.runtime.resolvePreferred({
      ...f.request(), signal: controller.signal,
      confirmFallback: async candidate => {
        confirmedProviders.push(candidate.providerId)
        if (scenario === 'cancel') controller.abort()
        if (scenario === 'changed-key') f.providers[1].credentialGroups![0].apiKey = 'owned-consent-changed'
        return scenario !== 'decline'
      },
    })
    expect(confirmedProviders).toEqual(['b'])
    expect(result).toMatchObject(scenario === 'cancel' ? { kind: 'cancelled' }
      : { kind: 'blocked', reason: scenario === 'decline' ? 'confirmation_declined' : 'candidate_changed' })
    f.providers[1].credentialGroups![0].apiKey = originalKey
    const next = await f.runtime.resolvePreferred({
      ...f.request(), confirmFallback: async candidate => {
        confirmedProviders.push(candidate.providerId)
        return true
      },
    })
    expect(next.kind === 'ready' && next.selection.provider.id).toBe('b')
    expect(confirmedProviders).toEqual(['b', 'b'])
  },
)

it('retains rotation after the confirmation callback rejects', async () => {
  const f = fixture()
  await expect(f.runtime.resolvePreferred({
    ...f.request(), confirmFallback: async () => { throw new Error('owned-confirmation-failure') },
  })).rejects.toThrow('owned-confirmation-failure')
  const next = await f.runtime.resolvePreferred({ ...f.request(), confirmFallback: async () => true })
  expect(next.kind === 'ready' && next.selection.provider.id).toBe('b')
})

it('keeps a later accepted allocation when an earlier confirmation is declined', async () => {
  const f = fixture()
  f.providers[0].enabled = true
  expect(await f.runtime.resolvePreferred(f.request())).toMatchObject({ kind: 'ready', selection: { provider: { id: 'a' } } })
  const enteredB = deferred<void>(), enteredC = deferred<void>()
  const decisionB = deferred<boolean>(), decisionC = deferred<boolean>()
  const confirmed: string[] = []
  const pendingB = f.runtime.resolvePreferred({ ...f.request(), confirmFallback: candidate => {
    confirmed.push(candidate.providerId); enteredB.resolve(); return decisionB.promise
  } })
  await enteredB.promise
  const pendingC = f.runtime.resolvePreferred({ ...f.request(), confirmFallback: candidate => {
    confirmed.push(candidate.providerId); enteredC.resolve(); return decisionC.promise
  } })
  await enteredC.promise
  expect(confirmed).toEqual(['b', 'c'])
  decisionC.resolve(true)
  expect(await pendingC).toMatchObject({ kind: 'ready', selection: { provider: { id: 'c' } } })
  decisionB.resolve(false)
  expect(await pendingB).toMatchObject({ kind: 'blocked', reason: 'confirmation_declined' })
  const next = await f.runtime.resolvePreferred(f.request())
  expect(next.kind === 'ready' && next.selection.provider.id).toBe('a')
})

it('releases both reservations when overlapping confirmations are declined in either order', async () => {
  for (const reverse of [false, true]) {
    const f = fixture()
    f.providers[0].enabled = true
    await f.runtime.resolvePreferred(f.request())
    const enteredB = deferred<void>(), enteredC = deferred<void>()
    const decisionB = deferred<boolean>(), decisionC = deferred<boolean>()
    const confirmed: string[] = []
    const pendingB = f.runtime.resolvePreferred({ ...f.request(), confirmFallback: candidate => {
      confirmed.push(candidate.providerId); enteredB.resolve(); return decisionB.promise
    } })
    await enteredB.promise
    const pendingC = f.runtime.resolvePreferred({ ...f.request(), confirmFallback: candidate => {
      confirmed.push(candidate.providerId); enteredC.resolve(); return decisionC.promise
    } })
    await enteredC.promise
    expect(confirmed).toEqual(['b', 'c'])
    if (reverse) { decisionC.resolve(false); await pendingC; decisionB.resolve(false); await pendingB }
    else { decisionB.resolve(false); await pendingB; decisionC.resolve(false); await pendingC }
    const next = await f.runtime.resolvePreferred({ ...f.request(), confirmFallback: async () => true })
    expect(next.kind === 'ready' && next.selection.provider.id).toBe('b')
  }
})

it('rotates only across members allowed by the cross-provider policy', async () => {
  const f = fixture()
  f.providers[0].enabled = true
  const selected: Array<string | false> = []
  for (let index = 0; index < 4; index++) {
    const result = await f.runtime.resolvePreferred({
      ...f.request(), policy: { mode: 'approved-providers', approvedProviderIds: ['c'] },
      confirmFallback: async () => true,
    })
    selected.push(result.kind === 'ready' && result.selection.provider.id)
  }
  expect(selected).toEqual(['a', 'c', 'a', 'c'])
})
