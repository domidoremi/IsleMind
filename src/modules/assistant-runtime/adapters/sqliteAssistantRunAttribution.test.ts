import { describe, expect, it } from '@jest/globals'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { createSqliteAssistantRunPersistence } from './sqliteAssistantRunStore'
import { createAssistantRuntime } from '../runtime'
import { getAssistantRunMessageAttribution } from '../application/actualExecutionAttribution'

function fixture() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
  native.exec('PRAGMA foreign_keys=ON')
  const executor: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) { const value = native.query(sql).run(...values); return { changes: value.changes, lastInsertRowId: Number(value.lastInsertRowid) } },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).get(...values) as Row | null },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).all(...values) as Row[] },
  }
  const database: SqliteDatabase = { ...executor, async transaction(work) {
    native.exec('BEGIN IMMEDIATE')
    try { const result = await work(executor); native.exec('COMMIT'); return result }
    catch (error) { native.exec('ROLLBACK'); throw error }
  } }
  return { native, provider: { get: async () => database } }
}

describe('actual attribution persistence (real SQLite)', () => {
  it('preserves the original request, actual producer, and unknown legacy state across migration/reopen', async () => {
    const { native, provider } = fixture()
    const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'c', providerId: 'preferred', model: 'alias', messages: [], generationParameterSources: {} }
    const runId = asAssistantRunId('run')
    try {
      const persistence = createSqliteAssistantRunPersistence(provider)
      let now = 1
      const runtime = createAssistantRuntime({
        persistence, clock: { now: () => now++ }, ids: { next: (prefix) => `${prefix}-${now++}` },
        providerGateway: { describe: () => undefined, async *stream(_request, options) {
          await options.onExecutionTarget?.({ providerId: 'actual', model: 'upstream', protocolAdapterId: 'anthropic', endpointVariant: 'direct', credentialSource: { kind: 'primary' }, attemptId: 'attempt' })
          yield { type: 'citation', citationId: 'official', title: 'Official source', url: 'https://example.com/source' }
          yield { type: 'citation', citationId: 'oversized', url: `https://example.com/${'x'.repeat(2048)}` }
          yield { type: 'text-delta', text: 'durable answer' }
        } },
      })
      const outcome = await runtime.execute({ runId, request, responseMessageId: 'message', context: {
        schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('context'), createdAt: 1, conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [],
      } })
      expect(outcome.ok).toBe(true)
      const reopened = createSqliteAssistantRunPersistence(provider)
      expect(await reopened.listCitations!(runId)).toEqual([
        { type: 'citation', citationId: 'official', title: 'Official source', url: 'https://example.com/source' },
        { type: 'citation', citationId: 'oversized' },
      ])
      expect(getAssistantRunMessageAttribution((await reopened.get(runId))!)?.providerId).toBe('actual')
      expect((await reopened.getRequestSnapshot(runId))?.request).toEqual(request)
      expect((await reopened.getLatestForResponseMessage('c', 'message'))?.routeDetails?.protocolAdapterId).toBe('anthropic')
      const row = native.query('SELECT checkpointJson, resultJson FROM assistant_runs').get()
      expect(JSON.stringify(row)).not.toContain('credentialSource')
      native.exec("DELETE FROM platform_schema_migrations WHERE scope='assistant-runtime' AND version=11; ALTER TABLE assistant_runs DROP COLUMN routeDetailsJson;")
      const migrated = createSqliteAssistantRunPersistence(provider)
      expect((await migrated.get(runId))?.result?.outputText).toBe('durable answer')
      expect(getAssistantRunMessageAttribution((await migrated.get(runId))!)).toBeUndefined()
      await expect(migrated.getRequestSnapshot(runId)).rejects.toThrow('invalid')
      native.query('UPDATE assistant_runs SET routeDetailsJson=?').run(JSON.stringify({ schema: 'islemind.assistant-run-route-details.v99' }))
      await expect(migrated.get(runId)).rejects.toThrow('unsupported or invalid')
      expect(native.query('SELECT routeDetailsJson FROM assistant_runs').get().routeDetailsJson).toContain('.v99')
    } finally { native.close() }
  })
})
