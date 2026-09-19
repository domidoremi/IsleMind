/** @jest-environment node */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createProviderCompactStateRepository, type CompactStateRecord } from './providerCompactStateRepository'
import { createProviderRemoteCompactLifecycle } from './providerRemoteCompactLifecycle'

const input = {
  conversationId: 'conversation', providerId: 'provider', model: 'namespace/model',
  settings: { remoteCompactMode: 'auto' as const }, strategy: 'native-openai-responses' as const,
  capabilityKind: 'native-compaction' as const, remoteClassification: 'remote-available' as const,
}
const completed = { ...input, mode: 'auto' as const, messageCount: 2, responseId: 'response-1',
  contextFragments: [{ id: 'f', sourceId: 's', sourceHash: 'hash', included: true }] }

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'islemind-compact-'))
  let db = new DatabaseSync(join(directory, 'context.db'))
  const open = async () => ({
    async execAsync(sql: string) { db.exec(sql) },
    async runAsync(sql: string, ...args: (string | number | null)[]) { return db.prepare(sql).run(...args) },
    async getAllAsync<T>(sql: string, ...args: (string | number | null)[]) { return db.prepare(sql).all(...args) as T[] },
  })
  const repository = () => createProviderCompactStateRepository({ openDatabase: open, now: () => 100 })
  const events: unknown[] = []
  const lifecycle = (repo = repository()) => createProviderRemoteCompactLifecycle({
    ...repo, now: () => 100, recordCompactUsage: value => ({ ...value, id: 'usage', createdAt: 100 }),
    async emitRuntimeEvent(value) { events.push(value) },
  })
  return { repository, lifecycle, events, sql: (sql: string) => db.exec(sql),
    reopen() { db.close(); db = new DatabaseSync(join(directory, 'context.db')); return lifecycle() },
    close() { db.close(); rmSync(directory, { recursive: true, force: true }) } }
}

test('real SQLite continuation survives connection close and reopen, retaining exact namespace and fragment identity', async () => {
  const f = fixture()
  try {
    await f.lifecycle().recordCompleted(completed)
    expect(await f.reopen().resolvePreviousState(input)).toEqual({ previousResponseId: 'response-1', previousFragments: completed.contextFragments })
    for (const mismatch of [{ model: 'model' }, { providerId: 'other' }, { conversationId: 'other' }]) {
      expect(await f.lifecycle().resolvePreviousState({ ...input, ...mismatch })).toEqual({})
    }
  } finally { f.close() }
})

test.each(['conversation', 'provider', 'all', 'clear', 'expired'])('%s invalidation survives restart and cannot reuse continuation', async mode => {
  const f = fixture()
  try {
    const repo = f.repository()
    await f.lifecycle(repo).recordCompleted(completed)
    if (mode === 'conversation') await repo.invalidateCompactStates(input.conversationId)
    if (mode === 'provider') await repo.invalidateCompactStatesByProvider(input.providerId)
    if (mode === 'all') await repo.invalidateAllCompactStates()
    if (mode === 'clear') await repo.clearAllCompactStates()
    if (mode === 'expired') f.sql('UPDATE compact_states SET expiresAt=99')
    expect(await f.reopen().resolvePreviousState(input)).toEqual({})
  } finally { f.close() }
})

test('identical upstream response IDs in different scopes cannot overwrite each other', async () => {
  const f = fixture()
  try {
    const other = { ...input, providerId: 'other-provider' }
    await f.lifecycle().recordCompleted(completed)
    await f.lifecycle().recordCompleted({ ...completed, ...other })
    const restarted = f.reopen()
    expect((await restarted.resolvePreviousState(input)).previousResponseId).toBe(completed.responseId)
    expect((await restarted.resolvePreviousState(other)).previousResponseId).toBe(completed.responseId)
  } finally { f.close() }
})

test.each([
  "compactItemJson='{broken'", "contextFragmentIdentitiesJson='{broken'",
  "contextFragmentIdentitiesJson='[{}]'", "sourceMessageEndIndex=-1", "responseId='different'",
])('corrupt persisted %s falls back without replacing history or dispatching unverified continuation', async mutation => {
  const f = fixture()
  try {
    await f.lifecycle().recordCompleted(completed)
    f.sql(`UPDATE compact_states SET ${mutation}`)
    expect(await f.reopen().resolvePreviousState(input)).toEqual({})
  } finally { f.close() }
})

test('schema upgrade preserves legacy rows; missing optional fragment metadata remains compatible', async () => {
  const f = fixture()
  try {
    f.sql(`CREATE TABLE compact_states (id TEXT PRIMARY KEY, conversationId TEXT, providerId TEXT, model TEXT,
      responseId TEXT, sessionId TEXT, compactItemJson TEXT, sourceMessageStartIndex INTEGER, sourceMessageEndIndex INTEGER,
      inputTokens INTEGER, outputTokens INTEGER, estimatedSavedTokens INTEGER, status TEXT, failureCode TEXT, createdAt INTEGER, updatedAt INTEGER, expiresAt INTEGER)`)
    await f.lifecycle().recordCompleted({ ...completed, contextFragments: undefined })
    expect(await f.reopen().resolvePreviousState(input)).toEqual({ previousResponseId: 'response-1', previousFragments: undefined })
  } finally { f.close() }
})

test('failed write is disclosed, leaves prior acknowledged state intact, and can recover', async () => {
  const f = fixture()
  try {
    await f.lifecycle().recordCompleted(completed)
    f.sql("CREATE TRIGGER reject_compact BEFORE INSERT ON compact_states BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END")
    await f.lifecycle().recordCompleted({ ...completed, responseId: 'new' })
    expect(f.events).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ status: 'storage_write_failed' }) }))
    expect((await f.reopen().resolvePreviousState(input)).previousResponseId).toBe('response-1')
    f.sql('DROP TRIGGER reject_compact')
    await f.lifecycle().recordCompleted({ ...completed, responseId: 'new' })
    expect((await f.reopen().resolvePreviousState(input)).previousResponseId).toBe('new')
  } finally { f.close() }
})

test('completion awaits durable acknowledgement rather than abandoning a pending write', async () => {
  let release!: () => void
  let acknowledged = false
  const lifecycle = createProviderRemoteCompactLifecycle({ now: () => 100,
    recordCompactUsage: value => ({ ...value, id: 'usage', createdAt: 100 }),
    async listActiveCompactStates() { return [] }, async emitRuntimeEvent() {},
    async saveCompactState(_state: CompactStateRecord) { await new Promise<void>(resolve => { release = resolve }); acknowledged = true },
  })
  let settled = false
  const pending = lifecycle.recordCompleted(completed).then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  release()
  await pending
  expect(acknowledged).toBe(true)
})
