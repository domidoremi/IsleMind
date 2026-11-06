import { describe, expect, it } from '@jest/globals'
import { createProviderCitationSupportBinder, isProviderCitationSupportCurrent } from '@/core'
import type { SqliteDatabase, SqliteDatabaseProvider, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { Conversation } from '@/types/chatContracts'
import type { ModelRoutingPlan } from '@/core'
import { createSqliteConversationRepository } from './sqliteConversationRepository'

describe('provider citation metadata in conversation records (host SQLite)', () => {
  it('retains the exact answer association through save, adapter reconstruction, paging and snapshot replacement', async () => {
    const { Database } = require('bun:sqlite')
    const native = new Database(':memory:')
    const executor: SqliteExecutor = {
      async exec(sql) { native.exec(sql) },
      async run(sql, values = []) {
        const result = native.query(sql).run(...values)
        return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
      },
      async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).get(...values) as Row | null },
      async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).all(...values) as Row[] },
    }
    const db: SqliteDatabase = { ...executor, async transaction(work) {
      native.exec('BEGIN IMMEDIATE')
      try { const result = await work(executor); native.exec('COMMIT'); return result }
      catch (error) { native.exec('ROLLBACK'); throw error }
    } }
    const provider: SqliteDatabaseProvider = { get: async () => db }
    const answer = 'Answer 日本語 😀\r\n'
    const providerSupport = createProviderCitationSupportBinder(answer)([{ text: '日本語 😀', partIndex: 1, startByte: 8, endByte: 22 }])!
    const record: Conversation = {
      id: 'citation-record', title: 'Synthetic citation persistence', providerId: 'fixture', model: 'fixture',
      systemPrompt: '', temperature: 0, maxTokens: 10, createdAt: 1, updatedAt: 2,
      messages: [{ id: 'answer', role: 'assistant', content: answer, responseText: answer, status: 'done', timestamp: 1,
        citations: [{ id: 'https://example.test/a', type: 'web', title: 'Source', url: 'https://example.test/a', providerSupport }] }],
    }
    try {
      await createSqliteConversationRepository(provider).save(record)
      const reopened = createSqliteConversationRepository(provider)
      const loaded = (await reopened.loadRecord(record.id))!
      expect(loaded.messages[0].citations).toEqual(record.messages[0].citations)
      expect(loaded.messages[0].responseText).toBe(answer)
      expect((await reopened.loadPage({ limit: 1 })).conversations[0].messages[0].citations).toEqual(record.messages[0].citations)
      const snapshot = JSON.parse(JSON.stringify(await reopened.loadReplacementSnapshot())) as Conversation[]
      await reopened.replaceAll(snapshot)
      expect((await createSqliteConversationRepository(provider).loadAll())[0].messages[0].citations).toEqual(record.messages[0].citations)
      loaded.messages[0].responseText = `${answer}Later continuation`
      await reopened.save(loaded)
      const changed = (await reopened.loadRecord(record.id))!.messages[0]
      expect(changed.citations?.[0].providerSupport).toEqual(providerSupport)
      expect(isProviderCitationSupportCurrent(changed.citations![0].providerSupport!, changed.responseText!)).toBe(false)
      expect(await db.getFirst('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' })
    } finally { native.close() }
  })
})

function referenceDatabase() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
  const queries: string[] = []
  const executor: SqliteExecutor = {
    async exec(sql) { queries.push(sql); native.exec(sql) },
    async run(sql, values = []) {
      queries.push(sql); const result = native.query(sql).run(...values)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) {
      queries.push(sql); return native.query(sql).get(...values) as Row | null
    },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) {
      queries.push(sql); return native.query(sql).all(...values) as Row[]
    },
  }
  const database: SqliteDatabase = { ...executor, async transaction(work) {
    native.exec('BEGIN IMMEDIATE')
    try { const result = await work(executor); native.exec('COMMIT'); return result }
    catch (error) { native.exec('ROLLBACK'); throw error }
  } }
  return { native, queries, repository: createSqliteConversationRepository({ get: async () => database }) }
}
const referenceRoute: ModelRoutingPlan = { schema: 'islemind.model-routing-plan.v1', id: 'route', name: 'Route', mode: 'fallback',
  primary: { providerId: 'other', model: 'Primary' }, backup: { providerId: 'A', model: 'Requested-Alias' }, crossProvider: 'ask' }
function referenceRecord(id: string, updatedAt = 1): Conversation {
  return { id, title: id, providerId: 'other', model: 'Primary', routingPlan: referenceRoute,
    systemPrompt: 'PRIVATE PROMPT MUST NOT ESCAPE', temperature: 0, maxTokens: 10, createdAt: 1, updatedAt,
    messages: [{ id: `${id}-message`, role: 'user', content: 'PRIVATE HISTORY MUST NOT ESCAPE', timestamp: 1, status: 'done' }] }
}

