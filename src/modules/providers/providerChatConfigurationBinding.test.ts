import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { createProviderChatResolutionRuntime, type ProviderChatSelection } from './providerChatResolution'
import { createProviderConversationAdmissionRuntime, type ProviderConversationAdmissionDependencies } from './providerConversationAdmissionRuntime'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import type { ProviderFailoverPolicy } from './providerFailoverPolicy'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }
function provider(id: string, enabled = true): AIProvider {
  return { id, name: id, type: 'openai', enabled, models: ['one', 'two'], apiKey: `fixture-${id}`,
    apiKeySource: { kind: 'primary' } }
}
function resolutionFixture() {
  const controller = new AbortController()
  const catalog = [provider('a'), provider('b')]
  const settings = { modelBlocklist: [] as string[] }
  const readProviders = jest.fn(async (_signal: AbortSignal, options?: { providers?: readonly AIProvider[] }) =>
    options?.providers ?? catalog)
  const isOnline = jest.fn(async () => true)
  const getAvailability = jest.fn(async (identity: { providerId: string }) => ({
    scope: { scopeId: identity.providerId, epoch: 'epoch-1' }, availability: 'unknown' as const,
  }))
  const healthAllows = jest.fn(async () => true)
  const loadHealthRecords = jest.fn(async () => ({}))
  const accessAllowed = jest.fn((_provider: AIProvider, model: string, value?: typeof settings) =>
    !value?.modelBlocklist.includes(model) && !settings.modelBlocklist.includes(model))
  const buildCandidates = jest.fn(createProviderFallbackCandidateBuilder({
    projectModel: (_provider, model) => ({ deprecated: false, upstreamModel: model, capabilities: ['text'] }),
  }))
  const runtime = createProviderChatResolutionRuntime({
    readProviders, isOnline, getAvailability, healthAllows, loadHealthRecords, accessAllowed, buildCandidates,
    configurationValid: value => Boolean(value.apiKey),
    resolveIdentity: (value, model, credentialSource) => ({
      providerId: value.id, model, credentialSource, protocolAdapterId: 'openai-chat', endpointVariant: 'native',
    }),
  })
  const input = { preferred: { providerId: 'a', model: 'one' }, providers: catalog, settings,
    requiredCapabilities: ['text'], signal: controller.signal }
  return { controller, catalog, settings, input, runtime, readProviders, isOnline, getAvailability,
    healthAllows, loadHealthRecords, accessAllowed, buildCandidates }
}

it('captures preferred identity, catalog, capabilities and signal before the online await', async () => {
  const f = resolutionFixture()
  const online = deferred<boolean>()
  f.isOnline.mockImplementationOnce(() => online.promise)
  const pending = f.runtime.resolvePreferred(f.input)
  f.input.preferred.model = 'later-model'
  f.catalog[0].models.push('later-model')
  f.catalog.push(provider('later-provider'))
  f.input.requiredCapabilities.push('image')
  f.input.signal = new AbortController().signal
  online.resolve(true)
  const outcome = await pending
  expect(outcome).toMatchObject({ kind: 'ready', selection: { model: 'one', provider: { id: 'a', models: ['one', 'two'] } } })
  expect(f.readProviders).toHaveBeenCalledWith(f.controller.signal, {
    providers: [provider('a'), provider('b')],
  })
  expect(f.buildCandidates.mock.calls[0][0].requiredCapabilities).toEqual(['text'])
})

it('detaches hydrated metadata and admitted settings before availability and health reads', async () => {
  const f = resolutionFixture()
  const availability = deferred<Awaited<ReturnType<typeof f.getAvailability>>>()
  f.getAvailability.mockImplementationOnce(() => availability.promise)
  const admittedSettings = { modelBlocklist: [] as string[] }
  const pending = f.runtime.resolvePreferred({ ...f.input, settings: admittedSettings })
  await tick()
  f.catalog[0].name = 'later name'
  f.catalog[0].apiKey = 'later credential'
  admittedSettings.modelBlocklist.push('unrelated-later-rule')
  availability.resolve({ scope: { scopeId: 'a', epoch: 'epoch-1' }, availability: 'unknown' })
  const outcome = await pending
  expect(outcome).toMatchObject({ kind: 'ready', selection: { provider: { name: 'a', apiKey: 'fixture-a' } } })
  expect(f.accessAllowed.mock.calls[0][2]).toEqual({ modelBlocklist: [] })
})

