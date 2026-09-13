import { describe, expect, it } from '@jest/globals'
import type { SqliteDatabase, SqliteDatabaseProvider, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { Conversation } from '@/types/chatContracts'
import { createSqliteConversationRepository } from './sqliteConversationRepository'

function fixture() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
  native.exec('PRAGMA foreign_keys = ON')
  const executor: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) { const result = native.query(sql).run(...values); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) } },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).get(...values) as Row | null },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).all(...values) as Row[] },
  }
  const database: SqliteDatabase = { ...executor, async transaction(work) {
    native.exec('BEGIN IMMEDIATE')
    try { const result = await work(executor); native.exec('COMMIT'); return result }
    catch (error) { native.exec('ROLLBACK'); throw error }
  } }
  const provider: SqliteDatabaseProvider = { get: async () => database }
  return { native, database, provider }
}

const conversation: Conversation = {
  id: 'c', title: 'Preserve history', providerId: 'p', model: 'alias', providerModelMode: 'manual',
  systemPrompt: '', temperature: 0, maxTokens: 10, createdAt: 1, updatedAt: 2,
  messages: [{ id: 'm', role: 'assistant', content: 'Old answer', status: 'done', timestamp: 1 }],
}

describe('nullable Conversation preference migration (real SQLite)', () => {
  it('migrates v2, preserves message bytes, and round-trips unbound and partial legacy values after restart', async () => {
    const { native, provider } = fixture()
    try {
      native.exec(`CREATE TABLE platform_schema_migrations (scope TEXT, version INTEGER, name TEXT, appliedAt INTEGER, PRIMARY KEY(scope, version));
        INSERT INTO platform_schema_migrations VALUES ('conversations', 1, 'old', 1), ('conversations', 2, 'old', 1);
        CREATE TABLE conversation_records (id TEXT PRIMARY KEY, title TEXT NOT NULL, providerId TEXT NOT NULL, model TEXT NOT NULL, updatedAt INTEGER NOT NULL);
        CREATE TABLE conversation_record_state (conversationId TEXT PRIMARY KEY, stateJson TEXT NOT NULL, messageCount INTEGER NOT NULL);
        CREATE TABLE conversation_message_records (conversationId TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, messageJson TEXT NOT NULL, PRIMARY KEY(conversationId,id), UNIQUE(conversationId,ordinal));`)
      native.query('INSERT INTO conversation_records VALUES (?, ?, ?, ?, ?)').run('c', conversation.title, 'p', 'alias', 2)
      native.query('INSERT INTO conversation_record_state VALUES (?, ?, ?)').run('c', JSON.stringify({ ...conversation, messages: [] }), 1)
      const historicalJson = JSON.stringify(conversation.messages[0])
      native.query('INSERT INTO conversation_message_records VALUES (?, ?, ?, ?)').run('c', 'm', 0, historicalJson)
      const repo = createSqliteConversationRepository(provider)
      expect(await repo.loadRecord('c')).toEqual(conversation)
      expect(native.query('SELECT messageJson FROM conversation_message_records').get().messageJson).toBe(historicalJson)
      expect(native.query("SELECT name FROM platform_schema_migrations WHERE scope='conversations' AND version=3").get().name).toBe('nullable-conversation-model-preference')
      for (const [index, preference] of [{ providerId: null, model: null }, { providerId: '', model: 'legacy-model' }, { providerId: 'p', model: null }].entries()) {
        await repo.save({ ...conversation, id: `unbound-${index}`, ...preference })
      }
      const reopened = createSqliteConversationRepository(provider)
      expect(await reopened.loadRecord('unbound-0')).toMatchObject({ providerId: null, model: null })
      expect(await reopened.loadRecord('unbound-1')).toMatchObject({ providerId: '', model: 'legacy-model' })
      expect((await reopened.loadRecord('unbound-2'))?.messages).toEqual(conversation.messages)
      const snapshot = await reopened.loadReplacementSnapshot()
      await reopened.replaceAll(snapshot)
      expect(await reopened.loadReplacementSnapshot()).toEqual(snapshot)
    } finally { native.close() }
  })

  it('does not let deferred v2 restore NOT NULL or discard unresolved legacy payload', async () => {
    const { native, provider } = fixture()
    try {
      native.exec('CREATE TABLE conversation_records (id TEXT PRIMARY KEY, title TEXT NOT NULL, providerId TEXT NOT NULL, model TEXT NOT NULL, updatedAt INTEGER NOT NULL, payloadJson TEXT NOT NULL)')
      native.query('INSERT INTO conversation_records VALUES (?, ?, ?, ?, ?, ?)').run('broken', 'Archive', 'p', 'a', 1, '{unresolved')
      const repo = createSqliteConversationRepository(provider)
      await repo.loadAll()
      expect(native.query("SELECT payloadJson FROM conversation_records WHERE id='broken'").get().payloadJson).toBe('{unresolved')
      expect(native.query("SELECT version FROM platform_schema_migrations WHERE scope='conversations' AND version=2").get()).toBeNull()
      native.query("UPDATE conversation_records SET payloadJson=? WHERE id='broken'").run(JSON.stringify({ ...conversation, id: 'broken' }))
      const reopened = createSqliteConversationRepository(provider)
      await reopened.loadAll()
      expect(native.query('PRAGMA table_info(conversation_records)').all().find((row: { name: string }) => row.name === 'payloadJson')).toBeUndefined()
      await reopened.save({ ...conversation, id: 'unbound', providerId: null, model: null })
      expect((await reopened.loadRecord('unbound'))?.model).toBeNull()
    } finally { native.close() }
  })

  it('rolls back a failed full save without changing preference or historical messages', async () => {
    const { native, provider } = fixture()
    try {
      const repo = createSqliteConversationRepository(provider)
      await repo.save(conversation)
      native.exec("CREATE TRIGGER reject_preference BEFORE UPDATE ON conversation_records BEGIN SELECT RAISE(ABORT, 'storage failure'); END")
      await expect(repo.save({ ...conversation, model: 'other' })).rejects.toThrow('storage failure')
      expect(await repo.loadRecord('c')).toEqual(conversation)
      expect(native.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally { native.close() }
  })

  it('persists actual protocol metadata without binding legacy messages to current Conversation identity', async () => {
    const { native, provider } = fixture()
    try {
      const repo = createSqliteConversationRepository(provider)
      const actual = { ...conversation.messages[0], id: 'actual', providerId: 'provider-B', model: 'upstream-B', generationProtocol: { schema: 'islemind.message-protocol.v1' as const, adapterId: 'anthropic' as const } }
      await repo.save({ ...conversation, providerId: 'provider-C', model: 'model-C', messages: [...conversation.messages, actual] })
      const loaded = (await createSqliteConversationRepository(provider).loadRecord('c'))!
      expect(loaded.messages[1]).toEqual(actual)
      expect(loaded.messages[0].providerId).toBeUndefined()
      expect(loaded.providerId).toBe('provider-C')
    } finally { native.close() }
  })
})
