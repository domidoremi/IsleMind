import { expect, test } from '@jest/globals'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import { createAgentDefinition } from '../agentDefinition'
import { createSqliteAgentDefinitionRepository } from './sqliteAgentDefinitionRepository'

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
const agent = (id = 'agent-1') => createAgentDefinition({ id, name: 'Research', providerId: 'provider', modelId: 'model' })

test('transactional portable compare-and-replace is repeatable and refuses concurrent edits or aborted import', async () => {
  const { native, provider } = fixture()
  try {
    const store = createSqliteAgentDefinitionRepository(provider)
    await store.save(agent())
    const source = await store.loadSnapshot()
    const target = [agent('imported')]
    await store.replaceSnapshot(target, [source, target])
    await store.replaceSnapshot(target, [source, target])
    expect(await store.loadSnapshot()).toEqual(target)
    await store.replaceSnapshot(source, [source, target])
    await store.save({ ...source[0], name: 'concurrent edit' }, 1)
    await expect(store.replaceSnapshot(target, [source, target])).rejects.toThrow()
    expect((await store.loadSnapshot())[0].name).toBe('concurrent edit')
    const cancelled = new AbortController(); cancelled.abort()
    await expect(store.replaceSnapshot([], [await store.loadSnapshot()], cancelled.signal)).rejects.toThrow()
    expect((await store.loadSnapshot()).length).toBe(1)
  } finally { native.close() }
})

test('fails the current operation but allows a fresh attempt after transient initialization failure', async () => {
  const { native, provider } = fixture()
  try {
    const db = await provider.get()
    const getFirst = db.getFirst.bind(db)
    let fail = true
    db.getFirst = async (...args) => { if (fail) { fail = false; throw new Error('temporary storage failure') }; return getFirst(...args) }
    const store = createSqliteAgentDefinitionRepository(provider)
    await expect(store.list()).rejects.toThrow('temporary storage failure')
    expect(await store.list()).toEqual([])
    await store.save(agent())
    expect((await store.list()).length).toBe(1)
  } finally { native.close() }
})

test('persists, reopens, pages, detects concurrent edits and deletes by revision in real SQLite', async () => {
  const { native, provider } = fixture()
  try {
    const store = createSqliteAgentDefinitionRepository(provider)
    const original = await store.save(agent())
    await store.save(agent('agent-2'))
    expect(await createSqliteAgentDefinitionRepository(provider).get(original.id)).toEqual(original)
    expect((await store.list({ limit: 1 }))[0].id).toBe('agent-1')
    expect((await store.list({ afterId: 'agent-1', limit: 1 }))[0].id).toBe('agent-2')
    const outcomes = await Promise.allSettled([store.save({ ...original, name: 'First' }, 1), store.save({ ...original, name: 'Stale' }, 1)])
    expect(outcomes.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((await store.get(original.id))?.revision).toBe(2)
    await expect(store.save(original)).rejects.toThrow()
    await expect(store.remove(original.id, 1)).rejects.toThrow()
    await store.remove(original.id, 2)
    expect(await store.get(original.id)).toBeUndefined()
    await store.clear()
    expect(await createSqliteAgentDefinitionRepository(provider).list()).toEqual([])
  } finally { native.close() }
})

test('rejects untrusted definitions, oversized pages and corrupt storage without rewriting data', async () => {
  const { native, provider } = fixture()
  try {
    const store = createSqliteAgentDefinitionRepository(provider)
    await expect(store.save({ ...agent(), grants: ['network'] } as ReturnType<typeof agent>)).rejects.toThrow()
    await store.save(agent())
    await expect(store.list({ limit: 500 })).rejects.toThrow()
    native.query('UPDATE assistant_agent_definitions SET definitionJson = ?').run('{broken')
    await expect(store.get('agent-1')).rejects.toThrow()
    await expect(store.list()).rejects.toThrow()
    await expect(store.save(agent(), 1)).rejects.toThrow()
    expect(native.query('SELECT definitionJson FROM assistant_agent_definitions').get().definitionJson).toBe('{broken')
  } finally { native.close() }
})

test('future repository migrations fail closed', async () => {
  const { native, provider } = fixture()
  try {
    await createSqliteAgentDefinitionRepository(provider).save(agent())
    native.query('INSERT INTO platform_schema_migrations VALUES (?, ?, ?, ?)').run('assistant-agent-definitions', 2, 'future', 0)
    await expect(createSqliteAgentDefinitionRepository(provider).get('agent-1')).rejects.toThrow('Unsupported agent repository schema')
  } finally { native.close() }
})
