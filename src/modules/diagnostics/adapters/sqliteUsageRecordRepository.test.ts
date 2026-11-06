import { describe, expect, it } from '@jest/globals'
import type {
  SqliteDatabase,
  SqliteDatabaseProvider,
  SqliteExecutor,
  SqliteValue,
} from '@/platform/storage'
import type { UsagePortableSnapshot, UsageRecord } from '../contracts'
import { createUsageStatisticsService } from '../application/usageStatistics'
import { createSqliteUsagePortableSnapshotRepository, createSqliteUsageRecordRepository } from './sqliteUsageRecordRepository'

interface BunQuery {
  run(...parameters: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...parameters: unknown[]): Record<string, unknown> | null
  all(...parameters: unknown[]): Record<string, unknown>[]
}

interface BunDatabase {
  exec(source: string): void
  query(source: string): BunQuery
  close(): void
}

function createBunSqliteFixture(): {
  provider: SqliteDatabaseProvider
  database: SqliteDatabase
  close(): void
} {
  const { Database } = require('bun:sqlite') as {
    Database: new (filename: string) => BunDatabase
  }
  const native = new Database(':memory:')
  const executor: SqliteExecutor = {
    async exec(source) {
      native.exec(source)
    },
    async run(source, parameters = []) {
      const result = native.query(source).run(...parameters as readonly SqliteValue[])
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      }
    },
    async getFirst<Row extends object>(source: string, parameters = []) {
      return native.query(source).get(...parameters as readonly SqliteValue[]) as Row | null
    },
    async getAll<Row extends object>(source: string, parameters = []) {
      return native.query(source).all(...parameters as readonly SqliteValue[]) as Row[]
    },
  }
  const database: SqliteDatabase = {
    ...executor,
    async transaction<Value>(work: (transaction: SqliteExecutor) => Promise<Value>) {
      native.exec('BEGIN IMMEDIATE')
      try {
        const value = await work(executor)
        native.exec('COMMIT')
        return value
      } catch (error) {
        native.exec('ROLLBACK')
        throw error
      }
    },
  }
  return {
    provider: { get: async () => database },
    database,
    close: () => native.close(),
  }
}

const snapshot: UsagePortableSnapshot = {
  schema: 'islemind.usage-portable-snapshot.v1',
  records: [{
    schema: 'islemind.usage-record.v1',
    id: 'estimated-record',
    occurredAt: 100,
    completedAt: 110,
    providerId: 'provider-1',
    providerName: 'Provider 1',
    requestedModel: 'model-1',
    upstreamModel: 'model-1',
    operationSource: 'chat',
    dataSource: 'estimated',
    measurementSource: 'estimated',
    status: 'success',
    durationMs: 10,
    attempt: 0,
    attemptReason: 'initial',
    tokens: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    costProvenance: 'unavailable',
  }],
  dailyRollups: [{
    dayStart: 0,
    providerId: 'provider-1',
    providerName: 'Provider 1',
    upstreamModel: 'model-1',
    operationSource: 'chat',
    dataSource: 'live-provider',
    measurementSource: 'provider',
    status: 'success',
    requestCount: 2,
    retryCount: 1,
    failoverCount: 1,
    successCount: 2,
    failedCount: 0,
    cancelledCount: 0,
    limitedCount: 0,
    partialCount: 0,
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 3,
    cachedInputTokens: 3,
    reasoningTokens: 1,
    totalCostNanodollars: 20,
    costSampleCount: 2,
    durationMsTotal: 30,
    durationSampleCount: 2,
    firstTokenMsTotal: 8,
    firstTokenSampleCount: 2,
  }],
  pricingEntries: [{
    id: 'manual-price-1',
    providerId: 'provider-1',
    modelPattern: 'model-1',
    displayName: 'Manual price',
    version: '2026-08-30',
    effectiveFrom: 1,
    source: 'manual',
    sourceUrl: 'https://example.invalid/pricing',
    verifiedAt: '2026-10-31',
    billingConditions: 'Synthetic provider-specific test price.',
    rates: {
      inputNanodollarsPerMillionTokens: 1,
      outputNanodollarsPerMillionTokens: 2,
      reasoningBilling: 'included-in-output',
    },
  }],
}

const describeWithBunSqlite = process.versions.bun ? describe : describe.skip

