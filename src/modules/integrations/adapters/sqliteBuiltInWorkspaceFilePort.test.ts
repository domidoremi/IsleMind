import { afterEach, expect, test } from '@jest/globals'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import { createSqliteTaskPersistence, createTaskRuntime } from '@/modules/tasks'
import { createBuiltInCapabilityTaskAdmissionPort, createBuiltInCapabilityRuntimeBinding } from '@/bootstrap/builtInCapabilityRuntime'
import { createSqliteBuiltInWorkspaceFilePort } from './sqliteBuiltInWorkspaceFilePort'

const closes: Array<() => void> = []
afterEach(() => { for (const close of closes.splice(0)) close() })

function fixture() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
  native.exec('PRAGMA foreign_keys=ON')
  closes.push(() => native.close())
  const statements: string[] = []
  const executor: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) { const result = native.query(sql).run(...values); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) } },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).get(...values) as Row | null },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { statements.push(sql); return native.query(sql).all(...values) as Row[] },
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
  const createPort = (scope = 'agent-workspace') => createSqliteBuiltInWorkspaceFilePort({ databaseProvider: provider,
    workspaceScopeId: scope, digestText: text => require('node:crypto').createHash('sha256').update(text).digest('hex') })
  const files = createPort()
  const signal = new AbortController().signal
  const seed = (path: string, text: string, port = files) => port.editTextAtomic({ relativePath: path, text, mimeType: 'text/plain', expectedRevision: 'absent:v1', idempotencyKey: `seed:${path.replaceAll('/', ':')}` }, { signal })
  return { files, createPort, native, statements, provider, signal, seed }
}

test('lists bounded keyset pages inside exactly one scope and directory, including literal wildcard names', async () => {
  const f = fixture()
  await f.seed('workspace/notes/a.txt', 'one')
  await f.seed('workspace/notes/deep/b.txt', 'two')
  await f.seed('workspace/notes-other/c.txt', 'outside')
  await f.seed('workspace/notes/secret.txt', 'other scope', f.createPort('other'))
  await f.seed('workspace/100_literal/d.txt', 'literal')
  const first = await f.files.queryFiles({ directory: 'workspace/notes', limit: 1 }, { signal: f.signal })
  expect(first.files.map(file => file.relativePath)).toEqual(['workspace/notes/a.txt'])
  expect(first.nextAfterPath).toBe('workspace/notes/a.txt')
  const second = await f.files.queryFiles({ directory: 'workspace/notes/', limit: 1, afterPath: first.nextAfterPath }, { signal: f.signal })
  expect(second.files.map(file => file.relativePath)).toEqual(['workspace/notes/deep/b.txt'])
  expect(second.nextAfterPath).toBeUndefined()
  expect((await f.files.queryFiles({ directory: 'workspace/100_literal', limit: 10 }, { signal: f.signal })).files).toHaveLength(1)
  expect(f.statements.at(-1)).not.toMatch(/SELECT[^]*?\btextContent\s*(?:,|FROM)/)
})

test('searches literal case-sensitive text with bounded excerpts and survives reopening the port', async () => {
  const f = fixture()
  await f.seed('workspace/a.txt', `${'x'.repeat(2_000)}needle%_['中文']${'z'.repeat(2_000)}`)
  await f.seed('workspace/b.txt', 'NEEDLE')
  const page = await f.createPort().queryFiles({ directory: 'workspace', limit: 10, query: "needle%_['中文']" }, { signal: f.signal })
  expect(page.files).toHaveLength(1)
  expect(page.files[0].snippet).toContain("needle%_['中文']")
  expect(page.files[0].snippet!.length).toBeLessThanOrEqual(320)
  expect(page.files[0].revision).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect((await f.files.queryFiles({ directory: 'workspace', limit: 10, query: "' OR 1=1 --" }, { signal: f.signal })).files).toEqual([])
})

test('page text budgets retain complete records and an advancing cursor', async () => {
  const f = fixture()
  for (let index = 0; index < 20; index++) await f.seed(`workspace/${String(index).padStart(2, '0')}${'a'.repeat(150)}.txt`, 'needle ' + 'x'.repeat(500))
  const paths: string[] = []
  let afterPath: string | undefined
  do {
    const page = await f.files.queryFiles({ directory: 'workspace', query: 'needle', limit: 20, afterPath }, { signal: f.signal })
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(3_600)
    expect(page.files.length).toBeGreaterThan(0)
    paths.push(...page.files.map(file => file.relativePath))
    afterPath = page.nextAfterPath
  } while (afterPath && paths.length <= 20)
  expect(paths).toHaveLength(20)
  expect(new Set(paths).size).toBe(20)
})

test.each(['../workspace', 'knowledge', 'file:///workspace', 'workspace/../secrets', 'workspace/%2e%2e', 'workspace\\notes'])('rejects non-canonical or out-of-scope directory %s', async directory => {
  const f = fixture()
  await expect(f.files.queryFiles({ directory, limit: 10 }, { signal: f.signal })).rejects.toThrow()
  expect(f.statements).toEqual([])
})

