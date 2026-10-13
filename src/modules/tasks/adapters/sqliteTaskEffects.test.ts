import { expect, jest, test } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asAssistantRunId, asTaskId } from '@/core'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { Task, TaskJournalEntry } from '../contracts'
import { createTaskRuntime } from '../runtime'
import { createSqliteTaskPersistence } from './sqliteTaskStore'
import type { TaskEffectActivity, TaskEffectCursor } from '../application/taskEffect'

function fixture() {
  const { Database } = require('bun:sqlite')
  const directory = mkdtempSync(join(tmpdir(), 'islemind-task-effects-'))
  let native: any
  const open = () => { native = new Database(join(directory, 'effects.db')); native.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON') }
  open()
  const executor: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) { const result = native.query(sql).run(...values); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) } },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).get(...values) as Row | null },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).all(...values) as Row[] },
  }
  let tail = Promise.resolve()
  const database: SqliteDatabase = { ...executor, transaction(work) {
    const result = tail.then(async () => {
      native.exec('BEGIN IMMEDIATE')
      try { const value = await work(executor); native.exec('COMMIT'); return value }
      catch (error) { native.exec('ROLLBACK'); throw error }
    })
    tail = result.then(() => undefined, () => undefined)
    return result
  } }
  const provider = { get: async () => database }
  let persistence = createSqliteTaskPersistence(provider)
  let now = 1
  const runtime = (outcome: 'allowed' | 'requires-confirmation' = 'allowed') => createTaskRuntime({ persistence, ids: { next: () => `task-${now++}` }, clock: { now: () => now++ },
    policyEvaluator: { async evaluate() { return { outcome, reasonCode: 'fixture' } } } })
  return { database, runtime, get store() { return persistence }, get now() { return now },
    reopen() { native.close(); open(); persistence = createSqliteTaskPersistence(provider) },
    dispose() { native.close(); rmSync(directory, { recursive: true, force: true }) } }
}
const runId = asAssistantRunId('effects-run')
const intent = (id = 'saf-1') => ({ id, kind: 'file' as const, action: 'copy' as const,
  sourceUri: 'content://provider/tree/root/document/source', targetParentUri: 'content://provider/tree/root', targetName: 'file.txt' })
const receipt = (id = 'saf-1') => ({ id, status: 'succeeded' as const, effect: 'applied' as const, bytesCopied: 12,
  targetUri: 'content://provider/tree/root/document/destination', completedSteps: ['created', 'copied'] as const })
async function create(f: ReturnType<typeof fixture>, id = 'task-1', run = runId) {
  const result = await f.runtime().create({ taskId: asTaskId(id), runId: run, toolId: 'android.files.apply_operations', idempotencyKey: id })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

test('all 64 effects survive actual SQLite close/reopen with stable 20-item pages and run isolation', async () => {
  const f = fixture()
  try {
    const task = await create(f)
    const output = await f.runtime().execute(task.id, { async execute(_, { effects }) {
      for (let i = 0; i < 64; i++) { await effects.begin(intent(`saf-${i}`)); await effects.settle(receipt(`saf-${i}`)) }
      return {}
    } })
    expect(output.ok).toBe(true)
    await create(f, 'other-task', asAssistantRunId('other-run'))
    f.reopen()
    const all: TaskEffectActivity[] = []
    let before: TaskEffectCursor | undefined
    let pages = 0
    do {
      const page = await f.store.listEffects(runId, before)
      expect(page.entries.length).toBeLessThanOrEqual(20)
      all.push(...page.entries); before = page.before; pages++
    } while (before)
    expect(pages).toBe(4)
    expect(new Set(all.map(entry => entry.intent.id)).size).toBe(64)
    expect(all.every(entry => entry.taskId === task.id && entry.state === 'succeeded' && entry.receipt?.bytesCopied === 12)).toBe(true)
    expect(await f.runtime().getEffectSummary(task.id)).toContain('"applied":64')
    expect((await f.store.listEffects(asAssistantRunId('other-run'))).entries).toHaveLength(0)
  } finally { f.dispose() }
})

test('process loss between intent and receipt yields uncertain evidence, no automatic replay', async () => {
  const f = fixture()
  try {
    const task = await create(f)
    // Exact durable state at process death, before the native completion arrives.
    const running: Task = { ...task, status: 'running', startedAt: 2, journalSequence: 2 }
    await f.store.appendAndSave({ schema: 'islemind.task-journal-entry.v1', taskId: task.id, sequence: 2, occurredAt: 2, type: 'task.started' }, running)
    const entry: TaskJournalEntry = { schema: 'islemind.task-journal-entry.v1', taskId: task.id, sequence: 3,
      occurredAt: 3, type: 'task.effect-started', data: { intent: intent() } }
    await f.store.appendAndSave(entry, { ...running, journalSequence: 3 })
    f.reopen()
    const runtime = f.runtime()
    expect((await runtime.recoverInterruptedTasks()).ok).toBe(true)
    const page = await f.store.listEffects(runId)
    expect(page.entries[0]).toMatchObject({ state: 'uncertain', intent: intent() })
    expect(page.entries[0].receipt).toBeUndefined()
    expect(await runtime.getEffectSummary(task.id)).toContain('"missing":1')
    expect(await runtime.execute(task.id, { async execute() { throw new Error('must not run') } })).toMatchObject({ ok: false, error: { code: 'task_not_active' } })
  } finally { f.dispose() }
})

test('late native receipt commits after cancellation and survives reopen without changing terminal state', async () => {
  const f = fixture()
  try {
    const task = await create(f); const runtime = f.runtime()
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve })
    let finish!: () => void; const release = new Promise<void>(resolve => { finish = resolve })
    const execution = runtime.execute(task.id, { async execute(_, { effects }) {
      await effects.begin(intent()); entered(); await release
      await effects.settle({ ...receipt(), status: 'cancelled', effect: 'partial' })
      return {}
    } })
    await started
    await runtime.cancel(task.id)
    const cancelled = await f.store.get(task.id)
    expect((await f.store.listEffects(runId)).entries[0].state).toBe('uncertain')
    finish(); await execution; f.reopen()
    expect(await f.store.get(task.id)).toMatchObject({ status: 'cancelled', completedAt: cancelled?.completedAt })
    expect((await f.store.listEffects(runId)).entries[0]).toMatchObject({ state: 'cancelled', receipt: { effect: 'partial', bytesCopied: 12 } })
    expect(await f.runtime().getEffectSummary(task.id)).toContain('"partial":1')
  } finally { f.dispose() }
})