it.each(['success', 'rejection'] as const)('settles an admitted online %s and stops provider reads after original cancellation', async mode => {
  const f = resolutionFixture()
  const online = deferred<boolean>()
  f.isOnline.mockImplementationOnce(() => online.promise)
  let settled = false
  const pending = f.runtime.resolvePreferred(f.input).finally(() => { settled = true })
  f.input.signal = new AbortController().signal
  f.controller.abort()
  await tick()
  expect(settled).toBe(false)
  if (mode === 'success') online.resolve(true)
  else online.reject(new Error('late online failure'))
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(f.readProviders).not.toHaveBeenCalled()
  expect(f.getAvailability).not.toHaveBeenCalled()
})

it.each(['success', 'rejection'] as const)('settles an admitted catalog %s and suppresses later availability/health work after original cancellation', async mode => {
  const f = resolutionFixture()
  const catalog = deferred<readonly AIProvider[]>()
  f.readProviders.mockImplementationOnce(() => catalog.promise)
  let settled = false
  const pending = f.runtime.resolvePreferred(f.input).finally(() => { settled = true })
  await tick()
  f.input.signal = new AbortController().signal
  f.controller.abort()
  await tick()
  expect(settled).toBe(false)
  if (mode === 'success') catalog.resolve(f.catalog)
  else catalog.reject(new Error('late key read failure'))
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(f.getAvailability).not.toHaveBeenCalled()
  expect(f.healthAllows).not.toHaveBeenCalled()
  expect(f.loadHealthRecords).not.toHaveBeenCalled()
})

it('does not admit health after availability settlement on the original cancelled signal', async () => {
  const f = resolutionFixture()
  const availability = deferred<Awaited<ReturnType<typeof f.getAvailability>>>()
  f.getAvailability.mockImplementationOnce(() => availability.promise)
  const pending = f.runtime.resolvePreferred(f.input)
  await tick()
  f.controller.abort()
  availability.resolve({ scope: { scopeId: 'a', epoch: 'epoch-1' }, availability: 'unknown' })
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(f.healthAllows).not.toHaveBeenCalled()
})

it('keeps live access revocation effective while preferred availability is pending', async () => {
  const f = resolutionFixture()
  const availability = deferred<Awaited<ReturnType<typeof f.getAvailability>>>()
  f.getAvailability.mockImplementationOnce(() => availability.promise)
  const pending = f.runtime.resolvePreferred({ ...f.input, settings: { modelBlocklist: [] } })
  await tick()
  f.settings.modelBlocklist.push('one', 'two')
  availability.resolve({ scope: { scopeId: 'a', epoch: 'epoch-1' }, availability: 'unknown' })
  const outcome = await pending
  expect(outcome.kind).toBe('blocked')
})

it('keeps pre-aborted preferred and fallback resolution side-effect free', async () => {
  const f = resolutionFixture()
  f.controller.abort()
  await expect(f.runtime.resolvePreferred(f.input)).resolves.toEqual({ kind: 'cancelled' })
  const fallback = await f.runtime.resolveFallback({ ...f.input, original: f.input.preferred, trigger: 'timeout' })
  expect(fallback.selection).toBeUndefined()
  expect(f.readProviders).not.toHaveBeenCalled()
  expect(f.isOnline).not.toHaveBeenCalled()
  expect(f.loadHealthRecords).not.toHaveBeenCalled()
  expect(f.getAvailability).not.toHaveBeenCalled()
})

it.each(['success', 'rejection'] as const)('settles fallback catalog %s without admitting health or confirmation after cancellation', async mode => {
  const f = resolutionFixture()
  const catalog = deferred<readonly AIProvider[]>()
  const confirmFallback = jest.fn(async () => true)
  f.readProviders.mockImplementationOnce(() => catalog.promise)
  const pending = f.runtime.resolveFallback({ ...f.input, original: f.input.preferred, trigger: 'timeout', confirmFallback })
  f.controller.abort()
  if (mode === 'success') catalog.resolve(f.catalog)
  else catalog.reject(new Error('late fallback catalog failure'))
  const outcome = await pending
  expect(outcome.selection).toBeUndefined()
  expect(f.loadHealthRecords).not.toHaveBeenCalled()
  expect(f.getAvailability).not.toHaveBeenCalled()
  expect(confirmFallback).not.toHaveBeenCalled()
})

it.each(['success', 'rejection'] as const)('settles admitted revalidation catalog %s without accepting a route after cancellation', async mode => {
  const f = resolutionFixture()
  const admitted = await f.runtime.resolvePreferred(f.input)
  if (admitted.kind !== 'ready') throw new Error('Fixture admission must succeed')
  f.getAvailability.mockClear()
  const catalog = deferred<readonly AIProvider[]>()
  f.readProviders.mockImplementationOnce(() => catalog.promise)
  const pending = f.runtime.revalidate(admitted.selection.constraint, f.input)
  await tick()
  f.input.signal = new AbortController().signal
  f.controller.abort()
  if (mode === 'success') catalog.resolve(f.catalog)
  else catalog.reject(new Error('late revalidation key failure'))
  await expect(pending).resolves.toBeUndefined()
  expect(f.getAvailability).not.toHaveBeenCalled()
})

