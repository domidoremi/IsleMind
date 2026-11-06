import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
  type SqliteValue,
} from '@/platform/storage'
import * as v from 'valibot'
import { isUsageExecutionReference, USAGE_EXECUTION_SCHEMA } from '@/core'
import {
  USAGE_PORTABLE_SNAPSHOT_SCHEMA,
  USAGE_RECORD_SCHEMA,
  USAGE_PRICING_CONFLICT,
  type UsageDataSource,
  type UsageDailyRollup,
  type UsageMeasurementSource,
  type UsageOperationSource,
  type UsagePricingEntry,
  type UsagePortableSnapshot,
  type UsagePortableSnapshotRepository,
  type UsageRecord,
  type UsageRecordFilter,
  type UsageRecordRepository,
  type UsageRecordStatus,
  type UsageDetailReference,
  type UsageRollupMeasurements,
} from '../contracts'
import { deduplicateUsageAttempts, knownUsageTotal, usageRouteSwitchAttempts } from '../application/usageSummary'

const MIGRATION_SCOPE = 'diagnostics'
const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 500
const MAX_FILTER_VALUES = 100
const MAX_SEARCH_LENGTH = 256
const MAX_DETAIL_RECORDS = 500
const DAY_MS = 24 * 60 * 60 * 1000

interface UsageRecordRow {
  id: string
  occurredAt: number
  completedAt: number
  providerId: string
  providerName: string
  requestedModel: string
  upstreamModel: string
  pricingModel: string | null
  operationSource: string
  dataSource: string
  measurementSource: string
  status: string
  recordJson: string
  logicalRequestId?: string | null
  responseExecutionId?: string | null
  conversationId?: string | null
  requestStartedAt?: number | null
}

interface UsagePricingEntryRow {
  id: string
  providerId: string | null
  modelPattern: string
  effectiveFrom: number
  source: string
  entryJson: string
}

const operationSourceSchema = v.picklist([
  'chat',
  'agent',
  'tavern',
  'tool-continuation',
  'memory',
  'context',
  'knowledge',
  'embedding',
  'transcription',
  'speech',
  'media',
  'other',
])
const dataSourceSchema = v.picklist(['live-provider', 'estimated', 'legacy-message'])
const measurementSourceSchema = v.picklist(['provider', 'estimated', 'unavailable'])
const statusSchema = v.picklist(['success', 'failed', 'cancelled', 'limited', 'partial'])
const boundedIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const boundedNameSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(512))
const nonNegativeIntegerSchema = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const nonNegativeNumberSchema = v.pipe(v.number(), v.finite(), v.minValue(0))
const pricingRatesSchema = v.strictObject({
  inputNanodollarsPerMillionTokens: nonNegativeIntegerSchema,
  outputNanodollarsPerMillionTokens: nonNegativeIntegerSchema,
  cacheReadNanodollarsPerMillionTokens: v.optional(nonNegativeIntegerSchema),
  cacheCreationNanodollarsPerMillionTokens: v.optional(nonNegativeIntegerSchema),
  reasoningNanodollarsPerMillionTokens: v.optional(nonNegativeIntegerSchema),
  reasoningBilling: v.picklist(['included-in-output', 'separate', 'additional-to-output']),
})
const pricingSnapshotSchema = v.strictObject({
  entryId: boundedIdSchema,
  version: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  source: v.picklist(['built-in', 'manual']),
  rates: pricingRatesSchema,
})
const tokenCountsSchema = v.strictObject({
  inputTokens: v.optional(nonNegativeIntegerSchema),
  outputTokens: v.optional(nonNegativeIntegerSchema),
  totalTokens: v.optional(nonNegativeIntegerSchema),
  cacheCreationInputTokens: v.optional(nonNegativeIntegerSchema),
  cacheReadInputTokens: v.optional(nonNegativeIntegerSchema),
  cachedInputTokens: v.optional(nonNegativeIntegerSchema),
  reasoningTokens: v.optional(nonNegativeIntegerSchema),
})
const executionSchema = v.strictObject({
  schema: v.literal(USAGE_EXECUTION_SCHEMA),
  logicalRequestId: boundedIdSchema,
  requestStartedAt: nonNegativeIntegerSchema,
  responseExecutionId: v.optional(boundedIdSchema),
  parentRequestId: v.optional(boundedIdSchema),
  messageId: v.optional(boundedIdSchema),
  routingPlan: v.optional(v.strictObject({
    id: boundedIdSchema,
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
    primaryProviderId: boundedIdSchema,
    primaryModel: v.pipe(v.string(), v.minLength(1), v.maxLength(240)),
  })),
})
const reportedExecutionSchema = v.strictObject({
  model: v.pipe(v.string(), v.minLength(1), v.maxLength(240), v.regex(/^[^\u0000-\u001f\u007f]+$/u)),
  source: v.picklist(['response.model', 'response.modelVersion', 'response.message.model']),
})
const usageRecordSchema = v.strictObject({
  schema: v.literal(USAGE_RECORD_SCHEMA),
  id: boundedIdSchema,
  occurredAt: nonNegativeIntegerSchema,
  completedAt: nonNegativeIntegerSchema,
  providerId: boundedIdSchema,
  providerType: v.optional(boundedIdSchema),
  providerName: boundedNameSchema,
  credentialGroupId: v.optional(boundedIdSchema),
  requestedModel: boundedIdSchema,
  upstreamModel: boundedIdSchema,
  originalProviderId: v.optional(boundedIdSchema),
  originalModel: v.optional(boundedIdSchema),
  actualProviderId: v.optional(boundedIdSchema),
  actualModel: v.optional(boundedIdSchema),
  retryCount: v.optional(nonNegativeIntegerSchema),
  failoverCount: v.optional(nonNegativeIntegerSchema),
  attemptIdentity: v.optional(boundedIdSchema),
  execution: v.optional(executionSchema),
  reportedExecution: v.optional(reportedExecutionSchema),
  pricingModel: v.optional(boundedIdSchema),
  operationSource: operationSourceSchema,
  dataSource: dataSourceSchema,
  measurementSource: measurementSourceSchema,
  status: statusSchema,
  statusCode: v.optional(nonNegativeIntegerSchema),
  errorCode: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128))),
  isStreaming: v.optional(v.boolean()),
  durationMs: nonNegativeNumberSchema,
  firstTokenMs: v.optional(nonNegativeNumberSchema),
  attempt: nonNegativeIntegerSchema,
  attemptReason: v.picklist(['initial', 'retry', 'rectification', 'fallback']),
  correlationId: v.optional(boundedIdSchema),
  conversationId: v.optional(boundedIdSchema),
  runId: v.optional(boundedIdSchema),
  tokens: tokenCountsSchema,
  totalCostNanodollars: v.optional(nonNegativeIntegerSchema),
  costProvenance: v.picklist(['supplier-known', 'price-table-estimate', 'unavailable']),
  pricing: v.optional(pricingSnapshotSchema),
})
const pricingEntrySchema = v.strictObject({
  id: boundedIdSchema,
  providerType: v.optional(boundedIdSchema),
  providerId: v.optional(boundedIdSchema),
  modelPattern: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  displayName: boundedNameSchema,
  version: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  effectiveFrom: nonNegativeIntegerSchema,
  source: v.picklist(['built-in', 'manual']),
  sourceUrl: v.optional(v.pipe(v.string(), v.maxLength(2048))),
  verifiedAt: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
  billingConditions: v.optional(v.pipe(v.string(), v.maxLength(2048))),
  rates: pricingRatesSchema,
})
const usageDailyRollupSchema = v.strictObject({
  dayStart: nonNegativeIntegerSchema,
  providerId: boundedIdSchema,
  providerName: boundedNameSchema,
  upstreamModel: boundedIdSchema,
  operationSource: operationSourceSchema,
  dataSource: dataSourceSchema,
  measurementSource: measurementSourceSchema,
  status: statusSchema,
  requestCount: nonNegativeIntegerSchema,
  retryCount: v.optional(nonNegativeIntegerSchema),
  failoverCount: v.optional(nonNegativeIntegerSchema),
  successCount: nonNegativeIntegerSchema,
  failedCount: nonNegativeIntegerSchema,
  cancelledCount: nonNegativeIntegerSchema,
  limitedCount: nonNegativeIntegerSchema,
  partialCount: nonNegativeIntegerSchema,
  inputTokens: nonNegativeIntegerSchema,
  outputTokens: nonNegativeIntegerSchema,
  totalTokens: nonNegativeIntegerSchema,
  cacheCreationInputTokens: nonNegativeIntegerSchema,
  cacheReadInputTokens: nonNegativeIntegerSchema,
  cachedInputTokens: nonNegativeIntegerSchema,
  reasoningTokens: nonNegativeIntegerSchema,
  totalCostNanodollars: nonNegativeIntegerSchema,
  costSampleCount: nonNegativeIntegerSchema,
  durationMsTotal: nonNegativeNumberSchema,
  durationSampleCount: nonNegativeIntegerSchema,
  firstTokenMsTotal: nonNegativeNumberSchema,
  firstTokenSampleCount: nonNegativeIntegerSchema,
  measurements: v.optional(v.strictObject({
    schema: v.literal('islemind.usage-rollup-measurements.v1'),
    tokens: tokenCountsSchema,
    tokenSampleCounts: tokenCountsSchema,
    supplierCostNanodollars: v.optional(nonNegativeIntegerSchema),
    estimatedCostNanodollars: v.optional(nonNegativeIntegerSchema),
    unclassifiedCostNanodollars: v.optional(nonNegativeIntegerSchema),
    supplierCostSampleCount: nonNegativeIntegerSchema,
    estimatedCostSampleCount: nonNegativeIntegerSchema,
    unclassifiedCostSampleCount: nonNegativeIntegerSchema,
  })),
})
const usagePortableSnapshotSchema = v.strictObject({
  schema: v.literal(USAGE_PORTABLE_SNAPSHOT_SCHEMA),
  records: v.array(usageRecordSchema),
  dailyRollups: v.array(usageDailyRollupSchema),
  pricingEntries: v.array(pricingEntrySchema),
})

