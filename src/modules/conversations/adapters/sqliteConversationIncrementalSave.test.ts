import { describe, expect, it } from '@jest/globals'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { Conversation, Message } from '@/types/chatContracts'
import { createSqliteConversationRepository } from './sqliteConversationRepository'

function fixture() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
  native.exec('PRAGMA foreign_keys = ON')
  const executor: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) {
      const result = native.query(sql).run(...values)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) {
      return native.query(sql).get(...values) as Row | null
    },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) {
      return native.query(sql).all(...values) as Row[]
    },
  }
  const database: SqliteDatabase = { ...executor, async transaction(work) {
    native.exec('BEGIN IMMEDIATE')
    try { const value = await work(executor); native.exec('COMMIT'); return value }
    catch (error) { native.exec('ROLLBACK'); throw error }
  } }
  const repository = createSqliteConversationRepository({ get: async () => database })
  const message = (id: string): Message => ({ id, role: 'assistant', content: `Answer ${id}`, status: 'done', timestamp: 1 })
  const conversation = (size: number): Conversation => ({
    id: 'incremental-conversation', title: 'Incremental save', providerId: 'fixture', model: 'fixture',
    systemPrompt: '', temperature: 0.2, maxTokens: 100, createdAt: 1, updatedAt: 1,
    messages: Array.from({ length: size }, (_, index) => message(`m-${index}`)),
  })
  const observeMessageWrites = () => native.exec(`
    CREATE TABLE observed_message_writes (operation TEXT NOT NULL, messageId TEXT NOT NULL);
    CREATE TRIGGER observe_message_update AFTER UPDATE ON conversation_message_records
      BEGIN INSERT INTO observed_message_writes VALUES ('update', NEW.id); END;
    CREATE TRIGGER observe_message_insert AFTER INSERT ON conversation_message_records
      BEGIN INSERT INTO observed_message_writes VALUES ('insert', NEW.id); END;
    CREATE TRIGGER observe_message_delete AFTER DELETE ON conversation_message_records
      BEGIN INSERT INTO observed_message_writes VALUES ('delete', OLD.id); END;
  `)
  return { native, repository, message, conversation, observeMessageWrites }
}

describe('incremental conversation writes (real SQLite)', () => {
  it.each([8, 256])('updates only the changed reply with %i existing messages', async size => {
    const { native, repository, conversation, observeMessageWrites } = fixture()
    try {
      const record = conversation(size)
      await repository.save(record)
      observeMessageWrites()
      record.messages[size - 1] = { ...record.messages[size - 1], content: '追加 日本語 😀', status: 'streaming' }
      record.updatedAt = 2
      await repository.save(record)
      const writes = native.query('SELECT * FROM observed_message_writes').all() as Array<{ messageId: string }>
      expect(writes).toHaveLength(1)
      expect(writes[0].messageId).toBe(`m-${size - 1}`)
      expect(await repository.loadRecord(record.id)).toEqual(record)
      native.exec('DELETE FROM observed_message_writes')
      record.title = 'Metadata only'
      await repository.save(record)
      expect(native.query('SELECT * FROM observed_message_writes').all()).toEqual([])
      expect(await repository.loadRecord(record.id)).toEqual(record)
    } finally { native.close() }
  })

  it('appends and removes the last message without touching earlier rows', async () => {
    const { native, repository, conversation, message, observeMessageWrites } = fixture()
    try {
      const record = conversation(32)
      await repository.save(record)
      observeMessageWrites()
      record.messages.push(message('appended'))
      await repository.save(record)
      expect(native.query('SELECT * FROM observed_message_writes').all()).toEqual([{ operation: 'insert', messageId: 'appended' }])
      expect(await repository.loadRecord(record.id)).toEqual(record)
      native.exec('DELETE FROM observed_message_writes')
      record.messages.pop()
      await repository.save(record)
      expect(native.query('SELECT * FROM observed_message_writes').all()).toEqual([{ operation: 'delete', messageId: 'appended' }])
      expect(await repository.loadRecord(record.id)).toEqual(record)
    } finally { native.close() }
  })

  it('preserves order through swaps, insertion, deletion and replacement with ordinal uniqueness', async () => {
    const { native, repository, conversation, message } = fixture()
    try {
      const record = conversation(5)
      await repository.save(record)
      const verify = async () => {
        await repository.save(record)
        expect(await repository.loadRecord(record.id)).toEqual(record)
        expect(native.query('SELECT id, ordinal FROM conversation_message_records ORDER BY ordinal').all())
          .toEqual(record.messages.map((value, ordinal) => ({ id: value.id, ordinal })))
        expect(native.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      }
      ;[record.messages[0], record.messages[4]] = [record.messages[4], record.messages[0]]
      await verify()
      record.messages.splice(1, 0, message('inserted'))
      await verify()
      record.messages.splice(2, 2)
      await verify()
      record.messages[1] = message('replacement')
      await verify()
      record.messages = []
      await verify()
    } finally { native.close() }
  })

  it('rolls back a failed save after moving ordinals', async () => {
    const { native, repository, conversation } = fixture()
    try {
      const record = conversation(4)
      await repository.save(record)
      const before = await repository.loadRecord(record.id)
      native.exec(`CREATE TRIGGER fail_message_write BEFORE INSERT ON conversation_message_records
        WHEN NEW.id = 'm-2' BEGIN SELECT RAISE(ABORT, 'deliberate save failure'); END;`)
      record.messages.reverse()
      await expect(repository.save(record)).rejects.toThrow('deliberate save failure')
      expect(await repository.loadRecord(record.id)).toEqual(before)
      expect(native.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally { native.close() }
  })

  it('rolls back metadata and earlier reply updates when an incremental save fails', async () => {
    const { native, repository, conversation } = fixture()
    try {
      const record = conversation(4)
      await repository.save(record)
      const before = await repository.loadRecord(record.id)
      native.exec(`CREATE TRIGGER fail_incremental_write BEFORE INSERT ON conversation_message_records
        WHEN NEW.id = 'm-3' BEGIN SELECT RAISE(ABORT, 'deliberate incremental failure'); END;`)
      record.title = 'Must roll back'
      record.updatedAt = 2
      record.messages[1].content = 'Earlier changed reply'
      record.messages[3].content = 'Failed reply'
      await expect(repository.save(record)).rejects.toThrow('deliberate incremental failure')
      expect(await repository.loadRecord(record.id)).toEqual(before)
      native.exec('DROP TRIGGER fail_incremental_write')
      await repository.save(record)
      expect(await repository.loadRecord(record.id)).toEqual(record)
      expect(native.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally { native.close() }
  })
})
