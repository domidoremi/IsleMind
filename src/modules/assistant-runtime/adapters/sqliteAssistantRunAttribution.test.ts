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
  it('pages the latest state of each operation without loading streams or moving old activities on completion', async () => {
    const { native, provider } = fixture()
    const runId = asAssistantRunId('activity-run')
    try {
      const persistence = createSqliteAssistantRunPersistence(provider)
      await persistence.save({ id: runId, kind: 'chat', conversationId: 'c', providerId: 'p', model: 'm',
        contextSnapshotId: asContextSnapshotId('context'), status: 'running', createdAt: 1, journalSequence: 0 })
      let sequence = 0
      const append = async (type: import('../contracts').RunJournalEventType, data: import('@/core').JsonRecord) => {
        await persistence.append({ schema: 'islemind.assistant-run-journal-entry.v1', runId,
          sequence: ++sequence, occurredAt: sequence * 10, type, data })
      }
      for (let stepIndex = 0; stepIndex < 22; stepIndex++) {
        await append('run.checkpointed', { phase: 'operation', stepIndex,
          operation: { callId: 'reused-call', operationId: `tool-${stepIndex}`, inputSummary: '{"password":"private-input","path":"draft"}' } })
        await append('model-operation.selected', { receipt: { schema: 'islemind.model-operation-receipt.v1', stepIndex,
          callId: 'reused-call', operationId: `tool-${stepIndex}`, status: 'failed', code: 'execution_failed', output: 'initial failure' } })
      }
      for (let index = 0; index < 120; index++) await append('stream.event', { eventType: 'text-delta', text: 'unrelated output' })
      await append('model-operation.selected', { receipt: { schema: 'islemind.model-operation-receipt.v1', stepIndex: 0,
        callId: 'reused-call', operationId: 'tool-0', status: 'succeeded', code: 'ok', output: '{"result":"saved","token":"private-output"}' } })
      const first = await persistence.listOperationActivities!(runId)
      expect(first.entries).toHaveLength(20)
      expect(first.entries[0].trace.title).toBe('tool-2')
      expect(first.entries[19].trace.title).toBe('tool-21')
      expect(first.before).toBe(5)
      const reopened = createSqliteAssistantRunPersistence(provider)
      const older = await reopened.listOperationActivities!(runId, first.before)
      expect(older.entries).toHaveLength(2)
      expect(older.before).toBeUndefined()
      expect(older.entries[0]).toMatchObject({ firstSequence: 1, sequence, trace: { title: 'tool-0', status: 'done', startedAt: 10 } })
      expect(older.entries[1].trace.status).toBe('error')
      expect(JSON.stringify([first, older])).not.toMatch(/private-input|private-output|unrelated output/)
      expect(older.entries[0].trace.content).toContain('saved')
      expect(older.entries[0].trace.metadata?.inputSummary).toContain('draft')
      expect(await reopened.listOperationActivities!(asAssistantRunId('other-run'))).toEqual({ entries: [] })
      await expect(reopened.listOperationActivities!(runId, -1)).rejects.toThrow('Invalid operation activity query')
    } finally { native.close() }
  })

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
