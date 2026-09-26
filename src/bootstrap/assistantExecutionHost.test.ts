import { asAssistantRunId } from '@/core'
import { createExecutionResources } from '@/modules/tasks'
import type { RunSnapshot } from '@/modules/assistant-runtime'
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
  const invocations = new Map<string, () => void>()
  const persisted = async (value: RunSnapshot) => {
    if (value.status === 'running' && !invocations.has(value.id)) {
      invocations.set(value.id, host.executionStarted({ runId: value.id, rootRunId: value.id }))
    }
    await host.persisted(value)
    if (value.status !== 'running') { invocations.get(value.id)?.(); invocations.delete(value.id) }
  }
  return { host, pause, resources, acquire, renew, release, snapshot, persisted,
    control: (event: AndroidAgentExecutionControl) => control(event), pressure: (event: Partial<AndroidAgentMemoryPressure>) => pressure(event as AndroidAgentMemoryPressure) }
}
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('stored running without a live invocation can neither acquire nor renew a CPU lease', async () => {
  const f = fixture()
  const id = asAssistantRunId('a')
  await f.host.enableBackground(id, true)
  await f.host.persisted(f.snapshot(id))
  await jest.advanceTimersByTimeAsync(10_000)
  expect(f.acquire).not.toHaveBeenCalled()
  expect(f.renew).not.toHaveBeenCalled()
  const finish = f.host.executionStarted({ runId: id, rootRunId: id })
  await f.host.persisted(f.snapshot(id))
  expect(f.acquire).toHaveBeenCalledTimes(1)
  finish()
  await f.host.persisted(f.snapshot(id))
  await jest.advanceTimersByTimeAsync(10_000)
  expect(f.acquire).toHaveBeenCalledTimes(1)
  expect(f.release).toHaveBeenCalledTimes(1)
  expect(f.renew).not.toHaveBeenCalled()
  f.host.stop()
})

test('an old invocation disposer cannot release a resumed generation', async () => {
  const f = fixture()
  const id = asAssistantRunId('a')
  const oldFinish = f.host.executionStarted({ runId: id, rootRunId: id })
  await f.host.persisted(f.snapshot(id))
  await f.host.enableBackground(id, true)
  oldFinish()
  await f.host.persisted(f.snapshot(id, 'paused'))
  f.host.prepareUserResume(id)
  const finish = f.host.executionStarted({ runId: id, rootRunId: id })
  await f.host.persisted(f.snapshot(id))
  f.host.setVisible(false)
  oldFinish(); oldFinish()
  expect(f.release).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(1)
  expect(f.renew.mock.calls[0][0].generation).toBe(f.acquire.mock.calls[1][0].generation)
  finish()
  expect(f.release).toHaveBeenCalledTimes(2)
  f.host.stop()
})

test('an active child scope retains the root lease until the whole authorized subtree stops', async () => {
  const f = fixture()
  const id = asAssistantRunId('a')
  const rootFinish = f.host.executionStarted({ runId: id, rootRunId: id })
  const childFinish = f.host.executionStarted({ runId: asAssistantRunId('child'), rootRunId: id })
  await f.host.persisted(f.snapshot(id))
  await f.host.enableBackground(id, true)
  rootFinish()
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.release).not.toHaveBeenCalled()
  expect(f.renew).toHaveBeenCalledTimes(1)
  childFinish()
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.release).toHaveBeenCalledTimes(1)
  expect(f.renew).toHaveBeenCalledTimes(1)
  f.host.stop()
})

test('only explicit opt-in acquires; durable waiting releases and has no renewal polling', async () => {
  const f = fixture()
  await f.persisted(f.snapshot('a'))
  expect(f.acquire).not.toHaveBeenCalled()
  await f.host.enableBackground(asAssistantRunId('a'), true)
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(1)
  await f.persisted(f.snapshot('a', 'awaiting-confirmation'))
  expect(f.release).toHaveBeenCalledWith(expect.objectContaining({ runId: 'a' }), 'waiting')
  await jest.advanceTimersByTimeAsync(60_000)
  expect(f.renew).toHaveBeenCalledTimes(1)
  f.host.stop()
})