export class UsageRecordRepositoryDataError extends Error {
  constructor(message = 'Usage repository data is invalid.') {
    super(message)
    this.name = 'UsageRecordRepositoryDataError'
  }
}

export function createSqliteUsageRecordRepository(
  databaseProvider: SqliteDatabaseProvider,
): UsageRecordRepository {
  let initialized: Promise<void> | undefined

  async function database() {
    const value = await databaseProvider.get()
    initialized ??= applySqliteMigrations(value, [
      {
        scope: MIGRATION_SCOPE,
        version: 1,
        name: 'usage-records-rollups-and-pricing',
        async up(transaction) {
          await transaction.exec(`
            CREATE TABLE IF NOT EXISTS usage_records (
              id TEXT PRIMARY KEY NOT NULL,
              occurredAt INTEGER NOT NULL,
              completedAt INTEGER NOT NULL,
              providerId TEXT NOT NULL,
              providerName TEXT NOT NULL,
              requestedModel TEXT NOT NULL,
              upstreamModel TEXT NOT NULL,
              pricingModel TEXT,
              operationSource TEXT NOT NULL,
              dataSource TEXT NOT NULL,
              measurementSource TEXT NOT NULL,
              status TEXT NOT NULL,
              recordJson TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS usage_records_time_idx
              ON usage_records (occurredAt DESC, id DESC);
            CREATE INDEX IF NOT EXISTS usage_records_provider_idx
              ON usage_records (providerId, occurredAt DESC);
            CREATE INDEX IF NOT EXISTS usage_records_requested_model_idx
              ON usage_records (requestedModel, occurredAt DESC);
            CREATE INDEX IF NOT EXISTS usage_records_upstream_model_idx
              ON usage_records (upstreamModel, occurredAt DESC);
            CREATE INDEX IF NOT EXISTS usage_records_status_idx
              ON usage_records (status, occurredAt DESC);
            CREATE INDEX IF NOT EXISTS usage_records_operation_source_idx
              ON usage_records (operationSource, occurredAt DESC);
            CREATE INDEX IF NOT EXISTS usage_records_data_source_idx
              ON usage_records (dataSource, occurredAt DESC);
            CREATE INDEX IF NOT EXISTS usage_records_measurement_source_idx
              ON usage_records (measurementSource, occurredAt DESC);

            CREATE TABLE IF NOT EXISTS usage_daily_rollups (
              dayStart INTEGER NOT NULL,
              providerId TEXT NOT NULL,
              providerName TEXT NOT NULL,
              upstreamModel TEXT NOT NULL,
              operationSource TEXT NOT NULL,
              dataSource TEXT NOT NULL,
              measurementSource TEXT NOT NULL,
              status TEXT NOT NULL,
              requestCount INTEGER NOT NULL,
              retryCount INTEGER NOT NULL DEFAULT 0,
              failoverCount INTEGER NOT NULL DEFAULT 0,
              successCount INTEGER NOT NULL,
              failedCount INTEGER NOT NULL,
              cancelledCount INTEGER NOT NULL,
              limitedCount INTEGER NOT NULL,
              partialCount INTEGER NOT NULL,
              inputTokens INTEGER NOT NULL,
              outputTokens INTEGER NOT NULL,
              totalTokens INTEGER NOT NULL,
              cacheCreationInputTokens INTEGER NOT NULL,
              cacheReadInputTokens INTEGER NOT NULL,
              cachedInputTokens INTEGER NOT NULL,
              reasoningTokens INTEGER NOT NULL,
              totalCostNanodollars INTEGER NOT NULL,
              costSampleCount INTEGER NOT NULL,
              durationMsTotal REAL NOT NULL,
              durationSampleCount INTEGER NOT NULL,
              firstTokenMsTotal REAL NOT NULL,
              firstTokenSampleCount INTEGER NOT NULL,
              PRIMARY KEY (
                dayStart, providerId, providerName, upstreamModel, operationSource,
                dataSource, measurementSource, status
              )
            );
            CREATE INDEX IF NOT EXISTS usage_daily_rollups_time_idx
              ON usage_daily_rollups (dayStart DESC);
            CREATE INDEX IF NOT EXISTS usage_daily_rollups_provider_model_idx
              ON usage_daily_rollups (providerId, upstreamModel, dayStart DESC);
            CREATE INDEX IF NOT EXISTS usage_daily_rollups_source_status_idx
              ON usage_daily_rollups (operationSource, dataSource, measurementSource, status, dayStart DESC);

            CREATE TABLE IF NOT EXISTS usage_pricing_entries (
              id TEXT PRIMARY KEY NOT NULL,
              providerId TEXT,
              modelPattern TEXT NOT NULL,
              effectiveFrom INTEGER NOT NULL,
              source TEXT NOT NULL,
              entryJson TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS usage_pricing_entries_lookup_idx
              ON usage_pricing_entries (providerId, modelPattern, effectiveFrom DESC);
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 2,
        name: 'usage-import-markers',
        async up(transaction) {
          await transaction.exec(`
            CREATE TABLE IF NOT EXISTS usage_import_markers (
              id TEXT PRIMARY KEY NOT NULL,
              completedAt INTEGER NOT NULL
            );
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 3,
        name: 'usage-route-attribution-rollups',
        async up(transaction) {
          const columns = await transaction.getAll<{ name: string }>(
            'PRAGMA table_info(usage_daily_rollups)',
          )
          const names = new Set(columns.map((column) => column.name))
          if (!names.has('retryCount')) {
            await transaction.exec(
              'ALTER TABLE usage_daily_rollups ADD COLUMN retryCount INTEGER NOT NULL DEFAULT 0',
            )
          }
          if (!names.has('failoverCount')) {
            await transaction.exec(
              'ALTER TABLE usage_daily_rollups ADD COLUMN failoverCount INTEGER NOT NULL DEFAULT 0',
            )
          }
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 4,
        name: 'usage-execution-identity-and-conversation-indexes',
        async up(transaction) {
          const columns = new Set((await transaction.getAll<{ name: string }>('PRAGMA table_info(usage_records)')).map(column => column.name))
          for (const column of ['logicalRequestId', 'responseExecutionId', 'conversationId']) {
            if (!columns.has(column)) await transaction.exec(`ALTER TABLE usage_records ADD COLUMN ${column} TEXT`)
          }
          const rows = await transaction.getAll<Pick<UsageRecordRow, 'id' | 'recordJson'>>('SELECT id, recordJson FROM usage_records')
          for (const row of rows) {
            let record: UsageRecord
            try { record = parseUsageRecord(JSON.parse(row.recordJson)) } catch { continue }
            await transaction.run(
              'UPDATE usage_records SET logicalRequestId = ?, responseExecutionId = ?, conversationId = ? WHERE id = ?',
              [record.execution?.logicalRequestId ?? null, record.execution?.responseExecutionId ?? null, record.conversationId ?? null, record.id],
            )
          }
          await transaction.exec(`
            CREATE INDEX IF NOT EXISTS usage_records_request_idx ON usage_records (logicalRequestId, occurredAt, id);
            CREATE INDEX IF NOT EXISTS usage_records_response_idx ON usage_records (responseExecutionId, occurredAt, id);
            CREATE INDEX IF NOT EXISTS usage_records_conversation_idx ON usage_records (conversationId, occurredAt DESC, id DESC);
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 5,
        name: 'logical-request-time-and-latest-result',
        async up(transaction) {
          const columns = new Set((await transaction.getAll<{ name: string }>('PRAGMA table_info(usage_records)')).map(column => column.name))
          if (!columns.has('requestStartedAt')) await transaction.exec('ALTER TABLE usage_records ADD COLUMN requestStartedAt INTEGER')
          const rows = await transaction.getAll<Pick<UsageRecordRow, 'id' | 'recordJson'>>('SELECT id, recordJson FROM usage_records')
          for (const row of rows) {
            let record: UsageRecord
            try { record = parseUsageRecord(JSON.parse(row.recordJson)) } catch { continue }
            await transaction.run('UPDATE usage_records SET requestStartedAt = ? WHERE id = ?',
              [record.execution?.requestStartedAt ?? null, record.id])
          }
          await transaction.exec(`
            CREATE INDEX IF NOT EXISTS usage_records_request_time_idx
              ON usage_records (COALESCE(requestStartedAt, occurredAt) DESC, id DESC);
            CREATE INDEX IF NOT EXISTS usage_records_request_result_idx
              ON usage_records (logicalRequestId, occurredAt DESC, completedAt DESC, id DESC);
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 6,
        name: 'archived-measurement-coverage-and-cost-sources',
        async up(transaction) {
          const columns = await transaction.getAll<{ name: string }>('PRAGMA table_info(usage_daily_rollups)')
          if (!columns.some(column => column.name === 'measurementsJson')) {
            await transaction.exec('ALTER TABLE usage_daily_rollups ADD COLUMN measurementsJson TEXT')
          }
        },
      },
    ]).catch((error) => {
      initialized = undefined
      throw error
    })
    await initialized
    return value
  }

  return {
    async append(record) {
      const normalized = parseUsageRecord(record)
      const result = await insertUsageRecord(await database(), normalized)
      return result.changes > 0
    },

    async importOnce(markerId, records) {
      const normalizedMarkerId = normalizeId(markerId)
      const normalizedRecords = records.map(parseUsageRecord)
      const value = await database()
      return value.transaction(async (transaction) => {
        const marker = await transaction.getFirst<{ id: string }>(
          'SELECT id FROM usage_import_markers WHERE id = ?',
          [normalizedMarkerId],
        )
        if (marker?.id === normalizedMarkerId) return false
        for (const record of normalizedRecords) await insertUsageRecord(transaction, record)
        const completedAt = normalizedRecords.reduce(
          (latest, record) => Math.max(latest, record.completedAt),
          0,
        )
        await transaction.run(
          'INSERT INTO usage_import_markers (id, completedAt) VALUES (?, ?)',
          [normalizedMarkerId, completedAt],
        )
        return true
      })
    },

    async list(request = {}) {
      const records = await readFilteredRecords(await database(), request.filter)
      const limit = normalizeLimit(request.limit)
      const offset = normalizeOffset(request.offset)
      const page = records.slice(offset, offset + limit)
      return {
        records: page,
        total: records.length,
        hasMore: offset + page.length < records.length,
      }
    },

    async listAll(filter) {
      return readFilteredRecords(await database(), filter)
    },

    async listRollups(filter) {
      return readFilteredRollups(await database(), filter)
    },
    async findExecution(reference: UsageDetailReference) {
      const id = normalizeId(reference.id)
      const column = reference.kind === 'request' ? 'logicalRequestId' : reference.kind === 'response' ? 'responseExecutionId'
        : reference.kind === 'attempt' ? 'id' : undefined
      if (!column) throw new UsageRecordRepositoryDataError('Usage detail reference is invalid.')
      const rows = await (await database()).getAll<UsageRecordRow>(
        `${usageRecordSelect()} WHERE ${column} = ? ORDER BY occurredAt ASC, completedAt ASC, id ASC LIMIT ?`,
        [id, MAX_DETAIL_RECORDS + 1],
      )
      return {
        records: rows.slice(0, MAX_DETAIL_RECORDS).flatMap(row => {
          const record = parsePersistedUsageRecord(row)
          return record ? [record] : []
        }),
        truncated: rows.length > MAX_DETAIL_RECORDS,
      }
    },
    async findRunAttempts(runId, providerId) {
      const rows = await (await database()).getAll<UsageRecordRow>(
        `${usageRecordSelect()} WHERE providerId = ? AND json_extract(recordJson, '$.runId') = ?
         ORDER BY occurredAt ASC, completedAt ASC, id ASC LIMIT ?`,
        [normalizeId(providerId), normalizeId(runId), MAX_DETAIL_RECORDS + 1],
      )
      const records = rows.slice(0, MAX_DETAIL_RECORDS).map(row => {
        const record = parsePersistedUsageRecord(row)
        if (!record) throw new UsageRecordRepositoryDataError('Usage run attempt cannot be decoded.')
        return record
      })
      return { records, truncated: rows.length > MAX_DETAIL_RECORDS }
    },
    async latestByProvider(providerIds) {
      if (!providerIds.length) return []
      if (providerIds.length > MAX_FILTER_VALUES || !providerIds.every(isBoundedId)) {
        throw new UsageRecordRepositoryDataError('Usage provider IDs are invalid.')
      }
      const ids = [...new Set(providerIds)]
      const rows = await (await database()).getAll<UsageRecordRow>(
        `${usageRecordSelect()} WHERE providerId IN (${ids.map(() => '?').join(', ')})
         AND id = (SELECT recent.id FROM usage_records recent WHERE recent.providerId = usage_records.providerId
           ORDER BY recent.occurredAt DESC, recent.id DESC LIMIT 1)`,
        ids,
      )
      return rows.flatMap(row => {
        const record = parsePersistedUsageRecord(row)
        return record ? [record] : []
      })
    },
    async latestByRequest(logicalRequestIds) {
      if (!logicalRequestIds.length) return []
      if (logicalRequestIds.length > MAX_FILTER_VALUES || !logicalRequestIds.every(isBoundedId)) {
        throw new UsageRecordRepositoryDataError('Usage request IDs are invalid.')
      }
      const ids = [...new Set(logicalRequestIds)]
      const rows = await (await database()).getAll<UsageRecordRow>(
        `${usageRecordSelect()} WHERE logicalRequestId IN (${ids.map(() => '?').join(', ')})
         AND id = (SELECT recent.id FROM usage_records recent WHERE recent.logicalRequestId = usage_records.logicalRequestId
           ORDER BY recent.occurredAt DESC, recent.completedAt DESC, recent.id DESC LIMIT 1)`,
        ids,
      )
      return rows.flatMap(row => {
        const record = parsePersistedUsageRecord(row)
        return record ? [record] : []
      })
    },

    async listPricingEntries() {
      const rows = await (await database()).getAll<UsagePricingEntryRow>(
        `SELECT id, providerId, modelPattern, effectiveFrom, source, entryJson
         FROM usage_pricing_entries
         ORDER BY effectiveFrom DESC, id ASC`,
      )
      return rows.flatMap((row) => {
        const entry = parsePersistedPricingEntry(row)
        return entry ? [entry] : []
      })
    },

    async savePricingEntry(entry, expectedRevision) {
      const normalized = parsePricingEntry(entry)
      if (normalized.source !== 'manual') {
        throw new UsageRecordRepositoryDataError('Only manual usage pricing overrides are persisted.')
      }
      const write = (executor: SqliteExecutor) => executor.run(
        `INSERT INTO usage_pricing_entries (
           id, providerId, modelPattern, effectiveFrom, source, entryJson
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           providerId = excluded.providerId,
           modelPattern = excluded.modelPattern,
           effectiveFrom = excluded.effectiveFrom,
           source = excluded.source,
           entryJson = excluded.entryJson`,
        [
          normalized.id,
          normalized.providerId ?? null,
          normalized.modelPattern,
          normalized.effectiveFrom,
          normalized.source,
          JSON.stringify(normalized),
        ],
      )
      const db = await database()
      if (expectedRevision === undefined) { await write(db); return }
      // Keep the comparison and write in the same transaction: an import or
      // another editor must not replace the baseline between the two.
      await db.transaction(async transaction => {
        const row = await transaction.getFirst<UsagePricingEntryRow>(
          'SELECT id, providerId, modelPattern, effectiveFrom, source, entryJson FROM usage_pricing_entries WHERE id = ?', [normalized.id],
        )
        if (!row || JSON.stringify(parsePersistedPricingEntry(row)) !== expectedRevision) throw new Error(USAGE_PRICING_CONFLICT)
        await write(transaction)
      })
    },

    async deletePricingEntry(id) {
      await (await database()).run('DELETE FROM usage_pricing_entries WHERE id = ?', [normalizeId(id)])
    },

    async compactBefore(cutoff) {
      const normalizedCutoff = normalizeTimestamp(cutoff, 'usage compaction cutoff')
      const value = await database()
      await value.transaction(async (transaction) => {
        const rows = await transaction.getAll<UsageRecordRow>(
          `${usageRecordSelect()} WHERE occurredAt < ?
           AND (logicalRequestId IS NULL OR NOT EXISTS (
             SELECT 1 FROM usage_records recent WHERE recent.logicalRequestId = usage_records.logicalRequestId AND recent.occurredAt >= ?
           )) ORDER BY occurredAt ASC, id ASC`,
          [normalizedCutoff, normalizedCutoff],
        )
        const records = rows.flatMap((row) => {
          const record = parsePersistedUsageRecord(row)
          return record ? [record] : []
        })
        const rollups = aggregateDailyRollups(deduplicateUsageAttempts(records))
        for (const rollup of rollups) await upsertDailyRollup(transaction, rollup)
        for (const record of records) {
          await transaction.run(
            'DELETE FROM usage_records WHERE id = ? AND occurredAt < ?',
            [record.id, normalizedCutoff],
          )
        }
      })
    },

    async clear() {
      const value = await database()
      await value.transaction(async (transaction) => {
        await transaction.run('DELETE FROM usage_records')
        await transaction.run('DELETE FROM usage_daily_rollups')
      })
    },
  }
}

export function createSqliteUsagePortableSnapshotRepository(
  databaseProvider: SqliteDatabaseProvider,
): UsagePortableSnapshotRepository {
  const recordRepository = createSqliteUsageRecordRepository(databaseProvider)

  async function database(signal?: AbortSignal) {
    throwIfUsageSnapshotCancelled(signal)
    // Initializes the shared diagnostics schema without scanning the usage history.
    await recordRepository.listPricingEntries()
    throwIfUsageSnapshotCancelled(signal)
    return databaseProvider.get()
  }

  return {
    async load(options = {}) {
      const value = await database(options.signal)
      return value.transaction(async (transaction) => {
        throwIfUsageSnapshotCancelled(options.signal)
        const records = await readFilteredRecords(transaction, { includeEstimated: true })
        throwIfUsageSnapshotCancelled(options.signal)
        const dailyRollups = await readFilteredRollups(transaction, { includeEstimated: true })
        throwIfUsageSnapshotCancelled(options.signal)
        const pricingRows = await transaction.getAll<UsagePricingEntryRow>(
          `SELECT id, providerId, modelPattern, effectiveFrom, source, entryJson
           FROM usage_pricing_entries
           ORDER BY effectiveFrom DESC, id ASC`,
        )
        const pricingEntries = pricingRows.flatMap((row) => {
          const entry = parsePersistedPricingEntry(row)
          return entry?.source === 'manual' ? [entry] : []
        })
        throwIfUsageSnapshotCancelled(options.signal)
        return parseUsagePortableSnapshot({
          schema: USAGE_PORTABLE_SNAPSHOT_SCHEMA,
          records,
          dailyRollups,
          pricingEntries,
        })
      })
    },

    async replace(snapshot, options = {}) {
      const normalized = parseUsagePortableSnapshot(snapshot)
      const value = await database(options.signal)
      await value.transaction(async (transaction) => {
        throwIfUsageSnapshotCancelled(options.signal)
        await transaction.run('DELETE FROM usage_records')
        await transaction.run('DELETE FROM usage_daily_rollups')
        await transaction.run('DELETE FROM usage_pricing_entries')
        await transaction.run('DELETE FROM usage_import_markers')

        for (const record of normalized.records) {
          throwIfUsageSnapshotCancelled(options.signal)
          await insertUsageRecord(transaction, record)
        }
        for (const rollup of normalized.dailyRollups) {
          throwIfUsageSnapshotCancelled(options.signal)
          await upsertDailyRollup(transaction, rollup)
        }
        for (const entry of normalized.pricingEntries) {
          throwIfUsageSnapshotCancelled(options.signal)
          await transaction.run(
            `INSERT INTO usage_pricing_entries (
               id, providerId, modelPattern, effectiveFrom, source, entryJson
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.providerId ?? null,
              entry.modelPattern,
              entry.effectiveFrom,
              entry.source,
              JSON.stringify(entry),
            ],
          )
        }
      })
    },
  }
}

export function parseUsagePortableSnapshot(value: unknown): UsagePortableSnapshot {
  const parsed = v.safeParse(usagePortableSnapshotSchema, value)
  if (!parsed.success) {
    throw new UsageRecordRepositoryDataError('Usage portable snapshot is invalid.')
  }
  const records = parsed.output.records.map(parseUsageRecord)
  const dailyRollups = parsed.output.dailyRollups.map((rollup) => {
    const normalized = parseUsageDailyRollup(rollup)
    if (!normalized) {
      throw new UsageRecordRepositoryDataError('Usage portable snapshot is invalid.')
    }
    const canonical = parseUsageDailyRollup({
      ...normalized,
      retryCount: normalized.retryCount ?? 0,
      failoverCount: normalized.failoverCount ?? 0,
    })
    if (!canonical) {
      throw new UsageRecordRepositoryDataError('Usage portable snapshot is invalid.')
    }
    return canonical
  })
  const pricingEntries = parsed.output.pricingEntries.map((entry) => {
    const normalized = parsePricingEntry(entry)
    if (normalized.source !== 'manual') {
      throw new UsageRecordRepositoryDataError(
        'Usage portable snapshots may contain only manual pricing entries.',
      )
    }
    return normalized
  })

  assertUniqueUsageSnapshotValues(records.map((record) => record.id), 'record')
  assertUniqueUsageSnapshotValues(
    dailyRollups.map((rollup) => JSON.stringify([
      rollup.dayStart,
      rollup.providerId,
      rollup.providerName,
      rollup.upstreamModel,
      rollup.operationSource,
      rollup.dataSource,
      rollup.measurementSource,
      rollup.status,
    ])),
    'daily rollup',
  )
  assertUniqueUsageSnapshotValues(pricingEntries.map((entry) => entry.id), 'pricing entry')

  return {
    schema: USAGE_PORTABLE_SNAPSHOT_SCHEMA,
    records: records.sort(compareUsageRecordsForPortableSnapshot),
    dailyRollups: dailyRollups.sort(compareUsageRollupsForPortableSnapshot),
    pricingEntries: pricingEntries.sort(compareUsagePricingForPortableSnapshot),
  }
}

async function readFilteredRecords(
  database: SqliteExecutor,
  filter: UsageRecordFilter | undefined,
): Promise<UsageRecord[]> {
  const query = buildUsageRecordQuery(filter)
  const rows = await database.getAll<UsageRecordRow>(
    `${usageRecordSelect()}${query.where} ORDER BY occurredAt DESC, id DESC`,
    query.parameters,
  )
  return rows.flatMap((row) => {
    const record = parsePersistedUsageRecord(row)
    return record ? [record] : []
  })
}

async function readFilteredRollups(
  database: SqliteExecutor,
  filter: UsageRecordFilter | undefined,
): Promise<UsageDailyRollup[]> {
  // Compaction intentionally removes request/conversation identities. Never attribute a rollup to a scoped conversation.
  if (filter?.conversationIds !== undefined || filter?.logicalRequestIds !== undefined) return []
  const query = buildUsageRollupQuery(filter)
  const rows = await database.getAll<Record<string, unknown>>(
    `${usageDailyRollupSelect()}${query.where} ORDER BY dayStart DESC, providerId ASC, upstreamModel ASC`,
    query.parameters,
  )
  return rows.flatMap((row) => {
    const rollup = parseUsageDailyRollupRow(row)
    return rollup ? [rollup] : []
  })
}

async function insertUsageRecord(database: SqliteExecutor, record: UsageRecord) {
  return database.run(
    `INSERT OR IGNORE INTO usage_records (
       id, occurredAt, completedAt, providerId, providerName, requestedModel,
       upstreamModel, pricingModel, operationSource, dataSource,
       measurementSource, status, recordJson, logicalRequestId, responseExecutionId, conversationId, requestStartedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    usageRecordParameters(record),
  )
}

function usageRecordSelect(): string {
  return `SELECT id, occurredAt, completedAt, providerId, providerName,
    requestedModel, upstreamModel, pricingModel, operationSource, dataSource,
    measurementSource, status, recordJson, logicalRequestId, responseExecutionId, conversationId, requestStartedAt FROM usage_records`
}

function usageDailyRollupSelect(): string {
  return `SELECT dayStart, providerId, providerName, upstreamModel,
    operationSource, dataSource, measurementSource, status, requestCount,
    retryCount, failoverCount, successCount, failedCount, cancelledCount, limitedCount, partialCount,
    inputTokens, outputTokens, totalTokens, cacheCreationInputTokens,
    cacheReadInputTokens, cachedInputTokens, reasoningTokens,
    totalCostNanodollars, costSampleCount, durationMsTotal,
    durationSampleCount, firstTokenMsTotal, firstTokenSampleCount, measurementsJson
    FROM usage_daily_rollups`
}

function buildUsageRecordQuery(filter: UsageRecordFilter | undefined): {
  where: string
  parameters: SqliteValue[]
} {
  const clauses: string[] = []
  const parameters: SqliteValue[] = []
  const value = filter ?? {}

  if (value.includeEstimated !== true) clauses.push("dataSource <> 'estimated'")
  if (value.startAt !== undefined) {
    clauses.push('COALESCE(requestStartedAt, occurredAt) >= ?')
    parameters.push(normalizeTimestamp(value.startAt, 'usage filter start'))
  }
  if (value.endAt !== undefined) {
    clauses.push('COALESCE(requestStartedAt, occurredAt) < ?')
    parameters.push(normalizeTimestamp(value.endAt, 'usage filter end'))
  }
  addListFilter(clauses, parameters, 'providerId', value.providerIds, isBoundedId)
  addListFilter(clauses, parameters, 'upstreamModel', value.models, isBoundedId)
  addListFilter(clauses, parameters, 'conversationId', value.conversationIds, isBoundedId)
  addListFilter(clauses, parameters, 'logicalRequestId', value.logicalRequestIds, isBoundedId)
  addListFilter(clauses, parameters, `COALESCE(
    (SELECT recent.status FROM usage_records recent
      WHERE recent.logicalRequestId = usage_records.logicalRequestId
      ORDER BY recent.occurredAt DESC, recent.completedAt DESC, recent.id DESC LIMIT 1),
    status)`, value.statuses, isUsageStatus)
  addListFilter(clauses, parameters, 'operationSource', value.operationSources, isOperationSource)
  addListFilter(clauses, parameters, 'dataSource', value.dataSources, isDataSource)

  const search = value.search?.trim()
  if (search) {
    if (search.length > MAX_SEARCH_LENGTH) {
      throw new UsageRecordRepositoryDataError('Usage search text is too long.')
    }
    const pattern = `%${escapeLikePattern(search)}%`
    clauses.push(`(
      providerId LIKE ? ESCAPE '\\' OR providerName LIKE ? ESCAPE '\\' OR
      requestedModel LIKE ? ESCAPE '\\' OR upstreamModel LIKE ? ESCAPE '\\' OR
      COALESCE(pricingModel, '') LIKE ? ESCAPE '\\' OR operationSource LIKE ? ESCAPE '\\' OR
      dataSource LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\'
    )`)
    parameters.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern)
  }

  return {
    where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    parameters,
  }
}

function buildUsageRollupQuery(filter: UsageRecordFilter | undefined): {
  where: string
  parameters: SqliteValue[]
} {
  const clauses: string[] = []
  const parameters: SqliteValue[] = []
  const value = filter ?? {}

  if (value.includeEstimated !== true) clauses.push("dataSource <> 'estimated'")
  if (value.startAt !== undefined) {
    clauses.push('dayStart >= ?')
    parameters.push(startOfUsageDay(normalizeTimestamp(value.startAt, 'usage filter start')))
  }
  if (value.endAt !== undefined) {
    clauses.push('dayStart < ?')
    parameters.push(normalizeTimestamp(value.endAt, 'usage filter end'))
  }
  addListFilter(clauses, parameters, 'providerId', value.providerIds, isBoundedId)
  addListFilter(clauses, parameters, 'upstreamModel', value.models, isBoundedId)
  addListFilter(clauses, parameters, 'status', value.statuses, isUsageStatus)
  addListFilter(clauses, parameters, 'operationSource', value.operationSources, isOperationSource)
  addListFilter(clauses, parameters, 'dataSource', value.dataSources, isDataSource)

  const search = value.search?.trim()
  if (search) {
    if (search.length > MAX_SEARCH_LENGTH) {
      throw new UsageRecordRepositoryDataError('Usage search text is too long.')
    }
    const pattern = `%${escapeLikePattern(search)}%`
    clauses.push(`(
      providerId LIKE ? ESCAPE '\\' OR providerName LIKE ? ESCAPE '\\' OR
      upstreamModel LIKE ? ESCAPE '\\' OR operationSource LIKE ? ESCAPE '\\' OR
      dataSource LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\'
    )`)
    parameters.push(pattern, pattern, pattern, pattern, pattern, pattern)
  }

  return {
    where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    parameters,
  }
}

function addListFilter<Value extends string>(
  clauses: string[],
  parameters: SqliteValue[],
  column: string,
  values: readonly Value[] | undefined,
  isValid: (value: unknown) => value is Value,
): void {
  if (values === undefined) return
  if (values.length === 0) {
    clauses.push('0 = 1')
    return
  }
  if (values.length > MAX_FILTER_VALUES || !values.every(isValid)) {
    throw new UsageRecordRepositoryDataError('Usage filter values are invalid.')
  }
  const unique = [...new Set(values)]
  clauses.push(`${column} IN (${unique.map(() => '?').join(', ')})`)
  parameters.push(...unique)
}

function parseUsageRecord(value: unknown): UsageRecord {
  const parsed = v.safeParse(usageRecordSchema, value)
  if (!parsed.success || parsed.output.completedAt < parsed.output.occurredAt) {
    throw new UsageRecordRepositoryDataError('Usage record is invalid.')
  }
  if (
    (parsed.output.actualProviderId !== undefined && parsed.output.actualProviderId !== parsed.output.providerId) ||
    (parsed.output.actualModel !== undefined && parsed.output.actualModel !== parsed.output.upstreamModel)
  ) {
    throw new UsageRecordRepositoryDataError('Usage record route attribution is inconsistent.')
  }
  if (parsed.output.execution && (!isUsageExecutionReference(parsed.output.execution)
    || parsed.output.execution.requestStartedAt > parsed.output.occurredAt)) {
    throw new UsageRecordRepositoryDataError('Usage execution reference is invalid.')
  }
  return parsed.output
}

function parsePersistedUsageRecord(row: UsageRecordRow): UsageRecord | undefined {
  try {
    const record = parseUsageRecord(JSON.parse(row.recordJson))
    return usageRecordMatchesRow(record, row) ? record : undefined
  } catch {
    return undefined
  }
}

function parseUsageDailyRollup(value: unknown): UsageDailyRollup | undefined {
  const parsed = v.safeParse(usageDailyRollupSchema, value)
  if (!parsed.success) return undefined
  const result = parsed.output
  const measurements = result.measurements
  if (measurements) {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'cachedInputTokens', 'reasoningTokens'] as const) {
      const samples = measurements.tokenSampleCounts[key] ?? 0
      if (samples > result.requestCount || (measurements.tokens[key] !== undefined) !== (samples > 0)) return undefined
    }
    const costCount = measurements.supplierCostSampleCount + measurements.estimatedCostSampleCount + measurements.unclassifiedCostSampleCount
    const costTotal = (measurements.supplierCostNanodollars ?? 0) + (measurements.estimatedCostNanodollars ?? 0) + (measurements.unclassifiedCostNanodollars ?? 0)
    if (!Number.isSafeInteger(costCount) || costCount !== result.costSampleCount
      || !Number.isSafeInteger(costTotal) || costTotal !== result.totalCostNanodollars) return undefined
  }
  return result
}

function parseUsageDailyRollupRow(row: Record<string, unknown>): UsageDailyRollup | undefined {
  const { measurementsJson, ...fields } = row
  if (measurementsJson !== null && measurementsJson !== undefined && typeof measurementsJson !== 'string') return undefined
  try {
    return parseUsageDailyRollup({
      ...fields, ...(typeof measurementsJson === 'string' ? { measurements: JSON.parse(measurementsJson) } : {}),
    })
  } catch { return undefined }
}

function usageRecordMatchesRow(record: UsageRecord, row: UsageRecordRow): boolean {
  return record.id === row.id &&
    record.occurredAt === row.occurredAt &&
    record.completedAt === row.completedAt &&
    record.providerId === row.providerId &&
    record.providerName === row.providerName &&
    record.requestedModel === row.requestedModel &&
    record.upstreamModel === row.upstreamModel &&
    (record.pricingModel ?? null) === row.pricingModel &&
    record.operationSource === row.operationSource &&
    record.dataSource === row.dataSource &&
    record.measurementSource === row.measurementSource &&
    record.status === row.status &&
    (record.execution?.logicalRequestId ?? null) === (row.logicalRequestId ?? null) &&
    (record.execution?.responseExecutionId ?? null) === (row.responseExecutionId ?? null) &&
    (record.conversationId ?? null) === (row.conversationId ?? null) &&
    (record.execution?.requestStartedAt ?? null) === (row.requestStartedAt ?? null)
}

function usageRecordParameters(record: UsageRecord): SqliteValue[] {
  return [
    record.id,
    record.occurredAt,
    record.completedAt,
    record.providerId,
    record.providerName,
    record.requestedModel,
    record.upstreamModel,
    record.pricingModel ?? null,
    record.operationSource,
    record.dataSource,
    record.measurementSource,
    record.status,
    JSON.stringify(record),
    record.execution?.logicalRequestId ?? null,
    record.execution?.responseExecutionId ?? null,
    record.conversationId ?? null,
    record.execution?.requestStartedAt ?? null,
  ]
}

function parsePricingEntry(value: unknown): UsagePricingEntry {
  const parsed = v.safeParse(pricingEntrySchema, value)
  if (!parsed.success) throw new UsageRecordRepositoryDataError('Usage pricing entry is invalid.')
  return parsed.output
}

function parsePersistedPricingEntry(row: UsagePricingEntryRow): UsagePricingEntry | undefined {
  try {
    const entry = parsePricingEntry(JSON.parse(row.entryJson))
    return entry.source === 'manual' &&
      entry.id === row.id &&
      (entry.providerId ?? null) === row.providerId &&
      entry.modelPattern === row.modelPattern &&
      entry.effectiveFrom === row.effectiveFrom &&
      entry.source === row.source
      ? entry
      : undefined
  } catch {
    return undefined
  }
}

function aggregateDailyRollups(records: readonly UsageRecord[]): UsageDailyRollup[] {
  const grouped = new Map<string, UsageDailyRollup>()
  const switches = new Set(usageRouteSwitchAttempts(records).map(record => record.id))
  for (const record of records) {
    const dimensions = [
      Math.floor((record.execution?.requestStartedAt ?? record.occurredAt) / DAY_MS) * DAY_MS,
      record.providerId,
      record.providerName,
      record.upstreamModel,
      record.operationSource,
      record.dataSource,
      record.measurementSource,
      record.status,
    ] as const
    const key = JSON.stringify(dimensions)
    const rollup = grouped.get(key) ?? createDailyRollup(record, dimensions[0], switches.has(record.id))
    if (grouped.has(key)) addRecordToRollup(rollup, record, switches.has(record.id))
    grouped.set(key, rollup)
  }
  return [...grouped.values()]
}

function createDailyRollup(record: UsageRecord, dayStart: number, switched: boolean): UsageDailyRollup {
  const rollup: UsageDailyRollup = {
    dayStart,
    providerId: record.providerId,
    providerName: record.providerName,
    upstreamModel: record.upstreamModel,
    operationSource: record.operationSource,
    dataSource: record.dataSource,
    measurementSource: record.measurementSource,
    status: record.status,
    requestCount: 0,
    retryCount: 0,
    failoverCount: 0,
    successCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    limitedCount: 0,
    partialCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    totalCostNanodollars: 0,
    costSampleCount: 0,
    durationMsTotal: 0,
    durationSampleCount: 0,
    firstTokenMsTotal: 0,
    firstTokenSampleCount: 0,
    measurements: {
      schema: 'islemind.usage-rollup-measurements.v1', tokens: {}, tokenSampleCounts: {},
      supplierCostSampleCount: 0, estimatedCostSampleCount: 0, unclassifiedCostSampleCount: 0,
    },
  }
  addRecordToRollup(rollup, record, switched)
  return rollup
}

function addRecordToRollup(rollup: UsageDailyRollup, record: UsageRecord, switched: boolean): void {
  rollup.requestCount = safeAdd(rollup.requestCount, 1)
  rollup.retryCount = safeAdd(
    rollup.retryCount ?? 0,
    record.attemptReason === 'retry' || record.attemptReason === 'rectification'
      ? 1
      : 0,
  )
  rollup.failoverCount = safeAdd(
    rollup.failoverCount ?? 0,
    Number(switched),
  )
  rollup.successCount = safeAdd(rollup.successCount, Number(record.status === 'success'))
  rollup.failedCount = safeAdd(rollup.failedCount, Number(record.status === 'failed'))
  rollup.cancelledCount = safeAdd(rollup.cancelledCount, Number(record.status === 'cancelled'))
  rollup.limitedCount = safeAdd(rollup.limitedCount, Number(record.status === 'limited'))
  rollup.partialCount = safeAdd(rollup.partialCount, Number(record.status === 'partial'))
  rollup.inputTokens = safeAdd(rollup.inputTokens, record.tokens.inputTokens ?? 0)
  rollup.outputTokens = safeAdd(rollup.outputTokens, record.tokens.outputTokens ?? 0)
  rollup.totalTokens = safeAdd(
    rollup.totalTokens,
    knownUsageTotal(record.tokens) ?? 0,
  )
  rollup.cacheCreationInputTokens = safeAdd(
    rollup.cacheCreationInputTokens,
    record.tokens.cacheCreationInputTokens ?? 0,
  )
  const compatibilityCached = record.tokens.cachedInputTokens ?? 0
  const cacheCreation = record.tokens.cacheCreationInputTokens ?? 0
  const cacheRead = record.tokens.cacheReadInputTokens ?? Math.max(0, compatibilityCached - cacheCreation)
  rollup.cacheReadInputTokens = safeAdd(rollup.cacheReadInputTokens, cacheRead)
  rollup.cachedInputTokens = safeAdd(
    rollup.cachedInputTokens,
    record.tokens.cachedInputTokens ?? safeAdd(cacheRead, cacheCreation),
  )
  rollup.reasoningTokens = safeAdd(rollup.reasoningTokens, record.tokens.reasoningTokens ?? 0)
  if (record.totalCostNanodollars !== undefined) {
    rollup.totalCostNanodollars = safeAdd(rollup.totalCostNanodollars, record.totalCostNanodollars)
    rollup.costSampleCount = safeAdd(rollup.costSampleCount, 1)
  }
  rollup.durationMsTotal = finiteAdd(rollup.durationMsTotal, record.durationMs)
  rollup.durationSampleCount = safeAdd(rollup.durationSampleCount, 1)
  if (record.firstTokenMs !== undefined) {
    rollup.firstTokenMsTotal = finiteAdd(rollup.firstTokenMsTotal, record.firstTokenMs)
    rollup.firstTokenSampleCount = safeAdd(rollup.firstTokenSampleCount, 1)
  }
  const measurements = rollup.measurements!
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'cachedInputTokens', 'reasoningTokens'] as const) {
    const value = key === 'totalTokens' ? knownUsageTotal(record.tokens)
      : key === 'cacheReadInputTokens' ? record.tokens.cacheReadInputTokens ?? (record.tokens.cachedInputTokens === undefined ? undefined : cacheRead)
        : key === 'cachedInputTokens' ? record.tokens.cachedInputTokens
          ?? (record.tokens.cacheReadInputTokens === undefined && record.tokens.cacheCreationInputTokens === undefined ? undefined : safeAdd(cacheRead, cacheCreation))
          : record.tokens[key]
    if (value === undefined) continue
    measurements.tokens[key] = safeAdd(measurements.tokens[key] ?? 0, value)
    measurements.tokenSampleCounts[key] = safeAdd(measurements.tokenSampleCounts[key] ?? 0, 1)
  }
  if (record.totalCostNanodollars !== undefined) {
    const [amount, samples] = record.costProvenance === 'supplier-known'
      ? ['supplierCostNanodollars', 'supplierCostSampleCount'] as const
      : record.costProvenance === 'price-table-estimate' ? ['estimatedCostNanodollars', 'estimatedCostSampleCount'] as const
        : ['unclassifiedCostNanodollars', 'unclassifiedCostSampleCount'] as const
    measurements[amount] = safeAdd(measurements[amount] ?? 0, record.totalCostNanodollars)
    measurements[samples] = safeAdd(measurements[samples], 1)
  }
}

async function upsertDailyRollup(database: SqliteExecutor, rollup: UsageDailyRollup): Promise<void> {
  const dimensions = ['dayStart', 'providerId', 'providerName', 'upstreamModel', 'operationSource', 'dataSource', 'measurementSource', 'status'] as const
  const integerKeys = ['requestCount', 'retryCount', 'failoverCount', 'successCount', 'failedCount', 'cancelledCount', 'limitedCount', 'partialCount',
    'inputTokens', 'outputTokens', 'totalTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'cachedInputTokens', 'reasoningTokens',
    'totalCostNanodollars', 'costSampleCount', 'durationSampleCount', 'firstTokenSampleCount'] as const
  const timingKeys = ['durationMsTotal', 'firstTokenMsTotal'] as const
  const previousRow = await database.getFirst<Record<string, unknown>>(
    `${usageDailyRollupSelect()} WHERE ${dimensions.map(key => `${key} = ?`).join(' AND ')}`,
    dimensions.map(key => rollup[key]),
  )
  const previous = previousRow ? parseUsageDailyRollupRow(previousRow) : undefined
  if (previousRow && !previous) throw new UsageRecordRepositoryDataError('The archived usage measurement is invalid.')
  const combined: UsageDailyRollup = { ...rollup, retryCount: rollup.retryCount ?? 0, failoverCount: rollup.failoverCount ?? 0 }
  if (previous) {
    for (const key of integerKeys) combined[key] = safeAdd(previous[key] ?? 0, rollup[key] ?? 0)
    for (const key of timingKeys) combined[key] = finiteAdd(previous[key], rollup[key])
    const measurements = mergeRollupMeasurements(previous, rollup)
    if (measurements) combined.measurements = measurements
    else delete combined.measurements
  }
  if (!parseUsageDailyRollup(combined)) throw new UsageRecordRepositoryDataError('The archived usage measurement is inconsistent.')
  const columns = [...dimensions, ...integerKeys, ...timingKeys, 'measurementsJson']
  const updated = [...integerKeys, ...timingKeys, 'measurementsJson']
  await database.run(
    `INSERT INTO usage_daily_rollups (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT (${dimensions.join(', ')}) DO UPDATE SET ${updated.map(key => `${key} = excluded.${key}`).join(', ')}`,
    [...dimensions.map(key => combined[key]), ...integerKeys.map(key => combined[key] ?? 0), ...timingKeys.map(key => combined[key]),
      combined.measurements ? JSON.stringify(combined.measurements) : null],
  )
}

function mergeRollupMeasurements(left: UsageDailyRollup, right: UsageDailyRollup): UsageRollupMeasurements | undefined {
  if (!left.measurements && !right.measurements) return undefined
  const before = rollupMeasurements(left)
  const incoming = rollupMeasurements(right)
  const result: UsageRollupMeasurements = {
    schema: 'islemind.usage-rollup-measurements.v1', tokens: {}, tokenSampleCounts: {},
    supplierCostSampleCount: safeAdd(before.supplierCostSampleCount, incoming.supplierCostSampleCount),
    estimatedCostSampleCount: safeAdd(before.estimatedCostSampleCount, incoming.estimatedCostSampleCount),
    unclassifiedCostSampleCount: safeAdd(before.unclassifiedCostSampleCount, incoming.unclassifiedCostSampleCount),
  }
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'cachedInputTokens', 'reasoningTokens'] as const) {
    if (before.tokens[key] === undefined && incoming.tokens[key] === undefined) continue
    result.tokens[key] = safeAdd(before.tokens[key] ?? 0, incoming.tokens[key] ?? 0)
    result.tokenSampleCounts[key] = safeAdd(before.tokenSampleCounts[key] ?? 0, incoming.tokenSampleCounts[key] ?? 0)
  }
  for (const key of ['supplierCostNanodollars', 'estimatedCostNanodollars', 'unclassifiedCostNanodollars'] as const) {
    if (before[key] !== undefined || incoming[key] !== undefined) result[key] = safeAdd(before[key] ?? 0, incoming[key] ?? 0)
  }
  return result
}

function rollupMeasurements(rollup: UsageDailyRollup): UsageRollupMeasurements {
  return rollup.measurements ?? {
    schema: 'islemind.usage-rollup-measurements.v1', tokens: {}, tokenSampleCounts: {},
    supplierCostSampleCount: 0, estimatedCostSampleCount: 0,
    unclassifiedCostSampleCount: rollup.costSampleCount,
    ...(rollup.costSampleCount ? { unclassifiedCostNanodollars: rollup.totalCostNanodollars } : {}),
  }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_LIMIT
  if (!Number.isFinite(value)) throw new UsageRecordRepositoryDataError('Usage page limit is invalid.')
  return Math.max(1, Math.min(Math.floor(value), MAX_PAGE_LIMIT))
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UsageRecordRepositoryDataError('Usage page offset is invalid.')
  }
  return value
}

function normalizeTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UsageRecordRepositoryDataError(`${label} is invalid.`)
  }
  return value
}

function startOfUsageDay(value: number): number {
  return Math.floor(value / DAY_MS) * DAY_MS
}

function normalizeId(value: string): string {
  if (!isBoundedId(value)) throw new UsageRecordRepositoryDataError('Usage pricing entry ID is invalid.')
  return value
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function isUsageStatus(value: unknown): value is UsageRecordStatus {
  return value === 'success' || value === 'failed' || value === 'cancelled' ||
    value === 'limited' || value === 'partial'
}

function isOperationSource(value: unknown): value is UsageOperationSource {
  return value === 'chat' || value === 'agent' || value === 'tavern' ||
    value === 'tool-continuation' || value === 'memory' || value === 'context' ||
    value === 'knowledge' || value === 'embedding' || value === 'transcription' ||
    value === 'speech' || value === 'media' || value === 'other'
}

function isDataSource(value: unknown): value is UsageDataSource {
  return value === 'live-provider' || value === 'estimated' || value === 'legacy-message'
}

function assertUniqueUsageSnapshotValues(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new UsageRecordRepositoryDataError(`Usage portable snapshot ${label} identities are duplicated.`)
  }
}

function compareUsageRecordsForPortableSnapshot(left: UsageRecord, right: UsageRecord): number {
  return compareNumbersDescending(left.occurredAt, right.occurredAt) ||
    compareStringsDescending(left.id, right.id)
}

function compareUsageRollupsForPortableSnapshot(
  left: UsageDailyRollup,
  right: UsageDailyRollup,
): number {
  return compareNumbersDescending(left.dayStart, right.dayStart) ||
    compareStringsAscending(left.providerId, right.providerId) ||
    compareStringsAscending(left.upstreamModel, right.upstreamModel) ||
    compareStringsAscending(left.providerName, right.providerName) ||
    compareStringsAscending(left.operationSource, right.operationSource) ||
    compareStringsAscending(left.dataSource, right.dataSource) ||
    compareStringsAscending(left.measurementSource, right.measurementSource) ||
    compareStringsAscending(left.status, right.status)
}

function compareUsagePricingForPortableSnapshot(
  left: UsagePricingEntry,
  right: UsagePricingEntry,
): number {
  return compareNumbersDescending(left.effectiveFrom, right.effectiveFrom) ||
    compareStringsAscending(left.id, right.id)
}

function compareNumbersDescending(left: number, right: number): number {
  return left === right ? 0 : left > right ? -1 : 1
}

function compareStringsAscending(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function compareStringsDescending(left: string, right: string): number {
  return -compareStringsAscending(left, right)
}

function throwIfUsageSnapshotCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The usage portable snapshot operation was cancelled.')
  error.name = 'AbortError'
  throw error
}

function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function safeAdd(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new UsageRecordRepositoryDataError('Usage aggregate exceeds the supported integer range.')
  }
  return result
}

function finiteAdd(left: number, right: number): number {
  const result = left + right
  if (!Number.isFinite(result) || result < 0) {
    throw new UsageRecordRepositoryDataError('Usage timing aggregate exceeds the supported numeric range.')
  }
  return result
}
