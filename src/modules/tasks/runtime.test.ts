import { asTaskId } from '@/core'
import type { Task, TaskJournalEntry, TaskPersistence } from './contracts'
import { createTaskRuntime } from './runtime'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

async function fixture() {
  const records = new Map<string, Task>()
  const journal: TaskJournalEntry[] = []
  const hooks: { read?: () => Promise<void>; write?: (entry: TaskJournalEntry) => Promise<void> } = {}
  const persistence: TaskPersistence = {
    async get(id) { const task = records.get(id); await hooks.read?.(); return task },
    async findByIdempotencyKey(key) { return [...records.values()].find(task => task.idempotencyKey === key) },
    async listRecoverable() { return [...records.values()].filter(task => ['running', 'queued', 'awaiting-confirmation'].includes(task.status)) },
    async save(task) { records.set(task.id, task) },
    async append(entry) { journal.push(entry) },
    async list(id) { return journal.filter(entry => entry.taskId === id) },
    async appendAndSave(entry, task) {
      await hooks.write?.(entry)
      if (entry.sequence !== (records.get(task.id)?.journalSequence ?? 0) + 1) throw new Error('sequence conflict')
      journal.push(entry); records.set(task.id, task)
    },
  }
  let now = 1
  const runtime = createTaskRuntime({ persistence, ids: { next: () => 'task' }, clock: { now: () => ++now },
    policyEvaluator: { async evaluate() { return { outcome: 'allowed', reasonCode: 'test' } } } })
  const id = asTaskId('task')
  expect((await runtime.create({ taskId: id, toolId: 'read_file', idempotencyKey: 'read-1' })).ok).toBe(true)
  return { runtime, id, records, journal, hooks }
}

test('cancel durably terminalizes a live task without freeing an uncooperative executor slot', async () => {
  const f = await fixture()
  const started = deferred(); const finish = deferred()
  let signal!: AbortSignal
  const execute = jest.fn(async (_task, options) => { signal = options.signal; started.resolve(); await finish.promise; return { summary: 'late success' } })
  const execution = f.runtime.execute(f.id, { execute })
  await started.promise
  const cancelled = await f.runtime.cancel(f.id)
  expect(signal.aborted).toBe(true)
  expect(cancelled).toMatchObject({ ok: true, value: { status: 'cancelled' } })
  expect(f.records.get(f.id)?.status).toBe('cancelled')
  expect(await f.runtime.execute(f.id, { execute })).toMatchObject({ ok: false, error: { code: 'task_already_active' } })
  finish.resolve()
  expect(await execution).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  expect(f.journal.filter(entry => entry.type === 'task.cancelled')).toHaveLength(1)
  expect(f.journal.some(entry => entry.type === 'task.succeeded')).toBe(false)
})

test('repeated cancellation awaits the same durable barrier, not an optimistic in-memory flag', async () => {
  const f = await fixture()
  const started = deferred(); const finish = deferred(); const writing = deferred(); const disk = deferred()
  f.hooks.write = async entry => { if (entry.type === 'task.cancellation-requested') { writing.resolve(); await disk.promise } }
  const execution = f.runtime.execute(f.id, { async execute() { started.resolve(); await finish.promise; return {} } })
  await started.promise
  let acknowledged = 0
  const first = f.runtime.cancel(f.id).then(result => { acknowledged++; return result })
  await writing.promise
  const second = f.runtime.cancel(f.id).then(result => { acknowledged++; return result })
  await Promise.resolve(); await Promise.resolve()
  expect(acknowledged).toBe(0)
  disk.resolve()
  expect((await first).ok && (await second).ok).toBe(true)
  expect(f.journal.filter(entry => entry.type === 'task.cancellation-requested')).toHaveLength(1)
  finish.resolve(); await execution
})

test.each(['task.cancellation-requested', 'task.cancelled'] as const)('failed %s persistence is not acknowledged and can be retried', async type => {
  const f = await fixture()
  const started = deferred(); const finish = deferred()
  const execution = f.runtime.execute(f.id, { async execute() { started.resolve(); await finish.promise; return {} } })
  await started.promise
  let failed = false
  f.hooks.write = async entry => { if (entry.type === type && !failed) { failed = true; throw new Error('disk full') } }
  expect(await f.runtime.cancel(f.id)).toMatchObject({ ok: false, error: { code: 'persistence_failed' } })
  expect(await f.runtime.cancel(f.id)).toMatchObject({ ok: true, value: { status: 'cancelled' } })
  finish.resolve(); await execution
  expect(f.journal.filter(entry => entry.type === 'task.cancelled')).toHaveLength(1)
})

test('cancellation during artifact persistence prevents later artifacts and success', async () => {
  const f = await fixture()
  const writing = deferred(); const disk = deferred()
  f.hooks.write = async entry => { if (entry.type === 'task.artifact-recorded') { writing.resolve(); await disk.promise } }
  const execution = f.runtime.execute(f.id, { async execute() { return { artifacts: [
    { id: 'one', label: 'one', createdAt: 1 }, { id: 'two', label: 'two', createdAt: 1 },
  ] } } })
  await writing.promise
  const cancelled = f.runtime.cancel(f.id)
  disk.resolve()
  expect(await cancelled).toMatchObject({ ok: true, value: { status: 'cancelled' } })
  expect(await execution).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  expect(f.records.get(f.id)?.artifacts.map(item => item.id)).toEqual(['one'])
  expect(f.journal.some(entry => entry.type === 'task.succeeded')).toBe(false)
})

test('reserves admission across the initial read and delivers cancellation before dispatch', async () => {
  const f = await fixture()
  const disk = deferred()
  f.hooks.read = () => disk.promise
  const execute = jest.fn(async () => ({}))
  const first = f.runtime.execute(f.id, { execute })
  expect(await f.runtime.execute(f.id, { execute })).toMatchObject({ ok: false, error: { code: 'task_already_active' } })
  const cancelled = f.runtime.cancel(f.id)
  disk.resolve()
  expect(await cancelled).toMatchObject({ ok: true, value: { status: 'cancelled' } })
  expect(await first).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  expect(execute).not.toHaveBeenCalled()
})

test('a success already admitted for persistence wins a late cancellation without contradictory terminal events', async () => {
  const f = await fixture()
  const writing = deferred(); const disk = deferred()
  f.hooks.write = async entry => { if (entry.type === 'task.succeeded') { writing.resolve(); await disk.promise } }
  const execution = f.runtime.execute(f.id, { async execute() { return {} } })
  await writing.promise
  const lateCancel = f.runtime.cancel(f.id)
  disk.resolve()
  expect(await execution).toMatchObject({ ok: true, value: { status: 'succeeded' } })
  expect(await lateCancel).toMatchObject({ ok: true, value: { status: 'succeeded' } })
  expect(f.journal.some(entry => entry.type === 'task.cancelled')).toBe(false)
})

test('an older durable cancellation marker cannot be dispatched before startup recovery', async () => {
  const f = await fixture()
  f.records.set(f.id, { ...f.records.get(f.id)!, cancellationRequestedAt: 12 })
  const execute = jest.fn(async () => ({}))
  expect(await f.runtime.execute(f.id, { execute })).toMatchObject({ ok: true, value: { status: 'cancelled' } })
  expect(execute).not.toHaveBeenCalled()
})
