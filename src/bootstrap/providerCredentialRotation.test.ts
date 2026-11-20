import type { AIProvider } from '@/types/providerContracts'
import { deferred, flushAdmissionMicrotasks, loadProviderAdmissionStoreFixture, prepareStoreExecution,
  type ProviderAdmissionStoreFixture } from './testing/providerAdmissionStoreFixture'

let fixture: ProviderAdmissionStoreFixture
beforeEach(async () => { fixture = await loadProviderAdmissionStoreFixture() })
afterEach(async () => { await fixture.close() })

const savedGroup = (id = 'default', providerId = 'fixture-provider') => fixture.useSettingsStore.getState().providers
  .find(provider => provider.id === providerId)!.credentialGroups!.find(group => group.id === id)!

it('persists actual successful group usage so consecutive admissions alternate keys', async () => {
  await prepareStoreExecution(fixture, 'group')
  const current = fixture.useSettingsStore.getState().providers[0]
  await fixture.useSettingsStore.getState().updateProvider(current.id, {
    credentialSelection: { strategy: 'least-recently-used' },
    credentialGroups: [...current.credentialGroups!, { id: 'second', label: 'Second', enabled: true,
      apiKey: 'synthetic-second-key', availableModels: ['gpt-4o'] }],
  })
  const selected: string[] = []
  for (let turn = 0; turn < 3; turn++) {
    const provider = (await fixture.useSettingsStore.getState().hydrateProviderKey(current.id))!
    const credential = fixture.providers.chooseCredentialForModel(provider, 'gpt-4o')
    selected.push(credential.credentialGroupId!)
    await fixture.health.recordProviderRuntimeSuccess({ req: { model: 'gpt-4o',
      provider: { ...provider, apiKey: credential.apiKey, apiKeySource: credential.source } },
    credentialGroupId: credential.credentialGroupId })
  }
  expect(selected).toEqual(['default', 'second', 'default'])
  await fixture.useSettingsStore.getState().flushProviderPersistence()
  expect(fixture.saveProviders.mock.calls.at(-1)![0][0].credentialGroups).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'default', lastUsedAt: expect.any(Number), failureCount: 0 }),
    expect.objectContaining({ id: 'second', lastUsedAt: expect.any(Number), failureCount: 0 }),
  ]))
})

it('records a real executor completion without depending on Rich message finalization', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  await fixture.executor.executeHttpSseChat(execution.input)
  await flushAdmissionMicrotasks()
  expect(execution.input.onDone).toHaveBeenCalledTimes(1)
  expect(savedGroup()).toMatchObject({ lastUsedAt: expect.any(Number), failureCount: 0 })
})

it('counts one failed request once and clears the count on the next success', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  await fixture.health.recordProviderRuntimeFailure({ req: execution.req, credentialGroupId: 'default', status: 401 })
  expect(savedGroup()).toMatchObject({ lastUsedAt: expect.any(Number), lastFailureAt: expect.any(Number), failureCount: 1 })
  const failureAt = savedGroup().lastFailureAt
  await fixture.health.recordProviderRuntimeSuccess({ req: execution.req, credentialGroupId: 'default' })
  expect(savedGroup()).toMatchObject({ failureCount: 0, lastFailureAt: failureAt })
})

it('attributes fallback health to its actual provider even when group IDs match', async () => {
  const original = await prepareStoreExecution(fixture, 'group')
  const beta: AIProvider = { ...fixture.useSettingsStore.getState().providers[0], id: 'fallback-provider',
    name: 'Fallback', credentialGroups: [{ ...savedGroup(), apiKey: 'synthetic-fallback-key' }] }
  await fixture.useSettingsStore.getState().addProvider(beta)
  const provider = (await fixture.useSettingsStore.getState().hydrateProviderKey(beta.id))!
  const request = { ...original.req, provider: { ...provider, apiKey: 'synthetic-fallback-key',
    apiKeySource: { kind: 'group' as const, groupId: 'default' } } }
  const route = { providerId: beta.id, model: 'gpt-4o', credentialGroupId: 'default',
    credentialSource: { kind: 'group' as const, groupId: 'default' } }
  const effects = require('./providerRuntimeFallbackEffects').providerRuntimeFallbackEffects
  await effects.recordRouteFailure(route, 401, 'invalid credential', original.controller.signal, false, request)
  expect(savedGroup('default', beta.id)).toMatchObject({ failureCount: 1, lastUsedAt: expect.any(Number) })
  expect(savedGroup().lastUsedAt).toBeUndefined()
  await effects.recordRouteSuccess(route, original.controller.signal, request)
  expect(savedGroup('default', beta.id).failureCount).toBe(0)
  expect(savedGroup().lastUsedAt).toBeUndefined()
})

it.each(['success', 'failure'] as const)('ignores a late %s from a replaced key', async outcome => {
  const execution = await prepareStoreExecution(fixture, 'group')
  await fixture.useSettingsStore.getState().setProviderCredentialGroupKey('fixture-provider', 'default', 'synthetic-replacement')
  const before = { ...savedGroup() }
  if (outcome === 'success') await fixture.health.recordProviderRuntimeSuccess({ req: execution.req, credentialGroupId: 'default' })
  else await fixture.health.recordProviderRuntimeFailure({ req: execution.req, credentialGroupId: 'default', status: 401 })
  expect(savedGroup()).toEqual(before)
})

