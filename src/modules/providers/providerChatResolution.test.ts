import type { AIProvider } from '@/types/providerContracts'
import { createProviderChatResolutionRuntime } from './providerChatResolution'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'

describe('preferred Chat route resolution', () => {
  function fixture() {
    const providers: AIProvider[] = ['a', 'b'].map((id) => ({ id, name: id, type: 'openai', enabled: true,
      models: ['one', 'two'], apiKey: `test-${id}`, apiKeySource: { kind: 'primary' },
    }))
    let epoch = 'epoch-1'
    let offline = false
    const unavailable = new Set<string>()
    const runtime = createProviderChatResolutionRuntime({
      readProviders: async () => providers,
      isOnline: async () => !offline,
      buildCandidates: createProviderFallbackCandidateBuilder({ projectModel: (_provider, model) => ({ deprecated: false, upstreamModel: model, capabilities: ['text'] }) }),
      loadHealthRecords: async () => ({}),
      configurationValid: (provider) => Boolean(provider.apiKey),
      accessAllowed: (_provider, model, settings) => !settings?.modelBlocklist?.includes(model),
      resolveIdentity: (provider, model, credentialSource) => ({ providerId: provider.id, model, credentialSource, protocolAdapterId: 'openai-chat', endpointVariant: 'native' }),
      getAvailability: async (identity) => ({ scope: { scopeId: `${identity.providerId}:primary`, epoch }, availability: unavailable.has(`${identity.providerId}:${identity.model}`) ? 'unavailable' : 'unknown' }),
      healthAllows: async () => true,
    })
    return { runtime, providers, unavailable, setEpoch: (value: string) => { epoch = value }, setOffline: () => { offline = true } }
  }
  const preferred = { providerId: 'a', model: 'one' }
  const request = () => ({ preferred, signal: new AbortController().signal, requiredCapabilities: ['text'] })

  it('admits unknown under existing policy and reconsiders preferred every independent turn', async () => {
    const f = fixture()
    const first = await f.runtime.resolvePreferred(request())
    expect(first.kind === 'ready' && first.selection.model).toBe('one')
    f.unavailable.add('a:one')
    const fallback = await f.runtime.resolvePreferred(request())
    expect(fallback.kind === 'ready' && fallback.selection.model).toBe('two')
    expect(fallback.kind === 'ready' && fallback.selection.constraint.fallbackUsed).toBe(true)
    f.unavailable.clear()
    const recovered = await f.runtime.resolvePreferred(request())
    expect(recovered.kind === 'ready' && recovered.selection.model).toBe('one')
    expect(preferred).toEqual({ providerId: 'a', model: 'one' })
  })

  it('asks before leaving a disabled or deleted provider, and declining never dispatches', async () => {
    for (const deleted of [false, true]) {
      const f = fixture()
      if (deleted) f.providers.shift(); else f.providers[0].enabled = false
      let calls = 0
      const denied = await f.runtime.resolvePreferred({ ...request(), confirmFallback: async () => { calls++; return false } })
      expect(denied.kind).toBe('blocked')
      expect(calls).toBe(1)
      const approved = await f.runtime.resolvePreferred({ ...request(), confirmFallback: async () => true })
      expect(approved.kind === 'ready' && approved.selection.provider.id).toBe('b')
    }
  })

  it('revalidates scope, candidate, access and cancellation after confirmation', async () => {
    for (const change of ['epoch', 'model', 'key', 'policy', 'abort'] as const) {
      const f = fixture(); f.providers[0].enabled = false
      const controller = new AbortController()
      const settings = { modelBlocklist: [] as string[] }
      const result = await f.runtime.resolvePreferred({ ...request(), settings, signal: controller.signal, confirmFallback: async () => {
        if (change === 'epoch') f.setEpoch('epoch-2')
        if (change === 'model') f.providers[1].models = ['changed']
        if (change === 'key') f.providers[1].apiKey = ''
        if (change === 'policy') settings.modelBlocklist = ['one', 'two']
        if (change === 'abort') controller.abort()
        return true
      } })
      expect(result.kind).not.toBe('ready')
    }
  })

  it('respects single-target, offline, capability and strict credential constraints', async () => {
    const f = fixture(); f.unavailable.add('a:one')
    expect((await f.runtime.resolvePreferred({ ...request(), allowFallback: false })).kind).toBe('blocked')
    expect((await f.runtime.resolvePreferred({ ...request(), requiredCapabilities: ['image'] })).kind).toBe('blocked')
    expect((await f.runtime.resolvePreferred({ ...request(), targetCredentialGroupId: 'missing' })).kind).toBe('blocked')
    f.setOffline()
    expect((await f.runtime.resolvePreferred(request())).kind).toBe('blocked')
  })

  it('never grants a second fallback budget or replays bound continuation', async () => {
    const f = fixture()
    for (const constraints of [{ fallbackUsed: true }, { continuationBound: true }, { streamStarted: true }]) {
      const result = await f.runtime.resolveFallback({ ...request(), original: preferred, trigger: 'timeout', ...constraints })
      expect(result.selection).toBeUndefined()
    }
    const incompatible = await f.runtime.resolveFallback({ ...request(), original: preferred, trigger: 'timeout',
      requiredProtocolAdapterId: 'anthropic' })
    expect(incompatible.selection).toBeUndefined()
  })

  it('keeps the same-provider-first decision without loosening caller policy', async () => {
    const f = fixture(); f.unavailable.add('a:one')
    const input = { ...request(), original: preferred, trigger: 'timeout' as const }
    const same = await f.runtime.resolveFallback(input)
    expect(same.selection?.provider.id).toBe('a')
    expect(same.decision.mode).toBe('same-provider')
    expect(same.decision.rejectedCandidates.some((candidate) => candidate.providerId === 'b'
      && candidate.reason === 'cross_provider_disallowed')).toBe(true)
    for (const policy of [
      { mode: 'off' as const }, { explicitModelLock: true },
      { mode: 'approved-providers' as const }, { mode: 'auto-safe' as const, approvedProviderIds: [] },
      { mode: 'same-provider' as const, approvedProviderIds: ['b'] },
    ]) expect((await f.runtime.resolveFallback({ ...input, policy })).selection).toBeUndefined()
  })

  it('does not transfer pending confirmation to a newly eligible candidate', async () => {
    const f = fixture(); f.providers[0].enabled = false
    const result = await f.runtime.resolvePreferred({ ...request(), confirmFallback: async () => {
      f.providers[0].enabled = true
      return true
    } })
    expect(result.kind).toBe('blocked')
    expect(result.kind === 'blocked' && result.reason).toBe('candidate_changed')
  })
})
