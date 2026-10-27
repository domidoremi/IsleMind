import type { AIProvider } from '@/types/providerContracts'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import {
  createProviderChatResolutionRuntime,
  type ProviderChatExecutionConstraint,
  type ProviderChatResolutionInput,
} from './providerChatResolution'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
function metadata(id: string): AIProvider {
  return { id, name: id, type: 'openai', enabled: true, models: ['one', 'two'],
    apiKey: '', apiKeySource: { kind: 'none' } }
}
function fixture() {
  const controller = new AbortController()
  const catalog = [metadata('a'), metadata('b')]
  const readProviders = jest.fn(async (_signal: AbortSignal, options?: { providers?: readonly AIProvider[] }) =>
    (options?.providers ?? catalog).map((provider) => ({ ...provider,
      apiKey: `secure-fixture-${provider.id}`, apiKeySource: { kind: 'primary' as const } })))
  const getAvailability = jest.fn(async (identity: { providerId: string }) => ({
    scope: { scopeId: identity.providerId, epoch: 'epoch-1' }, availability: 'unknown' as const,
  }))
  const confirmFallback = jest.fn(async () => true)
  const runtime = createProviderChatResolutionRuntime({
    readProviders, getAvailability, isOnline: async () => true,
    loadHealthRecords: async () => ({}), healthAllows: async () => true,
    configurationValid: (provider) => Boolean(provider.apiKey),
    accessAllowed: (_provider, model, settings) => !settings?.modelBlocklist?.includes(model),
    resolveIdentity: (provider, model, credentialSource) => ({
      providerId: provider.id, model, credentialSource, protocolAdapterId: 'openai-chat', endpointVariant: 'native',
    }),
    buildCandidates: createProviderFallbackCandidateBuilder({
      projectModel: (_provider, model) => ({ deprecated: false, upstreamModel: model, capabilities: ['text'] }),
    }),
  })
  const input = { preferred: { providerId: 'a', model: 'one' }, providers: catalog,
    settings: { modelBlocklist: [] as string[] }, signal: controller.signal, confirmFallback }
  return { controller, catalog, input, runtime, readProviders, getAvailability, confirmFallback }
}
type CatalogConstraint = ProviderChatExecutionConstraint & { providerCatalog?: readonly AIProvider[] }

it('carries the exact metadata catalog in the ephemeral admission fence, not hydrated runtime credentials', async () => {
  const f = fixture()
  const result = await f.runtime.resolvePreferred(f.input)
  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') throw new Error('Expected an admitted provider')
  const constraint = result.selection.constraint as CatalogConstraint
  expect(constraint.providerCatalog).toEqual([metadata('a'), metadata('b')])
  expect(result.selection.provider.apiKey).toBe('secure-fixture-a')
  expect(JSON.stringify(constraint)).not.toContain('secure-fixture')
  expect(Object.isFrozen(constraint.providerCatalog)).toBe(true)
  f.catalog.push(metadata('later'))
  f.catalog[0].name = 'later name'
  expect(constraint.providerCatalog).toEqual([metadata('a'), metadata('b')])
})

it('retains the same metadata catalog in a selected failure fallback fence', async () => {
  const f = fixture()
  const result = await f.runtime.resolveFallback({
    ...f.input, original: f.input.preferred, trigger: 'timeout',
  })
  expect(result.selection).toBeDefined()
  expect((result.selection!.constraint as CatalogConstraint).providerCatalog).toEqual(f.catalog)
  expect(result.selection!.provider.apiKey).toBe('secure-fixture-a')
  expect(result.selection!.constraint.fallbackUsed).toBe(true)
  expect(f.readProviders.mock.calls.every(([, options]) =>
    options?.providers?.every((provider) => provider.apiKey === ''))).toBe(true)
})

it('revalidates against the fence catalog even when the caller supplies a later expanded catalog', async () => {
  const f = fixture()
  const constraint: CatalogConstraint = {
    identity: { providerId: 'a', model: 'one', credentialSource: { kind: 'primary' },
      protocolAdapterId: 'openai-chat', endpointVariant: 'native' },
    scope: { scopeId: 'a', epoch: 'epoch-1' }, fallbackUsed: false, providerCatalog: f.catalog.slice(),
  }
  const later = [...f.catalog, metadata('later')]
  later[0] = { ...later[0], models: ['one', 'two', 'later-model'] }
  const result = await f.runtime.revalidate(constraint, { ...f.input, providers: later })
  expect(result).toBeDefined()
  expect(f.readProviders).toHaveBeenCalledWith(f.controller.signal, { providers: f.catalog })
  expect(result!.provider.models).toEqual(['one', 'two'])
})