it('reuses the admitted candidate catalog for confirmation revalidation rather than adding a newly configured provider', async () => {
  const f = resolutionFixture()
  f.catalog[0].enabled = false
  const confirmFallback = jest.fn(async () => {
    f.catalog.push(provider('newly-configured'))
    return true
  })
  const outcome = await f.runtime.resolvePreferred({ ...f.input, confirmFallback })
  expect(outcome).toMatchObject({ kind: 'ready', selection: { provider: { id: 'b' } } })
  expect(confirmFallback).toHaveBeenCalledTimes(1)
  for (const [, options] of f.readProviders.mock.calls) {
    expect(options?.providers?.map(value => value.id)).toEqual(['a', 'b'])
  }
})

it('does not let stable admitted settings bypass live access revocation during confirmation', async () => {
  const f = resolutionFixture()
  f.catalog[0].enabled = false
  const admittedSettings = { modelBlocklist: [] as string[] }
  const outcome = await f.runtime.resolvePreferred({
    ...f.input, settings: admittedSettings,
    confirmFallback: async () => { f.settings.modelBlocklist.push('one', 'two'); return true },
  })
  expect(outcome.kind).toBe('blocked')
  expect(f.readProviders).toHaveBeenCalledTimes(3)
})

it('refuses fallback confirmation when the selected credential rotates to another nonempty key', async () => {
  const f = resolutionFixture()
  f.catalog[0].enabled = false
  const outcome = await f.runtime.resolvePreferred({
    ...f.input,
    confirmFallback: async () => {
      f.readProviders.mockImplementation(async (_signal, options) => (options?.providers ?? f.catalog)
        .map(value => value.id === 'b' ? { ...value, apiKey: 'rotated-nonempty-key' } : value))
      return true
    },
  })
  expect(outcome).toMatchObject({ kind: 'blocked', reason: 'candidate_changed' })
})

it('keeps the reviewed fallback route immutable so a confirmation callback cannot transfer consent', async () => {
  const f = resolutionFixture()
  f.catalog[0].enabled = false
  const outcome = await f.runtime.resolvePreferred({
    ...f.input,
    confirmFallback: async candidate => {
      expect(Object.isFrozen(candidate)).toBe(true)
      expect(Reflect.set(candidate, 'model', 'two')).toBe(false)
      return true
    },
  })
  expect(outcome).toMatchObject({ kind: 'ready', selection: { provider: { id: 'b' }, model: 'one' } })
})

it('honors a narrowed original request policy after confirmation without broadening captured authority', async () => {
  const f = resolutionFixture()
  f.catalog[0].enabled = false
  const policy: Partial<ProviderFailoverPolicy> = { mode: 'ask-before-cross-provider', approvedProviderIds: ['b'] }
  const outcome = await f.runtime.resolvePreferred({
    ...f.input, policy,
    confirmFallback: async () => { policy.mode = 'off'; policy.approvedProviderIds!.push('a'); return true },
  })
  expect(outcome.kind).toBe('blocked')
})

it('captures revalidation constraint identity and scope before the online await', async () => {
  const f = resolutionFixture()
  const admitted = await f.runtime.resolvePreferred(f.input)
  if (admitted.kind !== 'ready') throw new Error('Fixture admission must succeed')
  const online = deferred<boolean>()
  f.isOnline.mockImplementationOnce(() => online.promise)
  const constraint = JSON.parse(JSON.stringify(admitted.selection.constraint)) as typeof admitted.selection.constraint
  const pending = f.runtime.revalidate(constraint, f.input)
  constraint.scope.epoch = 'later-epoch'
  constraint.identity.model = 'later-model'
  online.resolve(true)
  await expect(pending).resolves.toMatchObject({ constraint: {
    identity: { model: 'one' }, scope: { epoch: 'epoch-1' },
  } })
})

it('does not return a revalidated route when its final access observer cancels the original signal', async () => {
  const f = resolutionFixture()
  const admitted = await f.runtime.resolvePreferred(f.input)
  if (admitted.kind !== 'ready') throw new Error('Fixture admission must succeed')
  f.accessAllowed.mockClear()
  f.accessAllowed.mockImplementation(() => {
    if (f.accessAllowed.mock.calls.length === 5) f.controller.abort()
    return true
  })
  await expect(f.runtime.revalidate(admitted.selection.constraint, f.input)).resolves.toBeUndefined()
})