function callAttempt(id: string, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return { ...snapshot.records[0], id, dataSource: 'live-provider', measurementSource: 'unavailable',
    tokens: {}, status: 'failed', conversationId: 'conversation',
    attemptIdentity: `wire-${id}`,
    execution: { schema: 'islemind.request-execution.v1', logicalRequestId: 'call-a', responseExecutionId: 'reply-a', requestStartedAt: 50 },
    ...overrides,
  }
}

describeWithBunSqlite('SQLite execution identities and filtering', () => {
  it('retains the selected routing plan in exact execution receipts after repository restart', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const routingPlan = { id: 'stable', name: 'Stable research', primaryProviderId: 'provider-1', primaryModel: 'model-1' }
      const record = callAttempt('planned', { execution: { schema: 'islemind.request-execution.v1', logicalRequestId: 'planned-request',
        responseExecutionId: 'planned-answer', requestStartedAt: 50, routingPlan } })
      await createSqliteUsageRecordRepository(fixture.provider).append(record)
      const restored = createSqliteUsageRecordRepository(fixture.provider)
      expect((await restored.findExecution({ kind: 'response', id: 'planned-answer' })).records[0].execution?.routingPlan).toEqual(routingPlan)
      const portable = createSqliteUsagePortableSnapshotRepository(fixture.provider)
      expect((await portable.load()).records[0].execution?.routingPlan).toEqual(routingPlan)
    } finally { fixture.close() }
  })
  it('upgrades old columns, backfills valid identities and keeps unlinked history unlinked', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const old = createSqliteUsageRecordRepository(fixture.provider)
      const linked = callAttempt('linked', { reportedExecution: { model: 'reported', source: 'response.model' } })
      await old.append(linked)
      await old.append(callAttempt('legacy', { execution: undefined }))
      await fixture.database.exec(`
        DROP INDEX usage_records_request_idx; DROP INDEX usage_records_response_idx; DROP INDEX usage_records_conversation_idx;
        DROP INDEX usage_records_request_time_idx; DROP INDEX usage_records_request_result_idx;
        ALTER TABLE usage_records DROP COLUMN logicalRequestId; ALTER TABLE usage_records DROP COLUMN responseExecutionId;
        ALTER TABLE usage_records DROP COLUMN conversationId; ALTER TABLE usage_records DROP COLUMN requestStartedAt;
        DELETE FROM platform_schema_migrations WHERE scope = 'diagnostics' AND version >= 4;
      `)
      const upgraded = createSqliteUsageRecordRepository(fixture.provider)
      await expect(upgraded.findExecution({ kind: 'request', id: 'call-a' })).resolves.toMatchObject({ records: [linked], truncated: false })
      const columns = await fixture.database.getAll<{ id: string; logicalRequestId: string | null; requestStartedAt: number | null }>(
        'SELECT id, logicalRequestId, requestStartedAt FROM usage_records ORDER BY id',
      )
      expect(columns).toEqual([
        { id: 'legacy', logicalRequestId: null, requestStartedAt: null },
        { id: 'linked', logicalRequestId: 'call-a', requestStartedAt: 50 },
      ])
      const plan = await fixture.database.getAll<{ detail: string }>(
        'EXPLAIN QUERY PLAN SELECT id FROM usage_records WHERE COALESCE(requestStartedAt, occurredAt) >= ? AND COALESCE(requestStartedAt, occurredAt) < ?', [0, 100],
      )
      expect(plan.some(value => value.detail.includes('usage_records_request_time_idx'))).toBe(true)
    } finally { fixture.close() }
  })

  it('filters by the complete call outcome and initiation time while connection totals include only matching attempts', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      const first = callAttempt('first', { status: 'limited' })
      const last = callAttempt('last', { providerId: 'provider-2', providerName: 'Provider 2', occurredAt: 150, completedAt: 160,
        status: 'success', attemptReason: 'fallback', originalProviderId: first.providerId, originalModel: first.requestedModel,
        totalCostNanodollars: 25, costProvenance: 'supplier-known' })
      await repository.append(first)
      await repository.append(last)
      await repository.append(callAttempt('legacy', { execution: undefined, occurredAt: 100, completedAt: 110 }))
      await expect(repository.listAll({ startAt: 0, endAt: 100, statuses: ['success'] })).resolves.toEqual([last, first])
      await expect(repository.listAll({ startAt: 100, endAt: 200, statuses: ['success'] })).resolves.toEqual([])
      await expect(repository.listAll({ providerIds: [first.providerId], statuses: ['limited'] })).resolves.toEqual([])
      const service = createUsageStatisticsService(repository)
      const filtered = await service.snapshot({ filter: { providerIds: [first.providerId], statuses: ['success'] }, limit: 1 })
      expect(filtered.summary).toMatchObject({ logicalRequestCount: 1, requestCount: 1, unknownCostCount: 1 })
      expect(filtered.summary.totalCostNanodollars).toBeUndefined()
      expect(filtered.requests.requests[0]).toMatchObject({ status: 'success', providerId: 'provider-2', attemptCount: 2 })
      expect(filtered.requestOutcomes).toMatchObject({ requestCount: 1, successCount: 1, failedCount: 0 })
      expect((await service.detail({ kind: 'response', id: 'reply-a' }))?.summary).toMatchObject({ requestCount: 2, totalCostNanodollars: 25, unknownCostCount: 1 })
      await expect(repository.latestByProvider(['provider-1', 'provider-2'])).resolves.toEqual(expect.arrayContaining([last]))
    } finally { fixture.close() }
  })

  it('reads every retained attempt of an exact run and connection despite newer unrelated requests', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      const first = callAttempt('run-first', { runId: 'run-a', conversationId: 'chat-a', execution: undefined })
      const second = callAttempt('run-second', { ...first, id: 'run-second', occurredAt: 120, completedAt: 130 })
      await repository.append(first)
      await repository.append(second)
      await repository.append(callAttempt('unrelated', { runId: 'run-b', occurredAt: 200, completedAt: 210 }))
      await repository.append(callAttempt('another-connection', { runId: 'run-a', providerId: 'provider-2' }))
      await repository.append(callAttempt('unlinked', { runId: undefined }))
      const reopened = createUsageStatisticsService(createSqliteUsageRecordRepository(fixture.provider))
      await expect(reopened.runAttempts('run-a', first.providerId)).resolves.toEqual({ records: [first, second], truncated: false })
      await expect(reopened.runAttempts('missing-run', first.providerId)).resolves.toEqual({ records: [], truncated: false })
    } finally { fixture.close() }
  })

  it('reports incomplete run ledgers and rejects an undecodable matching attempt', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      for (let index = 0; index < 501; index += 1) {
        await repository.append(callAttempt(`run-attempt-${index}`, { runId: 'large-run', occurredAt: 200 + index, completedAt: 201 + index }))
      }
      const result = await repository.findRunAttempts('large-run', 'provider-1')
      expect(result.records).toHaveLength(500)
      expect(result.truncated).toBe(true)
      await fixture.database.run('UPDATE usage_records SET recordJson = ? WHERE id = ?', [
        JSON.stringify({ runId: 'large-run', schema: 'invalid-fixture' }), 'run-attempt-0',
      ])
      await expect(repository.findRunAttempts('large-run', 'provider-1')).rejects.toThrow('cannot be decoded')
    } finally { fixture.close() }
  })

  it('queries details independently, bounds large responses and clears their references without restoring history', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      for (let index = 0; index < 501; index += 1) await repository.append(callAttempt(`attempt-${index}`, { occurredAt: 200 + index, completedAt: 201 + index, attempt: index }))
      const detail = await repository.findExecution({ kind: 'response', id: 'reply-a' })
      expect(detail.records).toHaveLength(500)
      expect(detail.truncated).toBe(true)
      expect((await repository.list({ limit: 1, offset: 500 })).records).toHaveLength(1)
      await repository.clear()
      await expect(repository.findExecution({ kind: 'request', id: 'call-a' })).resolves.toEqual({ records: [], truncated: false })
      await expect(repository.listRollups()).resolves.toEqual([])
      await expect(repository.latestByProvider(['provider-1'])).resolves.toEqual([])
    } finally { fixture.close() }
  })

  it('round-trips response evidence and bounded message/call identities and rejects unsafe extensions', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const record = callAttempt('roundtrip', { reportedExecution: { model: 'actual-version', source: 'response.modelVersion' } })
      const portable = createSqliteUsagePortableSnapshotRepository(fixture.provider)
      await portable.replace({ ...snapshot, records: [record] })
      expect((await portable.load()).records).toEqual([record])
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      await expect(repository.append({ ...record, id: 'unsafe', execution: { ...record.execution!, logicalRequestId: 'bad\n' } })).rejects.toThrow()
      await expect(repository.append({ ...record, id: 'overflow', tokens: { totalTokens: Number.MAX_SAFE_INTEGER + 1 } })).rejects.toThrow()
      await expect(repository.append({ ...record, id: 'future', execution: { ...record.execution!, requestStartedAt: record.occurredAt + 1 } })).rejects.toThrow()
    } finally { fixture.close() }
  })

  it('preserves missing token fields, real zeroes and cost provenance during retention', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      await repository.append(callAttempt('missing', { execution: undefined, measurementSource: 'provider', tokens: { inputTokens: 5 } }))
      await repository.append(callAttempt('zero', { execution: undefined, occurredAt: 120, completedAt: 130, measurementSource: 'provider',
        tokens: { inputTokens: 0, outputTokens: 0 }, totalCostNanodollars: 0, costProvenance: 'supplier-known' }))
      await repository.append(callAttempt('priced', { execution: undefined, occurredAt: 140, completedAt: 150, measurementSource: 'provider',
        tokens: { inputTokens: 2, outputTokens: 1 }, totalCostNanodollars: 10, costProvenance: 'price-table-estimate' }))
      const service = createUsageStatisticsService(repository)
      const before = (await service.snapshot()).summary
      await repository.compactBefore(200)
      const after = (await service.snapshot()).summary
      for (const key of ['requestCount', 'inputTokens', 'outputTokens', 'totalTokens', 'costSampleCount', 'unknownCostCount',
        'tokenSampleCount', 'totalCostNanodollars', 'supplierCostNanodollars', 'estimatedCostNanodollars'] as const) expect(after[key]).toBe(before[key])
      expect(after).toMatchObject({ totalTokens: 3, tokenSampleCount: 2, unknownCostCount: 1, supplierCostNanodollars: 0, estimatedCostNanodollars: 10 })
      expect((await repository.listRollups())[0].measurements).toMatchObject({
        tokens: { inputTokens: 7, outputTokens: 1, totalTokens: 3 }, tokenSampleCounts: { totalTokens: 2 },
      })
      expect((await repository.listRollups())[0].measurements?.tokens.reasoningTokens).toBeUndefined()
    } finally { fixture.close() }
  })

  it('merges new measurements into a legacy day without inventing old token coverage or price sources', async () => {
    const fixture = createBunSqliteFixture()
    try {
      await createSqliteUsagePortableSnapshotRepository(fixture.provider).replace({ ...snapshot, records: [] })
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      await repository.append(callAttempt('fresh', { execution: undefined, status: 'success', measurementSource: 'provider',
        tokens: { inputTokens: 5, outputTokens: 1 }, totalCostNanodollars: 5, costProvenance: 'supplier-known' }))
      await repository.compactBefore(200)
      const summary = (await createUsageStatisticsService(repository).snapshot()).summary
      expect(summary).toMatchObject({ requestCount: 3, totalTokens: 6, tokenSampleCount: 1, totalCostNanodollars: 25,
        supplierCostNanodollars: 5, unclassifiedCostNanodollars: 20 })
      expect(summary.estimatedCostNanodollars).toBeUndefined()
      const csv = await createUsageStatisticsService(repository).export(undefined, 'csv')
      const headers = csv.split('\n')[0].split(',')
      const cells = csv.split('\n')[1].split(',')
      expect(cells).toHaveLength(headers.length)
      expect(cells[headers.indexOf('total_tokens')]).toBe('6')
      expect(cells[headers.indexOf('token_samples')]).toBe('1')
    } finally { fixture.close() }
  })

  it('keeps every attempt of a call until the newest attempt crosses the retention cutoff', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      await repository.append(callAttempt('first'))
      await repository.append(callAttempt('last', { occurredAt: 150, completedAt: 160, status: 'success', attempt: 1, attemptReason: 'retry' }))
      await repository.compactBefore(125)
      expect((await repository.findExecution({ kind: 'request', id: 'call-a' })).records).toHaveLength(2)
      await repository.compactBefore(200)
      expect((await repository.findExecution({ kind: 'request', id: 'call-a' })).records).toHaveLength(0)
      expect((await repository.listRollups()).reduce((count, row) => count + row.requestCount, 0)).toBe(2)
    } finally { fixture.close() }
  })

  it('rolls back retention on cumulative cost overflow and retains the original attempts', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const archived = { ...snapshot.dailyRollups[0], totalCostNanodollars: Number.MAX_SAFE_INTEGER }
      await createSqliteUsagePortableSnapshotRepository(fixture.provider).replace({ ...snapshot, records: [], dailyRollups: [archived] })
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      const record = callAttempt('new', { execution: undefined, status: 'success', measurementSource: 'provider',
        totalCostNanodollars: 1, costProvenance: 'supplier-known' })
      await repository.append(record)
      await expect(repository.compactBefore(200)).rejects.toThrow('supported integer range')
      expect((await repository.listAll()).map(value => value.id)).toEqual(['new'])
      expect((await repository.listRollups())[0].totalCostNanodollars).toBe(Number.MAX_SAFE_INTEGER)
    } finally { fixture.close() }
  })
})

