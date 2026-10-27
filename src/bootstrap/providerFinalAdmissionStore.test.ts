import type { AIProvider } from '@/types/providerContracts'
import {
  asSocketExecution, deferred, flushAdmissionMicrotasks, loadProviderAdmissionStoreFixture,
  prepareStoreExecution, type ProviderAdmissionStoreFixture,
} from './testing/providerAdmissionStoreFixture'

let fixture: ProviderAdmissionStoreFixture
beforeEach(async () => { fixture = await loadProviderAdmissionStoreFixture() })
afterEach(async () => {
  expect(fixture.executionResources.retainedTextBytes).toBe(0)
  await fixture.close()
})

it.each(['primary', 'group'] as const)(
  'real secure %s setter already invalidates the final observer fence without a second store fence',
  async credential => {
    const execution = await prepareStoreExecution(fixture, credential)
    const entered = deferred<void>()
    const release = deferred<void>()
    execution.req.onExecutionTarget = async () => { entered.resolve(); await release.promise }
    const pending = fixture.executor.executeHttpSseChat(execution.input)
    const outcome = pending.then(() => undefined, error => error)
    await entered.promise
    const check = fixture.availability.captureConfiguration()
    const previousEpoch = execution.req.executionConstraint!.scope.epoch
    if (credential === 'primary') {
      await fixture.useSettingsStore.getState().setProviderApiKey('fixture-provider', 'synthetic-rotated-primary')
    } else {
      await fixture.useSettingsStore.getState().setProviderCredentialGroupKey('fixture-provider', 'default', 'synthetic-rotated-group')
    }
    expect(check).toThrow('configuration changed')
    expect((await fixture.availability.getAvailability(execution.req.executionConstraint!.identity)).scope.epoch)
      .not.toBe(previousEpoch)
    release.resolve()
    expect(await outcome).toBeDefined()
    expect(execution.wire).not.toHaveBeenCalled()
    expect(execution.fallbackWire).not.toHaveBeenCalled()
    expect(execution.input.onDone).not.toHaveBeenCalled()
  },
)

it.each(['primary', 'group'] as const)(
  'an unchanged secure %s write preserves the current admission epoch',
  async credential => {
    const execution = await prepareStoreExecution(fixture, credential)
    const check = fixture.availability.captureConfiguration()
    const previousScope = execution.req.executionConstraint!.scope
    if (credential === 'primary') {
      await fixture.useSettingsStore.getState().setProviderApiKey('fixture-provider', 'synthetic-primary-key')
    } else {
      await fixture.useSettingsStore.getState().setProviderCredentialGroupKey('fixture-provider', 'default', 'synthetic-group-key')
    }
    expect(check).not.toThrow()
    expect((await fixture.availability.getAvailability(execution.req.executionConstraint!.identity)).scope).toEqual(previousScope)
    await fixture.executor.executeHttpSseChat(execution.input)
    expect(execution.wire).toHaveBeenCalledTimes(1)
    expect(execution.fallbackWire).not.toHaveBeenCalled()
    expect(execution.input.onDone).toHaveBeenCalledTimes(1)
  },
)

it('a real key-only updateProvider mutation invalidates admission through secure storage', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  execution.req.onExecutionTarget = async () => { entered.resolve(); await release.promise }
  const pending = fixture.executor.executeHttpSseChat(execution.input)
  const outcome = pending.then(() => undefined, error => error)
  await entered.promise
  const check = fixture.availability.captureConfiguration()
  await fixture.useSettingsStore.getState().updateProvider('fixture-provider', { apiKey: 'synthetic-updated-primary' })
  expect(check).toThrow('configuration changed')
  release.resolve()
  expect(await outcome).toBeDefined()
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('waits for an admitted durable invalidation before writing a changed direct key', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  const check = fixture.availability.captureConfiguration()
  fixture.hooks.beforeSql = async sql => {
    if (!sql.startsWith('UPDATE provider_model_scopes SET epoch')) return
    entered.resolve()
    await release.promise
  }
  const priorWrites = fixture.events.filter(event => event === 'secure-write').length
  const mutation = fixture.useSettingsStore.getState().setProviderApiKey('fixture-provider', 'synthetic-rotation')
  await entered.promise
  expect(check).toThrow('configuration changed')
  expect(fixture.events.filter(event => event === 'secure-write')).toHaveLength(priorWrites)
  fixture.hooks.beforeSql = undefined
  release.resolve()
  await mutation
  expect(await fixture.useSettingsStore.getState().getSecureApiKey('fixture-provider')).toBe('synthetic-rotation')
  expect((await fixture.availability.getAvailability(execution.req.executionConstraint!.identity)).availability).toBe('unknown')
})