test('cancellation and invalid limits/cursors fail before reading any workspace data', async () => {
  const f = fixture()
  const controller = new AbortController(); controller.abort()
  await expect(f.files.queryFiles({ directory: 'workspace', limit: 10 }, { signal: controller.signal })).rejects.toThrow()
  for (const input of [{ limit: 21 }, { limit: 0 }, { limit: 1.5 }, { limit: 10, afterPath: 'knowledge/x.txt' }, { limit: 10, query: '' }]) {
    await expect(f.files.queryFiles({ directory: 'workspace', ...input }, { signal: f.signal })).rejects.toThrow()
  }
  expect(f.statements).toEqual([])
})

test('Tasks → local SQLite discovery/read/confirmed CAS edit → durable receipts', async () => {
  const f = fixture()
  await f.seed('workspace/notes.txt', 'old value')
  const persistence = createSqliteTaskPersistence(f.provider)
  let sequence = 0
  const tasks = createTaskRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => `task-${++sequence}` },
    policyEvaluator: { async evaluate(input) { return { outcome: input.toolId.endsWith(':edit_file') ? 'requires-confirmation' : 'allowed', reasonCode: 'fixture-policy' } } } })
  const binding = createBuiltInCapabilityRuntimeBinding({ admission: createBuiltInCapabilityTaskAdmissionPort(tasks.getTask),
    workspaceFiles: f.files, workspaceFileQuery: f.files })
  const call = async (name: string, args: Record<string, string>, approve = false) => {
    const adapter = binding.resolveAdapter(`builtin:islemind-builtins:${name}`)!
    const created = await tasks.create({ toolId: adapter.definition.id, idempotencyKey: `operation-${++sequence}` })
    if (!created.ok) throw new Error(created.error.message)
    if (approve) expect((await tasks.confirm(created.value.id, { confirmationId: 'explicit-user-action' })).ok).toBe(true)
    let result: Awaited<ReturnType<typeof adapter.execute>> | undefined
    const executed = await tasks.execute(created.value.id, { async execute(task, options) {
      result = await adapter.execute({ taskId: task.id, tool: adapter.definition, arguments: args }, options)
      if (!result.observation.ok) throw new Error(result.observation.output)
      return { summary: result.summary }
    } })
    return { executed, result }
  }
  const listed = await call('list_files', {})
  expect(listed.executed.ok).toBe(true)
  const path = JSON.parse(listed.result!.observation.blocks[0].text!).files[0].relativePath
  const read = await call('read_file', { path })
  const info = JSON.parse(read.result!.observation.blocks.find(block => block.name === 'workspace-file-info')!.text!)
  expect(info.revision).toMatch(/^sha256:/)
  expect(read.result!.observation.blocks.find(block => block.name === 'workspace-text')!.text).toBe('old value')
  const denied = await call('edit_file', { path, expectedRevision: info.revision, text: 'new value' })
  expect(denied.executed).toMatchObject({ ok: false, error: { code: 'confirmation_required' } })
  expect(denied.result).toBeUndefined()
  const edit = await call('edit_file', { path, expectedRevision: info.revision, text: 'new value' }, true)
  expect(edit.executed.ok).toBe(true)
  const editedInfo = JSON.parse(edit.result!.observation.blocks[0].text!)
  expect(editedInfo.previousRevision).toBe(info.revision)
  expect(editedInfo.revision).not.toBe(info.revision)
  const stale = await call('edit_file', { path, expectedRevision: info.revision, text: 'stale overwrite' }, true)
  expect(stale.result?.observation.ok).toBe(false)
  expect(stale.executed.ok).toBe(false)
  expect((await f.createPort().readText(path, { signal: f.signal, maxBytes: 100 })).text).toBe('new value')
  const search = await call('search_files', { query: 'new value' })
  expect(search.result!.observation.blocks[0].text).toContain('new value')
  if (!edit.executed.ok) throw new Error('Expected a completed edit')
  expect((await persistence.get(edit.executed.value.id))?.status).toBe('succeeded')
  expect((await persistence.list(edit.executed.value.id)).map(entry => entry.type)).toEqual(['task.created', 'task.confirmed', 'task.started', 'task.succeeded'])
})

test('separate Tasks runtimes cannot dispatch the same durable operation twice', async () => {
  const f = fixture()
  const persistence = createSqliteTaskPersistence(f.provider)
  const runtime = () => createTaskRuntime({ persistence, clock: { now: Date.now }, ids: { next: () => 'task-race' },
    policyEvaluator: { async evaluate() { return { outcome: 'allowed', reasonCode: 'fixture' } } } })
  const first = runtime(); const second = runtime()
  const created = await first.create({ toolId: 'list_files', idempotencyKey: 'same-operation' })
  if (!created.ok) throw new Error(created.error.message)
  let dispatches = 0
  const executor = { async execute() { dispatches++; return { summary: 'listed' } } }
  const results = await Promise.all([first.execute(created.value.id, executor), second.execute(created.value.id, executor)])
  expect(dispatches).toBe(1)
  expect(results.filter(result => result.ok)).toHaveLength(1)
  expect((await persistence.get(created.value.id))?.status).toBe('succeeded')
})