describeWithBunSqlite('SQLite usage portable snapshots', () => {
  it('saves a matching pricing revision atomically and rejects stale, imported or deleted baselines', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsageRecordRepository(fixture.provider)
      const original = snapshot.pricingEntries[0]
      await repository.savePricingEntry(original)
      const baseline = JSON.stringify((await repository.listPricingEntries())[0])
      const edited = { ...original, rates: { ...original.rates, inputNanodollarsPerMillionTokens: 7 } }
      await repository.savePricingEntry(edited, baseline)
      await expect(repository.listPricingEntries()).resolves.toEqual([edited])
      await expect(repository.savePricingEntry(original, baseline)).rejects.toThrow('usage_pricing_conflict')
      // Restored data can keep the same version string with different prices.
      const imported = { ...original, rates: { ...original.rates, inputNanodollarsPerMillionTokens: 9 } }
      await createSqliteUsagePortableSnapshotRepository(fixture.provider).replace({ ...snapshot, pricingEntries: [imported] })
      await expect(repository.savePricingEntry(edited, baseline)).rejects.toThrow('usage_pricing_conflict')
      await expect(repository.listPricingEntries()).resolves.toEqual([imported])
      const latest = JSON.stringify((await repository.listPricingEntries())[0])
      await fixture.database.exec("CREATE TRIGGER fail_pricing_write BEFORE UPDATE ON usage_pricing_entries BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
      await expect(repository.savePricingEntry(edited, latest)).rejects.toThrow('disk failure')
      await expect(repository.listPricingEntries()).resolves.toEqual([imported])
      await fixture.database.exec('DROP TRIGGER fail_pricing_write')
      await repository.deletePricingEntry(original.id)
      await expect(repository.savePricingEntry(edited, latest)).rejects.toThrow('usage_pricing_conflict')
      await expect(repository.listPricingEntries()).resolves.toEqual([])
    } finally { fixture.close() }
  })

  it('round-trips estimated records and atomically replaces all persisted usage state', async () => {
    const fixture = createBunSqliteFixture()
    try {
      const repository = createSqliteUsagePortableSnapshotRepository(fixture.provider)
      await repository.replace(snapshot)
      await expect(repository.load()).resolves.toEqual(snapshot)

      await fixture.database.run(
        'INSERT INTO usage_import_markers (id, completedAt) VALUES (?, ?)',
        ['legacy-import', 100],
      )
      const replacement: UsagePortableSnapshot = {
        schema: 'islemind.usage-portable-snapshot.v1',
        records: [],
        dailyRollups: [],
        pricingEntries: [{
          ...snapshot.pricingEntries[0],
          id: 'manual-price-2',
          modelPattern: 'model-2',
        }],
      }
      await repository.replace(replacement)

      await expect(repository.load()).resolves.toEqual(replacement)
      await expect(fixture.database.getFirst<{ count: number }>(
        'SELECT COUNT(*) AS count FROM usage_import_markers',
      )).resolves.toEqual({ count: 0 })
    } finally {
      fixture.close()
    }
  })
})
