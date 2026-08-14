import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
  type SqliteValue,
} from '@/platform/storage'
import * as v from 'valibot'
import {
  USAGE_RECORD_SCHEMA,
  type UsageDataSource,
  type UsageDailyRollup,
  type UsageMeasurementSource,
  type UsageOperationSource,
  type UsagePricingEntry,
  type UsageRecord,
  type UsageRecordFilter,
  type UsageRecordRepository,
  type UsageRecordStatus,
} from '../contracts'

const MIGRATION_SCOPE = 'diagnostics'
const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 500
const MAX_FILTER_VALUES = 100
const MAX_SEARCH_LENGTH = 256
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
const nonNegativeIntegerSchema = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0))
const nonNegativeNumberSchema = v.pipe(v.number(), v.finite(), v.minValue(0))
const pricingRatesSchema = v.strictObject({
  inputNanodollarsPerMillionTokens: nonNegativeIntegerSchema,
  outputNanodollarsPerMillionTokens: nonNegativeIntegerSchema,
  cacheReadNanodollarsPerMillionTokens: v.optional(nonNegativeIntegerSchema),
  cacheCreationNanodollarsPerMillionTokens: v.optional(nonNegativeIntegerSchema),
  reasoningNanodollarsPerMillionTokens: v.optional(nonNegativeIntegerSchema),
  reasoningBilling: v.picklist(['included-in-output', 'separate']),
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
const usageRecordSchema = v.strictObject({
  schema: v.literal(USAGE_RECORD_SCHEMA),
  id: boundedIdSchema,
  occurredAt: nonNegativeIntegerSchema,
  completedAt: nonNegativeIntegerSchema,
  providerId: boundedIdSchema,
  providerName: boundedNameSchema,
  credentialGroupId: v.optional(boundedIdSchema),
  requestedModel: boundedIdSchema,
  upstreamModel: boundedIdSchema,
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
  providerId: v.optional(boundedIdSchema),
  modelPattern: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  displayName: boundedNameSchema,
  version: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  effectiveFrom: nonNegativeIntegerSchema,
  source: v.picklist(['built-in', 'manual']),
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

    async savePricingEntry(entry) {
      const normalized = parsePricingEntry(entry)
      if (normalized.source !== 'manual') {
        throw new UsageRecordRepositoryDataError('Only manual usage pricing overrides are persisted.')
      }
      await (await database()).run(
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
    },

    async deletePricingEntry(id) {
      await (await database()).run('DELETE FROM usage_pricing_entries WHERE id = ?', [normalizeId(id)])
    },

    async compactBefore(cutoff) {
      const normalizedCutoff = normalizeTimestamp(cutoff, 'usage compaction cutoff')
      const value = await database()
      await value.transaction(async (transaction) => {
        const rows = await transaction.getAll<UsageRecordRow>(
          `${usageRecordSelect()} WHERE occurredAt < ? ORDER BY occurredAt ASC, id ASC`,
          [normalizedCutoff],
        )
        const records = rows.flatMap((row) => {
          const record = parsePersistedUsageRecord(row)
          return record ? [record] : []
        })
        const rollups = aggregateDailyRollups(records)
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
  const query = buildUsageRollupQuery(filter)
  const rows = await database.getAll<Record<string, unknown>>(
    `${usageDailyRollupSelect()}${query.where} ORDER BY dayStart DESC, providerId ASC, upstreamModel ASC`,
    query.parameters,
  )
  return rows.flatMap((row) => {
    const rollup = parseUsageDailyRollup(row)
    return rollup ? [rollup] : []
  })
}

async function insertUsageRecord(database: SqliteExecutor, record: UsageRecord) {
  return database.run(
    `INSERT OR IGNORE INTO usage_records (
       id, occurredAt, completedAt, providerId, providerName, requestedModel,
       upstreamModel, pricingModel, operationSource, dataSource,
       measurementSource, status, recordJson
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    usageRecordParameters(record),
  )
}

function usageRecordSelect(): string {
  return `SELECT id, occurredAt, completedAt, providerId, providerName,
    requestedModel, upstreamModel, pricingModel, operationSource, dataSource,
    measurementSource, status, recordJson FROM usage_records`
}

function usageDailyRollupSelect(): string {
  return `SELECT dayStart, providerId, providerName, upstreamModel,
    operationSource, dataSource, measurementSource, status, requestCount,
    successCount, failedCount, cancelledCount, limitedCount, partialCount,
    inputTokens, outputTokens, totalTokens, cacheCreationInputTokens,
    cacheReadInputTokens, cachedInputTokens, reasoningTokens,
    totalCostNanodollars, costSampleCount, durationMsTotal,
    durationSampleCount, firstTokenMsTotal, firstTokenSampleCount
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
    clauses.push('occurredAt >= ?')
    parameters.push(normalizeTimestamp(value.startAt, 'usage filter start'))
  }
  if (value.endAt !== undefined) {
    clauses.push('occurredAt <= ?')
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
    clauses.push('dayStart <= ?')
    parameters.push(startOfUsageDay(normalizeTimestamp(value.endAt, 'usage filter end')))
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
  return parsed.success ? parsed.output : undefined
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
    record.status === row.status
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
  for (const record of records) {
    const dimensions = [
      Math.floor(record.occurredAt / DAY_MS) * DAY_MS,
      record.providerId,
      record.providerName,
      record.upstreamModel,
      record.operationSource,
      record.dataSource,
      record.measurementSource,
      record.status,
    ] as const
    const key = JSON.stringify(dimensions)
    const rollup = grouped.get(key) ?? createDailyRollup(record, dimensions[0])
    if (grouped.has(key)) addRecordToRollup(rollup, record)
    grouped.set(key, rollup)
  }
  return [...grouped.values()]
}

function createDailyRollup(record: UsageRecord, dayStart: number): UsageDailyRollup {
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
  }
  addRecordToRollup(rollup, record)
  return rollup
}

function addRecordToRollup(rollup: UsageDailyRollup, record: UsageRecord): void {
  rollup.requestCount = safeAdd(rollup.requestCount, 1)
  rollup.successCount = safeAdd(rollup.successCount, Number(record.status === 'success'))
  rollup.failedCount = safeAdd(rollup.failedCount, Number(record.status === 'failed'))
  rollup.cancelledCount = safeAdd(rollup.cancelledCount, Number(record.status === 'cancelled'))
  rollup.limitedCount = safeAdd(rollup.limitedCount, Number(record.status === 'limited'))
  rollup.partialCount = safeAdd(rollup.partialCount, Number(record.status === 'partial'))
  rollup.inputTokens = safeAdd(rollup.inputTokens, record.tokens.inputTokens ?? 0)
  rollup.outputTokens = safeAdd(rollup.outputTokens, record.tokens.outputTokens ?? 0)
  rollup.totalTokens = safeAdd(
    rollup.totalTokens,
    record.tokens.totalTokens ?? safeAdd(record.tokens.inputTokens ?? 0, record.tokens.outputTokens ?? 0),
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
}

async function upsertDailyRollup(database: SqliteExecutor, rollup: UsageDailyRollup): Promise<void> {
  await database.run(
    `INSERT INTO usage_daily_rollups (
       dayStart, providerId, providerName, upstreamModel, operationSource, dataSource,
       measurementSource, status, requestCount, successCount, failedCount,
       cancelledCount, limitedCount, partialCount, inputTokens, outputTokens,
       totalTokens, cacheCreationInputTokens, cacheReadInputTokens, cachedInputTokens,
       reasoningTokens, totalCostNanodollars, costSampleCount, durationMsTotal,
       durationSampleCount, firstTokenMsTotal, firstTokenSampleCount
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (
       dayStart, providerId, providerName, upstreamModel, operationSource,
       dataSource, measurementSource, status
     ) DO UPDATE SET
       requestCount = requestCount + excluded.requestCount,
       successCount = successCount + excluded.successCount,
       failedCount = failedCount + excluded.failedCount,
       cancelledCount = cancelledCount + excluded.cancelledCount,
       limitedCount = limitedCount + excluded.limitedCount,
       partialCount = partialCount + excluded.partialCount,
       inputTokens = inputTokens + excluded.inputTokens,
       outputTokens = outputTokens + excluded.outputTokens,
       totalTokens = totalTokens + excluded.totalTokens,
       cacheCreationInputTokens = cacheCreationInputTokens + excluded.cacheCreationInputTokens,
       cacheReadInputTokens = cacheReadInputTokens + excluded.cacheReadInputTokens,
       cachedInputTokens = cachedInputTokens + excluded.cachedInputTokens,
       reasoningTokens = reasoningTokens + excluded.reasoningTokens,
       totalCostNanodollars = totalCostNanodollars + excluded.totalCostNanodollars,
       costSampleCount = costSampleCount + excluded.costSampleCount,
       durationMsTotal = durationMsTotal + excluded.durationMsTotal,
       durationSampleCount = durationSampleCount + excluded.durationSampleCount,
       firstTokenMsTotal = firstTokenMsTotal + excluded.firstTokenMsTotal,
       firstTokenSampleCount = firstTokenSampleCount + excluded.firstTokenSampleCount`,
    [
      rollup.dayStart,
      rollup.providerId,
      rollup.providerName,
      rollup.upstreamModel,
      rollup.operationSource,
      rollup.dataSource,
      rollup.measurementSource,
      rollup.status,
      rollup.requestCount,
      rollup.successCount,
      rollup.failedCount,
      rollup.cancelledCount,
      rollup.limitedCount,
      rollup.partialCount,
      rollup.inputTokens,
      rollup.outputTokens,
      rollup.totalTokens,
      rollup.cacheCreationInputTokens,
      rollup.cacheReadInputTokens,
      rollup.cachedInputTokens,
      rollup.reasoningTokens,
      rollup.totalCostNanodollars,
      rollup.costSampleCount,
      rollup.durationMsTotal,
      rollup.durationSampleCount,
      rollup.firstTokenMsTotal,
      rollup.firstTokenSampleCount,
    ],
  )
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