const catalogChanges: [string, Partial<AIProvider>][] = [
  ['provider display metadata', { name: 'Changed provider name' }],
  ['model catalog', { models: ['gpt-4o', 'gpt-4o-mini'], manualModels: ['gpt-4o-mini'] }],
  ['credential mode', { credentialMode: 'token-plan' }],
  ['sync policy', { syncPolicy: { strategy: 'sequential-low-rate', minDelayMs: 10, maxDelayMs: 20, timeoutMs: 1000 } }],
  ['model configuration', { modelConfigs: [{
    id: 'gpt-4o', name: 'Changed model', provider: 'openai', contextWindow: 200_000, maxTokens: 200_000,
    maxOutputTokens: 4096, defaultMaxTokens: 100, supportsVision: false, supportsFiles: false,
    supportsTools: false, supportedParameters: ['max_tokens'], source: 'remote',
  }] }],
]

it.each(catalogChanges)(
  'real %s edit during the final observer rejects the captured metadata even without an availability epoch change',
  async (_label, updates) => {
    const execution = await prepareStoreExecution(fixture)
    const entered = deferred<void>()
    const release = deferred<void>()
    execution.req.onExecutionTarget = async () => { entered.resolve(); await release.promise }
    const pending = fixture.executor.executeHttpSseChat(execution.input)
    const outcome = pending.then(() => undefined, error => error)
    await entered.promise
    const check = fixture.availability.captureConfiguration()
    await fixture.useSettingsStore.getState().updateProvider('fixture-provider', updates)
    expect(check).not.toThrow()
    expect(fixture.useSettingsStore.getState().providers[0].apiKey).toBe('')
    release.resolve()
    expect(await outcome).toBeDefined()
    expect(execution.wire).not.toHaveBeenCalled()
    expect(execution.fallbackWire).not.toHaveBeenCalled()
    expect(execution.input.onDone).not.toHaveBeenCalled()
    expect(fixture.useSettingsStore.getState().settings.defaultProvider).toBe('fixture-provider')
  },
)

it.each(['providerBlocklist', 'modelBlocklist'] as const)(
  'real store %s revocation during the final observer blocks dispatch without a caller live-settings port',
  async setting => {
    const execution = await prepareStoreExecution(fixture)
    const entered = deferred<void>()
    const release = deferred<void>()
    execution.req.onExecutionTarget = async () => { entered.resolve(); await release.promise }
    const pending = fixture.executor.executeHttpSseChat(execution.input)
    const outcome = pending.then(() => undefined, error => error)
    await entered.promise
    fixture.useSettingsStore.getState().updateSettings({
      [setting]: [setting === 'providerBlocklist' ? 'fixture-provider' : 'gpt-4o'],
    })
    release.resolve()
    expect(await outcome).toBeDefined()
    expect(execution.wire).not.toHaveBeenCalled()
    expect(execution.fallbackWire).not.toHaveBeenCalled()
    expect(execution.input.onDone).not.toHaveBeenCalled()
  },
)