it('does not infer metadata receipts from hydrated providers for legacy fences', async () => {
  const f = fixture()
  const constraint: ProviderChatExecutionConstraint = {
    identity: { providerId: 'a', model: 'one', credentialSource: { kind: 'primary' },
      protocolAdapterId: 'openai-chat', endpointVariant: 'native' },
    scope: { scopeId: 'a', epoch: 'epoch-1' }, fallbackUsed: false,
  }
  const { providers: _providers, ...input } = f.input
  await expect(f.runtime.revalidate(constraint, input)).resolves.toBeDefined()
  expect(f.readProviders).toHaveBeenCalledWith(f.controller.signal, undefined)
})

it('intersects captured access with the original runtime caller live revocation port', async () => {
  const f = fixture()
  const availability = deferred<Awaited<ReturnType<typeof f.getAvailability>>>()
  f.getAvailability.mockImplementationOnce(() => availability.promise)
  let current = { modelBlocklist: [] as string[] }
  const input: ProviderChatResolutionInput & { readCurrentAccessSettings: () => typeof current } = {
    ...f.input, readCurrentAccessSettings: () => current,
  }
  const pending = f.runtime.resolvePreferred(input)
  await tick()
  current = { modelBlocklist: ['one', 'two'] }
  availability.resolve({ scope: { scopeId: 'a', epoch: 'epoch-1' }, availability: 'unknown' })
  const result = await pending
  expect(result.kind).toBe('blocked')
})

it('a runtime policy-current port can revoke but never enlarge a captured fallback grant', async () => {
  const f = fixture()
  const input = { ...f.input, original: f.input.preferred, trigger: 'timeout' as const,
    isSelectionPolicyCurrent: () => false }
  const result = await f.runtime.resolveFallback(input)
  expect(result.selection).toBeUndefined()
  expect(result.reason).toBe('policy_blocked')
  expect(f.readProviders).not.toHaveBeenCalled()
  expect(f.confirmFallback).not.toHaveBeenCalled()
})

it('rejects revalidation when the runtime policy-current port revokes the admitted operation', async () => {
  const f = fixture()
  const constraint: CatalogConstraint = {
    identity: { providerId: 'a', model: 'one', credentialSource: { kind: 'primary' },
      protocolAdapterId: 'openai-chat', endpointVariant: 'native' },
    scope: { scopeId: 'a', epoch: 'epoch-1' }, fallbackUsed: false, providerCatalog: f.catalog,
  }
  const input = { ...f.input, isSelectionPolicyCurrent: () => false }
  await expect(f.runtime.revalidate(constraint, input)).resolves.toBeUndefined()
})

it('retains the final cancellation fence when the live policy port aborts during revalidation', async () => {
  const f = fixture()
  const constraint: CatalogConstraint = {
    identity: { providerId: 'a', model: 'one', credentialSource: { kind: 'primary' },
      protocolAdapterId: 'openai-chat', endpointVariant: 'native' },
    scope: { scopeId: 'a', epoch: 'epoch-1' }, fallbackUsed: false, providerCatalog: f.catalog,
  }
  let calls = 0
  const input = { ...f.input, isSelectionPolicyCurrent: () => {
    if (++calls === 2) f.controller.abort()
    return true
  } }
  await expect(f.runtime.revalidate(constraint, input)).resolves.toBeUndefined()
})

it.each(['before-admission', 'after-availability'] as const)(
  'the runtime policy-current port revokes preferred selection %s without a fallback grant',
  async (when) => {
    const f = fixture()
    const availability = deferred<Awaited<ReturnType<typeof f.getAvailability>>>()
    let current = when !== 'before-admission'
    const input = { ...f.input, isSelectionPolicyCurrent: () => current }
    if (current) f.getAvailability.mockImplementationOnce(() => availability.promise)
    const pending = f.runtime.resolvePreferred(input)
    await tick()
    current = false
    availability.resolve({ scope: { scopeId: 'a', epoch: 'epoch-1' }, availability: 'unknown' })
    await expect(pending).resolves.toMatchObject({ kind: 'blocked', reason: 'policy_blocked' })
    expect(f.confirmFallback).not.toHaveBeenCalled()
    if (when === 'before-admission') expect(f.readProviders).not.toHaveBeenCalled()
  },
)
