import { asAssistantRunId } from '@/core'
import { createExecutionResources } from '@/modules/tasks/application/executionResources'
import type { RunSnapshot } from '@/modules/assistant-runtime/harnessCheckpoint'
import type { AndroidAgentExecutionControl, AndroidAgentMemoryPressure, AndroidAgentExecutionLease, AndroidAgentExecutionPort } from '@/platform/native/androidAgentExecution'
import { createAssistantExecutionHost } from './assistantExecutionHost'

function fixture() {
  let control: (event: AndroidAgentExecutionControl) => void = () => undefined
  let pressure: (event: AndroidAgentMemoryPressure) => void = () => undefined
  const acquire = jest.fn(async ({ runId, generation }) => ({ ok: true, reason: 'acquired' as const,
    lease: { runId, generation, startId: 1, leaseToken: 'token', expiresAtElapsedMs: 15_000 } }))
  const renew = jest.fn(async (lease: AndroidAgentExecutionLease) => ({ ok: true, reason: 'renewed' as const, lease: { ...lease } }))
  const release = jest.fn(async () => ({ ok: true, reason: 'released' as const }))
  const port = { isAvailable: () => true, acquire, renew, release,
    subscribeControl: (listener: typeof control) => { control = listener; return () => undefined },
    subscribeMemoryPressure: (listener: typeof pressure) => { pressure = listener; return () => undefined },
  } as unknown as AndroidAgentExecutionPort
  const pause = jest.fn(async () => undefined)
  const resources = createExecutionResources()
  const host = createAssistantExecutionHost({ port, resources, pause })
  host.start()
  const snapshot = (id: string, status: RunSnapshot['status'] = 'running'): RunSnapshot => ({ id: asAssistantRunId(id), status, sequence: 1,
    waiting: status === 'paused' || status === 'awaiting-confirmation', pendingSteeringCount: 0 })
  return { host, pause, resources, acquire, renew, release, snapshot,
    control: (event: AndroidAgentExecutionControl) => control(event), pressure: (event: Partial<AndroidAgentMemoryPressure>) => pressure(event as AndroidAgentMemoryPressure) }
}
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('only explicit opt-in acquires; durable waiting releases and has no renewal polling', async () => {
  const f = fixture()
  await f.host.persisted(f.snapshot('a'))
  expect(f.acquire).not.toHaveBeenCalled()
  await f.host.enableBackground(asAssistantRunId('a'), true)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(1)
  await f.host.persisted(f.snapshot('a', 'awaiting-confirmation'))
  expect(f.release).toHaveBeenCalledWith(expect.objectContaining({ runId: 'a' }), 'waiting')
  await jest.advanceTimersByTimeAsync(60_000)
  expect(f.renew).toHaveBeenCalledTimes(1)
  f.host.stop()
})

test('a late acquire after wait is released and cannot renew', async () => {
  const f = fixture()
  let finish!: (value: Awaited<ReturnType<typeof f.acquire>>) => void
  f.acquire.mockImplementationOnce((args) => new Promise((resolve) => { finish = resolve }))
  await f.host.persisted(f.snapshot('a'))
  const enabling = f.host.enableBackground(asAssistantRunId('a'), true)
  await f.host.persisted(f.snapshot('a', 'paused'))
  const args = f.acquire.mock.calls[0][0]
  finish({ ok: true, reason: 'acquired', lease: { ...args, startId: 1, leaseToken: 'token', expiresAtElapsedMs: 15_000 } })
  await enabling
  expect(f.release).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(10_000)
  expect(f.renew).not.toHaveBeenCalled()
  f.host.stop()
})

test('one waiting root does not release another; stale native events cannot pause new work', async () => {
  const f = fixture()
  for (const id of ['a', 'b']) { await f.host.persisted(f.snapshot(id)); await f.host.enableBackground(asAssistantRunId(id), true) }
  const lease = (await f.acquire.mock.results[1].value).lease
  await f.host.persisted(f.snapshot('a', 'awaiting-confirmation'))
  f.control({ ...lease, sequence: 1, generation: lease.generation - 1, kind: 'expired', observedAtElapsedMs: 0 })
  expect(f.pause).not.toHaveBeenCalled()
  f.host.setVisible(false)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(1)
  expect(f.renew).toHaveBeenCalledWith(expect.objectContaining({ runId: 'b' }))
  f.host.stop()
})