test('a late acquire after wait is released and cannot renew', async () => {
  const f = fixture()
  let finish!: (value: Awaited<ReturnType<typeof f.acquire>>) => void
  f.acquire.mockImplementationOnce((args) => new Promise((resolve) => { finish = resolve }))
  await f.persisted(f.snapshot('a'))
  const enabling = f.host.enableBackground(asAssistantRunId('a'), true)
  await f.persisted(f.snapshot('a', 'paused'))
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
  for (const id of ['a', 'b']) { await f.persisted(f.snapshot(id)); await f.host.enableBackground(asAssistantRunId(id), true) }
  const lease = (await f.acquire.mock.results[1].value).lease
  await f.persisted(f.snapshot('a', 'awaiting-confirmation'))
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
  await f.persisted(f.snapshot('a')); await f.host.enableBackground(asAssistantRunId('a'), true)
  f.pressure({ level: 'normal', cacheTrimOnly: true })
  expect(f.pause).not.toHaveBeenCalled()
  f.pressure({ level: 'critical', cacheTrimOnly: false })
  expect(f.release).toHaveBeenCalledTimes(1)
  expect(f.pause).toHaveBeenCalledWith('a', 'memory_pressure')
  expect(() => f.host.assertAdmission('a')).toThrow('memory_pressure')
  f.pressure({ level: 'normal', cacheTrimOnly: false })
  expect(() => f.host.assertAdmission('a')).toThrow('memory_pressure')
  settle(); await work
  await f.persisted(f.snapshot('a', 'paused'))
  f.host.prepareUserResume(asAssistantRunId('a'))
  expect(() => f.host.assertAdmission('a')).not.toThrow()
  f.host.stop()
})

test('backgrounding without opt-in pauses; merely foregrounding cannot clear the dispatch fence', async () => {
  const f = fixture()
  await f.persisted(f.snapshot('a'))
  f.host.setVisible(false)
  expect(f.pause).toHaveBeenCalledWith('a', 'background_disabled')
  f.host.setVisible(true)
  expect(() => f.host.assertAdmission('a')).toThrow('background_disabled')
  expect(f.acquire).not.toHaveBeenCalled()
  f.host.stop()
})

test('old unresolved renewal cannot suppress renewals of a new generation', async () => {
  const f = fixture()
  await f.persisted(f.snapshot('a')); await f.host.enableBackground(asAssistantRunId('a'), true)
  let completeOld!: (value: Awaited<ReturnType<typeof f.renew>>) => void
  f.renew.mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve }))
  await jest.advanceTimersByTimeAsync(5_000)
  const old = f.renew.mock.calls[0][0]
  await f.persisted(f.snapshot('a', 'paused'))
  await f.persisted(f.snapshot('a'))
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(2)
  completeOld({ ok: true, reason: 'renewed', lease: old })
  await jest.advanceTimersByTimeAsync(5_000)
  expect(f.renew).toHaveBeenCalledTimes(3)
  f.host.stop()
})

test('disable/re-enable during acquisition starts a fresh generation rather than reusing its promise', async () => {
  const f = fixture()
  await f.persisted(f.snapshot('a'))
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
  await f.persisted(f.snapshot('a'))
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
  await f.persisted(f.snapshot('a')); await f.host.enableBackground(asAssistantRunId('a'), true)
  const lease = (await f.acquire.mock.results[0].value).lease
  expect(() => f.host.prepareUserResume(asAssistantRunId('a'))).toThrow('already active')
  f.control({ ...lease, sequence: 1, kind: 'stop_requested', observedAtElapsedMs: 0 })
  expect(() => f.host.assertAdmission('a')).toThrow('execution_lease_lost')
  f.host.stop()
})
