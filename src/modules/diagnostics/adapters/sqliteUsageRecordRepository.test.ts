import { describe, expect, it } from '@jest/globals'
import type {
  SqliteDatabase,
  SqliteDatabaseProvider,
  SqliteExecutor,
  SqliteValue,
} from '@/platform/storage'
import type { UsagePortableSnapshot } from '../contracts'
import { createSqliteUsagePortableSnapshotRepository } from './sqliteUsageRecordRepository'

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
    rates: {
      inputNanodollarsPerMillionTokens: 1,
      outputNanodollarsPerMillionTokens: 2,
      reasoningBilling: 'included-in-output',
    },
  }],
}

const describeWithBunSqlite = process.versions.bun ? describe : describe.skip

describeWithBunSqlite('SQLite usage portable snapshots', () => {
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