test('SQLite receipt commit failure rolls back the task sequence and fences subsequent writes', async () => {
  const f = fixture()
  try {
    const task = await create(f)
    await f.database.exec(`CREATE TRIGGER reject_receipt BEFORE INSERT ON assistant_task_journal
      WHEN NEW.type = 'task.effect-settled' BEGIN SELECT RAISE(ABORT, 'disk fault'); END;`)
    const result = await f.runtime().execute(task.id, { async execute(_, { effects }) {
      await effects.begin(intent()); await effects.settle(receipt())
      await effects.begin(intent('must-not-start'))
      return {}
    } })
    expect(result).toMatchObject({ ok: false, error: { code: 'persistence_failed' } })
    expect(await f.store.get(task.id)).toMatchObject({ journalSequence: 4, status: 'failed' })
    expect(await f.store.list(task.id)).toHaveLength(4)
    f.reopen(); await f.runtime().recoverInterruptedTasks()
    expect((await f.store.listEffects(runId)).entries[0].state).toBe('uncertain')
  } finally { f.dispose() }
})

test('malformed or duplicated receipts fail the read rather than projecting success', async () => {
  const f = fixture()
  try {
    const task = await create(f)
    await f.runtime().execute(task.id, { async execute(_, { effects }) { await effects.begin(intent()); await effects.settle(receipt()); return {} } })
    await f.database.run("UPDATE assistant_task_journal SET dataJson = ? WHERE type = 'task.effect-settled'", [JSON.stringify({ receipt: { ...receipt(), effect: 'partial' } })])
    await expect(f.store.listEffects(runId)).rejects.toThrow()
    await f.database.run("UPDATE assistant_task_journal SET dataJson = ? WHERE type = 'task.effect-settled'", [JSON.stringify({ receipt: receipt() })])
    await f.database.run("INSERT INTO assistant_task_journal SELECT taskId, 6, type, occurredAt, dataJson, schema FROM assistant_task_journal WHERE type = 'task.effect-settled'")
    await expect(f.store.listEffects(runId)).rejects.toThrow('Ambiguous')
  } finally { f.dispose() }
})

test('restart expires admitted tasks that never started; a pre-restart confirmation cannot execute later', async () => {
  const f = fixture()
  try {
    const before = f.runtime('requires-confirmation')
    const created = await before.create({ taskId: asTaskId('confirmed-task'), runId, toolId: 'android.files.apply_operations', idempotencyKey: 'confirmed-task' })
    if (!created.ok) throw new Error(created.error.message)
    expect(created.value.status).toBe('awaiting-confirmation')
    const confirmed = await before.confirm(created.value.id, { confirmationId: 'user-approval' })
    expect(confirmed).toMatchObject({ ok: true, value: { status: 'queued' } })
    const pendingConfirmation = await create(f, 'pending-confirmation-task')
    await f.store.save({ ...pendingConfirmation, status: 'awaiting-confirmation' })
    // Process death after confirmation and before dispatch; the new process starts later.
    f.reopen()
    const processStartedAt = f.now
    const current = await create(f, 'current-process-task')
    const runtime = f.runtime()
    const recovered = await runtime.recoverInterruptedTasks({ staleQueuedBefore: processStartedAt })
    expect(recovered.ok).toBe(true)
    expect(await f.store.get(created.value.id)).toMatchObject({ status: 'expired', confirmationConfirmedAt: expect.any(Number) })
    expect(await f.store.get(pendingConfirmation.id)).toMatchObject({ status: 'expired' })
    expect((await f.store.list(created.value.id)).at(-1)).toMatchObject({ type: 'task.expired', data: { reason: 'not_started_before_restart' } })
    const execute = jest.fn(async () => ({}))
    expect(await runtime.execute(created.value.id, { execute })).toMatchObject({ ok: false, error: { code: 'task_not_active' } })
    expect(execute).not.toHaveBeenCalled()
    // A task admitted by the current process is not treated as stale.
    expect(await f.store.get(current.id)).toMatchObject({ status: 'queued' })
    expect(await runtime.execute(current.id, { execute })).toMatchObject({ ok: true, value: { status: 'succeeded' } })
    // Without an explicit process boundary, recovery keeps queued tasks untouched.
    const other = await create(f, 'unbounded-task')
    await runtime.recoverInterruptedTasks()
    expect(await f.store.get(other.id)).toMatchObject({ status: 'queued' })
  } finally { f.dispose() }
})