test('critical pressure fences dispatch and releases CPU independently of blocked underlying work', async () => {
  const f = fixture()
  let settle!: () => void
  const work = f.resources.runLocal(new AbortController().signal, () => new Promise<void>((resolve) => { settle = resolve }))
  await f.host.persisted(f.snapshot('a')); await f.host.enableBackground(asAssistantRunId('a'), true)
  f.pressure({ level: 'normal', cacheTrimOnly: true })
  expect(f.pause).not.toHaveBeenCalled()
  f.pressure({ level: 'critical', cacheTrimOnly: false })
  expect(f.release).toHaveBeenCalledTimes(1)
  expect(f.pause).toHaveBeenCalledWith('a', 'memory_pressure')
  expect(() => f.host.assertAdmission('a')).toThrow('memory_pressure')
  f.pressure({ level: 'normal', cacheTrimOnly: false })
  expect(() => f.host.assertAdmission('a')).toThrow('memory_pressure')
  settle(); await work
  await f.host.persisted(f.snapshot('a', 'paused'))
  f.host.prepareUserResume(asAssistantRunId('a'))
  expect(() => f.host.assertAdmission('a')).not.toThrow()
  f.host.stop()
})

test('backgrounding without opt-in pauses; merely foregrounding cannot clear the dispatch fence', async () => {
  const f = fixture()
  await f.host.persisted(f.snapshot('a'))
  f.host.setVisible(false)
  expect(f.pause).toHaveBeenCalledWith('a', 'background_disabled')
  f.host.setVisible(true)
  expect(() => f.host.assertAdmission('a')).toThrow('background_disabled')
  expect(f.acquire).not.toHaveBeenCalled()
  f.host.stop()
})

test('old unresolved renewal cannot suppress renewals of a new generation', async () => {
  const f = fixture()
  await f.host.persisted(f.snapshot('a')); await f.host.enableBackground(asAssistantRunId('a'), true)
  let completeOld!: (value: Awaited<ReturnType<typeof f.renew>>) => void
  f.renew.mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve }))
  await jest.advanceTimersByTimeAsync(5_000)
  const old = f.renew.mock.calls[0][0]
  await f.host.persisted(f.snapshot('a', 'paused'))
  await f.host.persisted(f.snapshot('a'))
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(2)
  completeOld({ ok: true, reason: 'renewed', lease: old })
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(3)
  f.host.stop()
})

test('disable/re-enable during acquisition starts a fresh generation rather than reusing its promise', async () => {
  const f = fixture()
  await f.host.persisted(f.snapshot('a'))
  let completeOld!: (value: Awaited<ReturnType<typeof f.acquire>>) => void
  f.acquire.mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve }))
  const first = f.host.enableBackground(asAssistantRunId('a'), true)
  await f.host.enableBackground(asAssistantRunId('a'), false)
  await f.host.enableBackground(asAssistantRunId('a'), true)
  expect(f.acquire).toHaveBeenCalledTimes(2)
  completeOld({ ok: true, reason: 'acquired', lease: { ...f.acquire.mock.calls[0][0], startId: 1, leaseToken: 'old', expiresAtElapsedMs: 15_000 } })
  await first
  f.host.setVisible(false)
  expect(() => f.host.assertAdmission('a')).not.toThrow()
  expect(f.release).toHaveBeenCalledWith(expect.objectContaining({ leaseToken: 'old' }), 'waiting')
  f.host.stop()
})

test('a native stop delivered before the acquire reply fences that pending generation', async () => {
  const f = fixture()
  await f.host.persisted(f.snapshot('a'))
  let complete!: (value: Awaited<ReturnType<typeof f.acquire>>) => void
  f.acquire.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  const acquiring = f.host.enableBackground(asAssistantRunId('a'), true)
  const lease = { ...f.acquire.mock.calls[0][0], startId: 1, leaseToken: 'stopped', expiresAtElapsedMs: 15_000 }
  f.control({ ...lease, sequence: 1, kind: 'stop_requested', observedAtElapsedMs: 0 })
  complete({ ok: true, reason: 'acquired', lease })
  await acquiring
  expect(() => f.host.assertAdmission('a')).toThrow('execution_lease_lost')
  expect(f.release).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).not.toHaveBeenCalled()
  f.host.stop()
})

test('duplicate user resume cannot invalidate the generation of an active lease', async () => {
  const f = fixture()
  await f.host.persisted(f.snapshot('a')); await f.host.enableBackground(asAssistantRunId('a'), true)
  const lease = (await f.acquire.mock.results[0].value).lease
  expect(() => f.host.prepareUserResume(asAssistantRunId('a'))).toThrow('already active')
  f.control({ ...lease, sequence: 1, kind: 'stop_requested', observedAtElapsedMs: 0 })
  expect(() => f.host.assertAdmission('a')).toThrow('execution_lease_lost')
  f.host.stop()
})
