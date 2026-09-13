import { describe, expect, it } from '@jest/globals'
import { createProviderCitationSupportBinder, isProviderCitationSupportCurrent } from '@/core'
import type { SqliteDatabase, SqliteDatabaseProvider, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { Conversation } from '@/types/chatContracts'
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