describe('connection references through the existing host SQLite adapter', () => {
  it('removes only one addressed history outside the visible page and treats identifiers as parameters', async () => {
    const { native, repository } = referenceDatabase()
    try {
      for (let index = 0; index < 81; index++) await repository.save(referenceRecord(`c-${index}`, index))
      const page = await repository.loadPage({ limit: 40 })
      expect(page.conversations.some(value => value.id === 'c-0')).toBe(false)
      const before = JSON.stringify(native.query('SELECT * FROM conversation_message_records WHERE conversationId != ? ORDER BY conversationId, ordinal').all('c-0'))
      await repository.remove("c-0'); DELETE FROM conversation_records; --")
      expect(native.query('SELECT COUNT(*) AS count FROM conversation_records').get().count).toBe(81)
      await repository.remove('c-0')
      expect(await repository.loadRecord('c-0')).toBeUndefined()
      expect(native.query('SELECT COUNT(*) AS count FROM conversation_record_state').get().count).toBe(80)
      expect(native.query('SELECT COUNT(*) AS count FROM conversation_records').get().count).toBe(80)
      expect(JSON.stringify(native.query('SELECT * FROM conversation_message_records ORDER BY conversationId, ordinal').all())).toBe(before)
      expect((await repository.readProviderReferences({ providerIds: ['A'] })).references).toHaveLength(80)
      expect(native.query('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    } finally { native.close() }
  })

  it('rolls back messages and state when scoped deletion fails, then permits retry', async () => {
    const { native, repository } = referenceDatabase()
    try {
      await repository.save(referenceRecord('kept'))
      await repository.save(referenceRecord('target'))
      const snapshot = () => JSON.stringify(['conversation_records', 'conversation_record_state', 'conversation_message_records']
        .map(table => native.query(`SELECT * FROM ${table} ORDER BY rowid`).all()))
      const before = snapshot()
      native.exec("CREATE TRIGGER reject_deletion BEFORE DELETE ON conversation_records WHEN OLD.id = 'target' BEGIN SELECT RAISE(ABORT, 'fixture deletion failure'); END")
      await expect(repository.remove('target')).rejects.toThrow('fixture deletion failure')
      expect(snapshot()).toBe(before)
      native.exec('DROP TRIGGER reject_deletion')
      await repository.remove('target')
      expect(await repository.loadRecord('target')).toBeUndefined()
      expect((await repository.loadRecord('kept'))?.messages[0].content).toBe('PRIVATE HISTORY MUST NOT ESCAPE')
      expect(native.query('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    } finally { native.close() }
  })

  it('finds references beyond the 40-row history page using only projected metadata and leaves storage unchanged', async () => {
    const { native, repository, queries } = referenceDatabase()
    try {
      for (let index = 0; index < 81; index++) await repository.save(referenceRecord(`c-${index.toString().padStart(3, '0')}`, index))
      const page = await repository.loadPage({ limit: 40 })
      const changes = native.query('SELECT total_changes() AS count').get().count
      queries.length = 0
      const report = await repository.readProviderReferences({ providerIds: ['A'], excludeConversationIds: page.conversations.map(item => item.id) })
      expect(report.inspected).toBe(41)
      expect(report.references).toHaveLength(41)
      expect(report.remaining).toBe(0)
      expect(report.unreadable).toBe(0)
      expect(report.references[0].targets).toEqual([{ providerId: 'A', model: 'Requested-Alias', role: 'backup' }])
      expect(JSON.stringify(report)).not.toMatch(/PRIVATE|messages|systemPrompt/)
      expect(queries.some(sql => /conversation_message_records|systemPrompt|skillVariables|payloadJson/.test(sql))).toBe(false)
      expect(native.query('SELECT total_changes() AS count').get().count).toBe(changes)
      expect(native.query('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    } finally { native.close() }
  })

  it('reports scan limits, corrupt or missing states and orphaned metadata without hiding them as no references', async () => {
    const { native, repository } = referenceDatabase()
    try {
      for (let index = 0; index < 5; index++) await repository.save(referenceRecord(`c-${index}`, index))
      native.query('UPDATE conversation_record_state SET stateJson = ? WHERE conversationId = ?').run('{bad json', 'c-4')
      native.query('DELETE FROM conversation_record_state WHERE conversationId = ?').run('c-3')
      native.query('INSERT INTO conversation_record_state (conversationId, stateJson, messageCount) VALUES (?, ?, ?)').run('orphan', '{}', 0)
      const partial = await repository.readProviderReferences({ providerIds: ['A'], limit: 2 })
      expect(partial).toEqual({ references: [], inspected: 2, remaining: 3, unreadable: 3 })
      const all = await repository.readProviderReferences({ providerIds: ['A'] })
      expect(all.references).toHaveLength(3)
      expect(all.unreadable).toBe(3)
      expect(all.remaining).toBe(0)
    } finally { native.close() }
  })

  it('rejects unsupported route metadata and mismatched IDs and does not perform message recovery', async () => {
    const { native, repository, queries } = referenceDatabase()
    try {
      await repository.save(referenceRecord('future'))
      await repository.save(referenceRecord('mismatch'))
      native.query('UPDATE conversation_record_state SET stateJson = ? WHERE conversationId = ?')
        .run(JSON.stringify({ ...referenceRecord('future'), routingPlan: { ...referenceRoute, schema: 'future' } }), 'future')
      native.query('UPDATE conversation_record_state SET stateJson = ? WHERE conversationId = ?')
        .run(JSON.stringify(referenceRecord('other-id')), 'mismatch')
      queries.length = 0
      expect(await repository.readProviderReferences({ providerIds: ['A'] })).toEqual({ references: [], inspected: 2, remaining: 0, unreadable: 2 })
      expect(queries.some(sql => /conversation_message_records/.test(sql))).toBe(false)
    } finally { native.close() }
  })

  it('keeps scope values as SQL parameters and validates the read budget', async () => {
    const { native, repository } = referenceDatabase()
    try {
      await repository.save(referenceRecord('kept'))
      expect((await repository.readProviderReferences({ providerIds: ["A'); DROP TABLE conversation_records; --"] })).references).toEqual([])
      expect((await repository.readProviderReferences({ providerIds: ['A'], excludeConversationIds: ["kept'); DROP TABLE conversation_records; --"] })).references).toHaveLength(1)
      await expect(repository.readProviderReferences({ providerIds: ['A'], limit: 2001 })).rejects.toThrow('budget')
      expect(native.query('SELECT COUNT(*) AS count FROM conversation_records').get().count).toBe(1)
    } finally { native.close() }
  })
})