function admissionFixture() {
  const controller = new AbortController()
  const settings = { modelBlocklist: [], memoryEnabled: true } as unknown as Settings
  const catalog = [provider('a')]
  const conversation = { id: 'conversation', providerId: 'a', model: 'one',
    title: 'Original', systemPrompt: '', temperature: 0, maxTokens: 8,
    messages: [], createdAt: 1, updatedAt: 1 } as Conversation
  const hydration = deferred<AIProvider | null>()
  const hydrateProviderKey = jest.fn((_id: string, _signal: AbortSignal,
    _configuration?: { settings: Settings; providers: readonly AIProvider[] }) => hydration.promise)
  const resolveGenerationRequest = jest.fn((_input: Parameters<ProviderConversationAdmissionDependencies<object>['resolveGenerationRequest']>[0]) =>
    ({ temperature: 0, maxTokens: 8 }))
  const runtime = createProviderConversationAdmissionRuntime({
    providerHasModel: () => true, hydrateProviderKey,
    getProviderConfigIssue: () => null, resolveProviderModelAlias: (_provider, model) => model,
    getModelConfig: () => ({}), resolveGenerationRequest,
  })
  const input = { conversation, providers: catalog, settings, signal: controller.signal }
  return { controller, settings, catalog, input, hydration, hydrateProviderKey, resolveGenerationRequest, runtime }
}

it('passes captured metadata/settings to legacy hydration and retains the admitted conversation across secure reads', async () => {
  const f = admissionFixture()
  const pending = f.runtime.admitConversation(f.input)
  f.input.conversation.title = 'Later'
  f.input.conversation.model = 'later-model'
  f.settings.memoryEnabled = false
  f.catalog.push(provider('later-provider'))
  f.hydration.resolve(provider('a'))
  await expect(pending).resolves.toMatchObject({ kind: 'ready', conversation: { title: 'Original', model: 'one' } })
  expect(f.hydrateProviderKey).toHaveBeenCalledWith('a', f.controller.signal, {
    settings: { modelBlocklist: [], memoryEnabled: true }, providers: [provider('a')],
  })
  expect(f.resolveGenerationRequest.mock.calls[0][0]).toMatchObject({
    settings: { memoryEnabled: true }, conversation: { model: 'one' },
  })
})

it.each(['success', 'rejection'] as const)('keeps original legacy hydration cancellation ownership after %s', async mode => {
  const f = admissionFixture()
  const pending = f.runtime.admitConversation(f.input)
  f.input.signal = new AbortController().signal
  f.controller.abort()
  if (mode === 'success') f.hydration.resolve(provider('a'))
  else f.hydration.reject(new Error('late legacy key failure'))
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(f.resolveGenerationRequest).not.toHaveBeenCalled()
})

it('classifies legacy hydration AbortError as cancellation without fabricating a credential failure', async () => {
  const f = admissionFixture()
  const pending = f.runtime.admitConversation(f.input)
  f.hydration.reject(Object.assign(new Error('adapter cancelled'), { name: 'AbortError' }))
  await expect(pending).resolves.toEqual({ kind: 'cancelled' })
  expect(f.resolveGenerationRequest).not.toHaveBeenCalled()
})

it('captures the optional resolver admission input before its await, preserving the preferred save identity', async () => {
  const f = admissionFixture()
  const execution = deferred<{ kind: 'ready'; selection: ProviderChatSelection }>()
  const resolveExecution = jest.fn((_input: unknown) => execution.promise)
  const runtime = createProviderConversationAdmissionRuntime({
    resolveExecution, providerHasModel: () => true, hydrateProviderKey: f.hydrateProviderKey,
    getProviderConfigIssue: () => null, resolveProviderModelAlias: (_provider, model) => model,
    getModelConfig: () => ({}), resolveGenerationRequest: f.resolveGenerationRequest,
  })
  const pending = runtime.admitConversation(f.input)
  f.input.conversation.model = 'later-preference'
  f.settings.memoryEnabled = false
  execution.resolve({ kind: 'ready', selection: { provider: provider('b'), model: 'two',
    constraint: { identity: { providerId: 'b', model: 'two', credentialSource: { kind: 'primary' },
      protocolAdapterId: 'openai-chat', endpointVariant: 'native' },
    scope: { scopeId: 'b', epoch: 'epoch-1' }, fallbackUsed: true } } })
  await expect(pending).resolves.toMatchObject({
    kind: 'ready', conversation: { providerId: 'a', model: 'one' }, executionModel: 'two', provider: { id: 'b' },
  })
  expect(resolveExecution.mock.calls[0][0]).toMatchObject({
    conversation: { model: 'one' }, settings: { memoryEnabled: true },
  })
  expect(f.hydrateProviderKey).not.toHaveBeenCalled()
})
