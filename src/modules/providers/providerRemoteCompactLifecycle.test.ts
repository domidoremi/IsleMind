import { createProviderRemoteCompactLifecycle, type ProviderRemoteCompactLifecycleDependencies } from './providerRemoteCompactLifecycle'
import type { CompactUsageInput } from './providerCompactUsageStore'

const input = {
  conversationId: 'conversation', providerId: 'provider', model: 'model',
  settings: { remoteCompactMode: 'auto' as const, runtimeLogEnabled: true },
  strategy: 'native-openai-responses' as const,
  capabilityKind: 'native-compaction' as const,
  remoteClassification: 'remote-available' as const,
}
const completed = { ...input, mode: 'auto' as const, messageCount: 2, responseId: 'response-1' }

function setup(overrides: Partial<ProviderRemoteCompactLifecycleDependencies> = {}) {
  const dependencies = {
    recordCompactUsage: jest.fn((value: CompactUsageInput) => ({ id: 'usage-1', createdAt: 100, ...value })),
    listActiveCompactStates: jest.fn(async () => []),
    saveCompactState: jest.fn(async () => undefined),
    emitRuntimeEvent: jest.fn(async () => undefined),
    now: () => 100,
    ...overrides,
  }
  return { dependencies, lifecycle: createProviderRemoteCompactLifecycle(dependencies) }
}

test('unsupported storage falls back without pretending that a state read succeeded', async () => {
  const { lifecycle, dependencies } = setup({ compactStatePersistenceAvailable: false })
  await expect(lifecycle.resolvePreviousState(input)).resolves.toEqual({})
  expect(dependencies.listActiveCompactStates).not.toHaveBeenCalled()
  expect(dependencies.emitRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
    event: 'context.compact.decided',
    data: { status: 'storage_unavailable', operation: 'read', fallback: 'no-previous-response' },
  }))
})

test('successful remote compaction remains successful while unavailable persistence is disclosed separately', () => {
  const { lifecycle, dependencies } = setup({ compactStatePersistenceAvailable: false })
  expect(() => lifecycle.recordCompleted(completed)).not.toThrow()
  expect(dependencies.recordCompactUsage).toHaveBeenCalledTimes(1)
  expect(dependencies.saveCompactState).not.toHaveBeenCalled()
  expect(dependencies.emitRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
    event: 'context.compact.completed', data: expect.objectContaining({ status: 'completed' }),
  }))
  expect(dependencies.emitRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'storage_unavailable', operation: 'write', fallback: 'no-new-continuation-state' },
  }))
})

test('read failures are observable and never return an unverified response id', async () => {
  const { lifecycle, dependencies } = setup({ listActiveCompactStates: jest.fn().mockRejectedValue(new Error('private detail must not enter diagnostics')) })
  await expect(lifecycle.resolvePreviousState(input)).resolves.toEqual({})
  expect(dependencies.emitRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'storage_read_failed', operation: 'read', fallback: 'no-previous-response' },
  }))
  expect(JSON.stringify((dependencies.emitRuntimeEvent as jest.Mock).mock.calls)).not.toContain('private detail')
})

test.each(['completed', 'failed'] as const)('write failure after %s is nonfatal but observable', async outcome => {
  const { lifecycle, dependencies } = setup({ saveCompactState: jest.fn().mockRejectedValue(new Error('write failed')) })
  if (outcome === 'completed') lifecycle.recordCompleted(completed)
  else lifecycle.recordFailed({ ...completed, failureCode: 'remote_compact_http_400' })
  await Promise.resolve()
  await Promise.resolve()
  expect(dependencies.emitRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'storage_write_failed', operation: 'write', fallback: 'no-new-continuation-state' },
  }))
})

test('disabled or cancelled compaction does not emit storage warnings', async () => {
  const { lifecycle, dependencies } = setup({ compactStatePersistenceAvailable: false })
  await lifecycle.resolvePreviousState({ ...input, settings: { remoteCompactMode: 'off' } })
  const controller = new AbortController()
  controller.abort()
  lifecycle.recordCompleted({ ...completed, signal: controller.signal })
  expect(dependencies.emitRuntimeEvent).not.toHaveBeenCalled()
  expect(dependencies.saveCompactState).not.toHaveBeenCalled()
})