it('serializes a health update with key replacement and leaves the new key unused', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  const release = deferred<void>()
  const readsBefore = fixture.events.filter(event => event === 'secure-read').length
  fixture.hooks.beforeSecureRead = async () => { await release.promise }
  const pending = fixture.health.recordProviderRuntimeSuccess({ req: execution.req, credentialGroupId: 'default' })
  // Baseline never reads the actual credential. Settle it first so failure is an assertion, not a timeout.
  await flushAdmissionMicrotasks()
  const observedRead = fixture.events.filter(event => event === 'secure-read').length
  const current = fixture.useSettingsStore.getState().providers[0]
  const replacement = fixture.useSettingsStore.getState().updateProvider(current.id, {
    credentialGroups: current.credentialGroups!.map(group => ({ ...group, apiKey: 'synthetic-replacement' })),
  })
  release.resolve()
  await Promise.all([pending, replacement])
  expect(observedRead).toBeGreaterThan(readsBefore)
  expect(savedGroup()).toMatchObject({ failureCount: 0 })
  expect(savedGroup().lastUsedAt).toBeUndefined()
})

it('keeps disabled groups disabled when an already dispatched request completes', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  const current = fixture.useSettingsStore.getState().providers[0]
  await fixture.useSettingsStore.getState().updateProvider(current.id, {
    credentialGroups: current.credentialGroups!.map(group => ({ ...group, enabled: false })),
  })
  await fixture.health.recordProviderRuntimeSuccess({ req: execution.req, credentialGroupId: 'default' })
  expect(savedGroup()).toMatchObject({ enabled: false, lastUsedAt: expect.any(Number) })
})

it('does not update a synthetic default group when the request used the primary key', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  await fixture.health.recordProviderRuntimeSuccess({ req: { ...execution.req, provider: {
    ...execution.req.provider, apiKey: 'synthetic-primary-key', apiKeySource: { kind: 'primary' },
  } }, credentialGroupId: 'default' })
  expect(savedGroup().lastUsedAt).toBeUndefined()
})

it('retains successful key rotation when route-health persistence fails', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  fixture.hooks.beforeHealthWrite = async () => { throw new Error('synthetic health write failure') }
  await expect(fixture.health.recordProviderRuntimeSuccess({ req: execution.req, credentialGroupId: 'default' })).resolves.toBeUndefined()
  expect(savedGroup()).toMatchObject({ lastUsedAt: expect.any(Number), failureCount: 0 })
})

it('hydrates a captured configuration with current health after an earlier turn settles', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  await fixture.health.recordProviderRuntimeSuccess({ req: execution.req, credentialGroupId: 'default' })
  const hydrated = await fixture.useSettingsStore.getState().hydrateProviderKey('fixture-provider', { providers: execution.catalog })
  expect(hydrated!.credentialGroups![0].lastUsedAt).toBe(savedGroup().lastUsedAt)
  expect(hydrated!.credentialGroups![0].apiKey).toBe('synthetic-group-key')
})

it('allows a bound continuation after its own completed request updated credential health', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  await fixture.executor.executeHttpSseChat(execution.input)
  await flushAdmissionMicrotasks()
  await fixture.executor.executeHttpSseChat(execution.input)
  expect(execution.wire).toHaveBeenCalledTimes(2)
  expect(execution.input.onDone).toHaveBeenCalledTimes(2)
})

it('finishes real cross-provider fallback after recording the original failed key', async () => {
  const execution = await prepareStoreExecution(fixture, 'group')
  const beta: AIProvider = { ...fixture.useSettingsStore.getState().providers[0], id: 'fallback-provider',
    name: 'Fallback', credentialGroups: [{ ...savedGroup(), apiKey: 'synthetic-fallback-key' }] }
  await fixture.useSettingsStore.getState().addProvider(beta)
  const catalog = fixture.providers.snapshotProviderConfiguration(fixture.useSettingsStore.getState().providers)
  const routingPlan = { schema: 'islemind.model-routing-plan.v1' as const, id: 'fallback', name: 'Fallback',
    mode: 'fallback' as const, primary: { providerId: 'fixture-provider', model: 'gpt-4o' },
    backup: { providerId: beta.id, model: 'gpt-4o' }, crossProvider: 'allow' as const }
  const admission = await fixture.resolution.resolvePreferred({ preferred: routingPlan.primary,
    providers: catalog, settings: fixture.useSettingsStore.getState().settings, signal: execution.controller.signal,
    routingPlan, allowFallback: true })
  expect(admission.kind).toBe('ready')
  if (admission.kind !== 'ready') return
  execution.req.provider = admission.selection.provider
  execution.req.executionConstraint = admission.selection.constraint
  execution.req.targetCredentialGroupId = undefined
  execution.req.allowFallback = true
  execution.req.failoverPolicy = { allowCredentialFailover: true }
  execution.req.fallbackProviders = await fixture.useSettingsStore.getState().getConfiguredProviders()
  execution.input.fallbackEffects = require('./providerRuntimeFallbackEffects').providerRuntimeFallbackEffects
  execution.wire.mockResolvedValueOnce(new Response('invalid credential', { status: 401 }))
  execution.fallbackWire.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'fallback answer' } }] }), { status: 200 }))
  await fixture.executor.executeHttpSseChat(execution.input)
  expect(execution.targets.map(target => target.providerId)).toEqual(['fixture-provider', beta.id])
  expect(execution.input.onDone).toHaveBeenCalledTimes(1)
  expect(execution.input.onError).not.toHaveBeenCalled()
  expect(savedGroup()).toMatchObject({ failureCount: 1, lastUsedAt: expect.any(Number) })
  expect(savedGroup('default', beta.id)).toMatchObject({ failureCount: 0, lastUsedAt: expect.any(Number) })
})
