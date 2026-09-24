import { expect, test } from '@jest/globals'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import { createSqliteRunBudgetStore } from './sqliteRunBudgetStore'
import { DEFAULT_RUN_BUDGET, runBudgetTotals } from '../application/runBudget'

function fixture() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
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
  return { native, provider: { get: async () => database } }
}

test('serializes concurrent root/child reservations in real SQLite and reopens missing/late usage', async () => {
  const { native, provider } = fixture()
  try {
    const store = createSqliteRunBudgetStore(provider)
    await store.create('root', { ...DEFAULT_RUN_BUDGET, tokens: 500 })
    const reserve = (attemptId: string) => store.reserve('root', { attemptId, runId: attemptId, inputEstimate: 100, outputReservation: 200 }, 0)
    const outcomes = await Promise.allSettled([reserve('root-attempt'), reserve('child-attempt')])
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(native.query('SELECT COUNT(*) AS count FROM harness_attempt_owners').get().count).toBe(1)
    const reopened = createSqliteRunBudgetStore(provider)
    await reopened.settle({ attemptId: 'root-attempt', sequence: 0, settled: true, complete: false })
    expect(runBudgetTotals((await reopened.get('root'))!, 0).estimatedTokens).toBe(300)
    const final = { attemptId: 'root-attempt', sequence: 1, settled: true, complete: true, usage: { source: 'provider' as const, inputTokens: 50, outputTokens: 40 } }
    await reopened.settle(final)
    await reopened.settle(final)
    expect(runBudgetTotals((await store.get('root'))!, 0).actualTokens).toBe(90)
    await reserve('child-attempt')
    expect(native.query('SELECT COUNT(*) AS count FROM harness_attempt_owners').get().count).toBe(2)
  } finally { native.close() }
})

test('corrupt storage fails closed without rewriting history', async () => {
  const { native, provider } = fixture()
  try {
    const store = createSqliteRunBudgetStore(provider)
    await store.create('root')
    native.query('UPDATE harness_run_budgets SET snapshotJson = ?').run('{broken')
    await expect(store.reserveTool('root', 'tool', 0)).rejects.toThrow()
    expect(native.query('SELECT snapshotJson FROM harness_run_budgets').get().snapshotJson).toBe('{broken')
  } finally { native.close() }
})

test('persisted child ownership resolves the same root tool budget and active-time union after reopening', async () => {
  const { native, provider } = fixture()
  try {
    const store = createSqliteRunBudgetStore(provider)
    await store.create('root', { ...DEFAULT_RUN_BUDGET, tools: 1 })
    await store.attach('root', 'child')
    await store.setActive('root', true, 100, 'root')
    await store.setActive('root', true, 120, 'child')
    await store.setActive('root', false, 150, 'root')
    const reopened = createSqliteRunBudgetStore(provider)
    expect((await reopened.get('child'))?.rootRunId).toBe('root')
    await reopened.reserveTool('child', 'child-tool', 160)
    await expect(reopened.reserveTool('root', 'root-tool', 170)).rejects.toThrow('tools')
    await reopened.setActive('root', false, 200, 'child')
    expect(runBudgetTotals((await reopened.get('root'))!, 10_000).activeMs).toBe(100)
    expect(native.query('SELECT COUNT(*) AS count FROM harness_run_budgets').get().count).toBe(1)
    for (let index = 0; index < 5; index++) await reopened.attach('root', `child-${index}`)
    await expect(reopened.attach('root', 'seventh')).rejects.toThrow('limit')
  } finally { native.close() }
})