it('real lifecycle-unavailable evidence observed during the final observer blocks the wire', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  execution.req.onExecutionTarget = async () => { entered.resolve(); await release.promise }
  const pending = fixture.executor.executeHttpSseChat(execution.input)
  const outcome = pending.then(() => undefined, error => error)
  await entered.promise
  const operation = await fixture.availability.beginExecution(execution.req.executionConstraint!.identity, 'fixture-newer-unavailable')
  await fixture.availability.settleExecution(operation, 'gpt-4o', { kind: 'model_invalidated' })
  expect((await fixture.availability.getAvailability(execution.req.executionConstraint!.identity)).availability).toBe('unavailable')
  release.resolve()
  expect(await outcome).toBeDefined()
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('real health cooldown recorded during the final observer blocks the wire', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  execution.req.onExecutionTarget = async () => { entered.resolve(); await release.promise }
  const pending = fixture.executor.executeHttpSseChat(execution.input)
  const outcome = pending.then(() => undefined, error => error)
  await entered.promise
  await fixture.health.recordProviderRuntimeFailure({ req: execution.req, status: 429, retryAfterMs: 60_000 })
  expect((await fixture.health.resolveProviderRuntimeHealthView(
    fixture.health.providerRuntimeHealthRoute(execution.req),
  ))?.status).toBe('cooldown')
  release.resolve()
  expect(await outcome).toBeDefined()
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('settles a final secure reread after original cancellation and never reacquires an observer', async () => {
  const execution = await prepareStoreExecution(fixture)
  const observerEntered = deferred<void>()
  const observerRelease = deferred<void>()
  const readEntered = deferred<void>()
  const readRelease = deferred<void>()
  execution.req.onExecutionTarget = jest.fn(async () => { observerEntered.resolve(); await observerRelease.promise })
  let settled = false
  const pending = fixture.executor.executeHttpSseChat(execution.input)
    .finally(() => { settled = true })
  const outcome = pending.then(() => undefined, error => error)
  await observerEntered.promise
  fixture.hooks.beforeSecureRead = async () => { readEntered.resolve(); await readRelease.promise }
  observerRelease.resolve()
  const readAdmitted = await Promise.race([readEntered.promise.then(() => true), outcome.then(() => false)])
  if (!readAdmitted) {
    fixture.hooks.beforeSecureRead = undefined
    readRelease.resolve()
    expect(readAdmitted).toBe(true)
    return
  }
  execution.controller.abort()
  await flushAdmissionMicrotasks()
  expect(settled).toBe(false)
  fixture.hooks.beforeSecureRead = undefined
  readRelease.resolve()
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
})

it('WebSocket rejects a real store metadata edit after target observation without HTTP fallback', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  execution.req.onExecutionTarget = async () => { entered.resolve(); await release.promise }
  const socket = asSocketExecution(execution)
  const pending = fixture.executor.executeProviderRuntimeChat(socket.input)
  await entered.promise
  await fixture.useSettingsStore.getState().updateProvider('fixture-provider', { name: 'Socket metadata changed' })
  release.resolve()
  await pending
  expect(socket.run).not.toHaveBeenCalled()
  expect(execution.input.onError).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it.each(['primary', 'group'] as const)(
  'a selected %s rotation queued behind final secure hydration cannot switch the admitted key',
  async credential => {
    const execution = await prepareStoreExecution(fixture, credential)
    const entered = deferred<void>()
    const release = deferred<void>()
    execution.req.onExecutionTarget = jest.fn(async () => {
      fixture.hooks.beforeSecureRead = async () => { entered.resolve(); await release.promise }
    })
    const outcome = fixture.executor.executeHttpSseChat(execution.input).then(() => undefined, error => error)
    await entered.promise
    const mutation = credential === 'primary'
      ? fixture.useSettingsStore.getState().setProviderApiKey('fixture-provider', 'synthetic-final-primary')
      : fixture.useSettingsStore.getState().setProviderCredentialGroupKey('fixture-provider', 'default', 'synthetic-final-group')
    let mutated = false
    void mutation.then(() => { mutated = true })
    await flushAdmissionMicrotasks()
    expect(mutated).toBe(false)
    expect(execution.wire).not.toHaveBeenCalled()
    fixture.hooks.beforeSecureRead = undefined
    release.resolve()
    await mutation
    expect(await outcome).toBeDefined()
    expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
    expect(execution.wire).not.toHaveBeenCalled()
    expect(execution.fallbackWire).not.toHaveBeenCalled()
  },
)

it('a real metadata edit queued during final hydration is not accepted as a replacement catalog', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  execution.req.onExecutionTarget = jest.fn(async () => {
    fixture.hooks.beforeSecureRead = async () => { entered.resolve(); await release.promise }
  })
  const outcome = fixture.executor.executeHttpSseChat(execution.input).then(() => undefined, error => error)
  await entered.promise
  // The real store queues even an empty credential patch behind an admitted secure read.
  const mutation = fixture.useSettingsStore.getState().updateProvider('fixture-provider', { name: 'Changed during hydration' })
  await flushAdmissionMicrotasks()
  expect(fixture.useSettingsStore.getState().providers[0].name).toBe('Reviewed provider')
  fixture.hooks.beforeSecureRead = undefined
  release.resolve()
  await mutation
  expect(await outcome).toBeDefined()
  expect(execution.catalog[0].name).toBe('Reviewed provider')
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('final health inspection rejects live store access revoked during its awaited read', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  execution.req.onExecutionTarget = jest.fn(async () => {
    fixture.hooks.beforeHealthRead = async () => { entered.resolve(); await release.promise }
  })
  const outcome = fixture.executor.executeHttpSseChat(execution.input).then(() => undefined, error => error)
  await entered.promise
  fixture.useSettingsStore.getState().updateSettings({ modelBlocklist: ['gpt-4o'] })
  fixture.hooks.beforeHealthRead = undefined
  release.resolve()
  expect(await outcome).toBeDefined()
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('a final availability SQL failure stops dispatch instead of authorizing unknown evidence', async () => {
  const execution = await prepareStoreExecution(fixture)
  execution.req.onExecutionTarget = jest.fn(async () => {
    fixture.hooks.beforeSql = async sql => {
      if (sql.includes('FROM provider_model_current c JOIN') && sql.includes('WHERE c.scopeId=? AND c.modelId=?')) {
        throw new Error('Final availability read failed')
      }
    }
  })
  const outcome = await fixture.executor.executeHttpSseChat(execution.input).then(() => undefined, error => error)
  fixture.hooks.beforeSql = undefined
  expect(outcome).toMatchObject({ name: 'ProviderExecutionTargetObserverError' })
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('a pending decisive model write keeps final admission closed until real SQL settlement', async () => {
  const execution = await prepareStoreExecution(fixture)
  const identity = execution.req.executionConstraint!.identity
  const scope = execution.req.executionConstraint!.scope
  const operation = await fixture.availability.beginExecution(identity, 'fixture-pending-decisive')
  const observerEntered = deferred<void>()
  const observerRelease = deferred<void>()
  const writeEntered = deferred<void>()
  const writeRelease = deferred<void>()
  execution.req.onExecutionTarget = jest.fn(async () => { observerEntered.resolve(); await observerRelease.promise })
  let settled = false
  const outcome = fixture.executor.executeHttpSseChat(execution.input)
    .finally(() => { settled = true }).then(() => undefined, error => error)
  await observerEntered.promise
  fixture.hooks.beforeSql = async sql => {
    if (!sql.startsWith('INSERT OR IGNORE INTO provider_model_observations')) return
    writeEntered.resolve()
    await writeRelease.promise
  }
  const check = fixture.captureEvidence(scope.scopeId, identity.model)
  const write = fixture.availability.settleExecution(operation, identity.model, { kind: 'generation_success' })
  await writeEntered.promise
  expect(check).toThrow('evidence changed')
  observerRelease.resolve()
  await flushAdmissionMicrotasks()
  expect(execution.wire).not.toHaveBeenCalled()
  expect(settled).toBe(false)
  fixture.hooks.beforeSql = undefined
  writeRelease.resolve()
  await write
  expect(await outcome).toBeDefined()
  expect(check).toThrow('evidence changed')
  expect((await fixture.availability.getAvailability(identity)).availability).toBe('available')
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('failed decisive evidence SQL revokes the old read but releases pending fence ownership', async () => {
  const execution = await prepareStoreExecution(fixture)
  const identity = execution.req.executionConstraint!.identity
  const scope = execution.req.executionConstraint!.scope
  const operation = await fixture.availability.beginExecution(identity, 'fixture-failed-decisive')
  const check = fixture.captureEvidence(scope.scopeId, identity.model)
  fixture.hooks.beforeSql = async sql => {
    if (sql.startsWith('INSERT OR IGNORE INTO provider_model_observations')) throw new Error('Decisive evidence write failed')
  }
  await expect(fixture.availability.settleExecution(operation, identity.model, { kind: 'model_invalidated' }))
    .rejects.toThrow('Decisive evidence write failed')
  fixture.hooks.beforeSql = undefined
  expect(check).toThrow('evidence changed')
  expect(fixture.captureEvidence(scope.scopeId, identity.model)).not.toThrow()
  expect((await fixture.availability.getAvailability(identity)).availability).toBe('unknown')
})

it('operational cancellation evidence during target observation does not replace lifecycle admission', async () => {
  const execution = await prepareStoreExecution(fixture)
  const identity = execution.req.executionConstraint!.identity
  const check = fixture.captureEvidence(execution.req.executionConstraint!.scope.scopeId, identity.model)
  execution.req.onExecutionTarget = jest.fn(async () => {
    const operation = await fixture.availability.beginExecution(identity, 'fixture-operational-only')
    await fixture.availability.settleExecution(operation, identity.model, { kind: 'operational', reason: 'cancelled' })
  })
  await fixture.executor.executeHttpSseChat(execution.input)
  expect(check).not.toThrow()
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).toHaveBeenCalledTimes(1)
  expect(execution.fallbackWire).not.toHaveBeenCalled()
  expect(execution.input.onDone).toHaveBeenCalledTimes(1)
})

it('a pending real health write cannot authorize dispatch even when no cooldown is visible yet', async () => {
  const execution = await prepareStoreExecution(fixture)
  const observerEntered = deferred<void>()
  const observerRelease = deferred<void>()
  const writeEntered = deferred<void>()
  const writeRelease = deferred<void>()
  execution.req.onExecutionTarget = jest.fn(async () => { observerEntered.resolve(); await observerRelease.promise })
  const outcome = fixture.executor.executeHttpSseChat(execution.input).then(() => undefined, error => error)
  await observerEntered.promise
  fixture.hooks.beforeHealthWrite = async () => { writeEntered.resolve(); await writeRelease.promise }
  const check = fixture.captureHealth(execution.req.provider.id)
  const write = fixture.health.recordProviderRuntimeRouteFailure(
    fixture.health.providerRuntimeHealthRoute(execution.req),
    { status: 429, retryAfterMs: 60_000 },
  )
  await writeEntered.promise
  expect(check).toThrow('health changed')
  observerRelease.resolve()
  expect(await outcome).toBeDefined()
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
  fixture.hooks.beforeHealthWrite = undefined
  writeRelease.resolve()
  await write
  expect(fixture.captureHealth(execution.req.provider.id)).not.toThrow()
})

it('a completed healthy write during observation cannot reopen the earlier dispatch read', async () => {
  const execution = await prepareStoreExecution(fixture)
  execution.req.onExecutionTarget = jest.fn(async () => {
    await fixture.health.recordProviderRuntimeRouteSuccess(fixture.health.providerRuntimeHealthRoute(execution.req))
  })
  const outcome = await fixture.executor.executeHttpSseChat(execution.input).then(() => undefined, error => error)
  expect(outcome).toBeDefined()
  expect((await fixture.health.resolveProviderRuntimeHealthView(
    fixture.health.providerRuntimeHealthRoute(execution.req),
  ))?.status).toBe('healthy')
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})

it('failed health telemetry releases its pending fence while preserving revocation of an earlier read', async () => {
  const execution = await prepareStoreExecution(fixture)
  const check = fixture.captureHealth(execution.req.provider.id)
  fixture.hooks.beforeHealthWrite = async () => { throw new Error('Health telemetry unavailable') }
  await fixture.health.recordProviderRuntimeSuccess({ req: execution.req })
  fixture.hooks.beforeHealthWrite = undefined
  expect(check).toThrow('health changed')
  expect(fixture.captureHealth(execution.req.provider.id)).not.toThrow()
})

it('awaits a rejected observer after cancellation without wire dispatch or observer reacquisition', async () => {
  const execution = await prepareStoreExecution(fixture)
  const entered = deferred<void>()
  const release = deferred<void>()
  execution.req.onExecutionTarget = jest.fn(async () => {
    entered.resolve()
    await release.promise
    throw new Error('Observer rejected after cancellation')
  })
  let settled = false
  const outcome = fixture.executor.executeHttpSseChat(execution.input)
    .finally(() => { settled = true }).then(() => undefined, error => error)
  await entered.promise
  execution.controller.abort()
  await flushAdmissionMicrotasks()
  expect(settled).toBe(false)
  expect(fixture.executionResources.retainedTextBytes).toBeGreaterThan(0)
  release.resolve()
  expect(await outcome).toMatchObject({ name: 'AbortError' })
  expect(execution.req.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(execution.wire).not.toHaveBeenCalled()
  expect(execution.fallbackWire).not.toHaveBeenCalled()
})
