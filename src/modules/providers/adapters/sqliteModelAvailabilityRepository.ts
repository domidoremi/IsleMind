import { applySqliteMigrations, type SqliteDatabaseProvider, type SqliteExecutor, type SqliteValue } from '@/platform/storage'
import { PROVIDER_PROTOCOL_ADAPTER_IDS } from '@/types/providerContracts'
import { applyProviderModelAvailabilityEvidence, type ProviderModelAvailabilityEvidence } from '../providerModelAvailability'
import type {
  ProviderModelAvailabilityRepository, ProviderModelCurrent, ProviderModelHistoryFilter,
  ProviderModelHistoryPage, ProviderModelObservation, ProviderModelObservationEffect,
  ProviderModelObservationInput, ProviderModelOperation, ProviderModelRefreshSummary,
  ProviderModelScope, ProviderModelScopeIdentity,
} from '../providerModelAvailabilityContracts'

const MIGRATION_SCOPE = 'provider-model-availability'
const AVAILABILITIES = ['unknown', 'available', 'unavailable', 'retired'] as const
const ADVERTISEMENTS = ['unknown', 'present', 'not-advertised'] as const
const SOURCES = ['discovery', 'probe', 'generation', 'lifecycle'] as const
const OUTCOMES = ['success', 'failure', 'unsupported', 'cancelled'] as const
const EFFECTS = ['applied', 'preserved', 'superseded', 'invalidated'] as const
const REASONS = ['offline', 'timeout', 'dns_tls', 'unauthorized', 'rate_limited', 'server_error', 'generic_not_found', 'cancelled', 'unsupported', 'partial', 'policy_blocked'] as const

interface ScopeRow {
  scopeId: string; providerId: string; credentialSource: string; credentialGroupId: string
  protocolAdapterId: string; endpointVariant: string; epoch: string; invalidatedAt: number | null
  refreshOrder: number; refreshSummaryJson: string | null; lastSuccessfulRefreshAt: number | null
}
interface CurrentRow extends Omit<ScopeRow, 'epoch'> {
  scopeEpoch: string; epoch: string; modelId: string; availability: string; advertisement: string
  lastAppliedOrder: number; evidenceJson: string | null; lastSeenAt: number | null; updatedAt: number
}
interface ObservationRow extends Pick<ScopeRow, 'providerId' | 'credentialSource' | 'credentialGroupId' | 'protocolAdapterId' | 'endpointVariant'> {
  id: number; eventKey: string; scopeId: string; epoch: string; modelId: string | null
  operationId: string; orderToken: number; observedAt: number; source: string; outcome: string
  classification: string; availabilityAfter: string | null; effect: string
  latencyMs: number | null; httpStatus: number | null
}

export interface SqliteModelAvailabilityOptions {
  newId(): string
  now(): number
  /** Supplied by the Android-qualified composition; no desktop-derived defaults. */
  maxPageSize: number
  maxWriteBatchSize: number
  /** UTF-8 bytes of one normalized, allowlisted observation; not a catalog cap. */
  maxObservationPayloadBytes: number
}

/** One instance per application runtime. The shared platform queue owns SQL transactions. */
export function createSqliteModelAvailabilityRepository(
  provider: SqliteDatabaseProvider,
  options: SqliteModelAvailabilityOptions,
): ProviderModelAvailabilityRepository {
  positiveInteger(options.maxPageSize)
  positiveInteger(options.maxWriteBatchSize)
  positiveInteger(options.maxObservationPayloadBytes)
  let initialized: Promise<void> | undefined
  let order = 0

  async function database() {
    const db = await provider.get()
    initialized ??= (async () => {
      const marker = await db.getFirst<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_schema_migrations'")
      if (marker) {
        const version = await db.getFirst<{ version: number | null }>('SELECT MAX(version) AS version FROM platform_schema_migrations WHERE scope = ?', [MIGRATION_SCOPE])
        if ((version?.version ?? 0) > 1) throw new Error('Unsupported model availability schema')
      }
      await applySqliteMigrations(db, [{ scope: MIGRATION_SCOPE, version: 1, name: 'model-availability-evidence', async up(tx) {
        await tx.exec(`
          CREATE TABLE provider_model_scopes (
            scopeId TEXT PRIMARY KEY NOT NULL, providerId TEXT NOT NULL,
            credentialSource TEXT NOT NULL CHECK(credentialSource IN ('primary','group','none')),
            credentialGroupId TEXT NOT NULL, protocolAdapterId TEXT NOT NULL, endpointVariant TEXT NOT NULL,
            epoch TEXT NOT NULL, invalidatedAt INTEGER, refreshOrder INTEGER NOT NULL DEFAULT 0,
            refreshSummaryJson TEXT, lastSuccessfulRefreshAt INTEGER,
            UNIQUE(providerId, credentialSource, credentialGroupId, protocolAdapterId, endpointVariant)
          );
          CREATE TABLE provider_model_current (
            scopeId TEXT NOT NULL REFERENCES provider_model_scopes(scopeId) ON DELETE CASCADE,
            modelId TEXT NOT NULL, epoch TEXT NOT NULL,
            availability TEXT NOT NULL CHECK(availability IN ('unknown','available','unavailable','retired')),
            lastAppliedOrder INTEGER NOT NULL DEFAULT 0, evidenceJson TEXT,
            advertisement TEXT NOT NULL CHECK(advertisement IN ('unknown','present','not-advertised')),
            lastSeenAt INTEGER, remoteMetadataJson TEXT, updatedAt INTEGER NOT NULL,
            PRIMARY KEY(scopeId, modelId)
          );
          CREATE INDEX provider_model_current_availability ON provider_model_current(scopeId, availability, modelId);
          CREATE TABLE provider_model_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT, eventKey TEXT NOT NULL UNIQUE,
            scopeId TEXT NOT NULL REFERENCES provider_model_scopes(scopeId) ON DELETE CASCADE,
            epoch TEXT NOT NULL, modelId TEXT, operationId TEXT NOT NULL, orderToken INTEGER NOT NULL,
            observedAt INTEGER NOT NULL, source TEXT NOT NULL, outcome TEXT NOT NULL,
            classification TEXT NOT NULL, availabilityAfter TEXT, effect TEXT NOT NULL,
            latencyMs REAL, httpStatus INTEGER, detailsJson TEXT
          );
          CREATE INDEX provider_model_observations_model ON provider_model_observations(scopeId, modelId, observedAt DESC, id DESC);
          CREATE INDEX provider_model_observations_scope ON provider_model_observations(scopeId, observedAt DESC, id DESC);
          CREATE INDEX provider_model_observations_time ON provider_model_observations(observedAt DESC, id DESC);
        `)
      } }])
      // Aggregate only: history never crosses into JavaScript during initialization.
      const maximum = await db.getFirst<{ value: number }>(`SELECT MAX(value) AS value FROM (
        SELECT COALESCE(MAX(refreshOrder),0) AS value FROM provider_model_scopes UNION ALL
        SELECT COALESCE(MAX(lastAppliedOrder),0) FROM provider_model_current UNION ALL
        SELECT COALESCE(MAX(orderToken),0) FROM provider_model_observations
      )`)
      order = nonNegativeInteger(maximum?.value ?? 0)
    })().catch((error) => { initialized = undefined; throw error })
    await initialized
    return db
  }

  const repository: ProviderModelAvailabilityRepository = {
    async ensureScope(identity) {
      const key = scopeKey(identity)
      return (await database()).transaction(async (tx) => {
        const existing = await tx.getFirst<ScopeRow>(`SELECT * FROM provider_model_scopes WHERE
          providerId=? AND credentialSource=? AND credentialGroupId=? AND protocolAdapterId=? AND endpointVariant=?`, key)
        if (existing) return decodeScope(existing)
        const scopeId = identifier(options.newId())
        const epoch = identifier(options.newId())
        await tx.run(`INSERT INTO provider_model_scopes
          (scopeId, providerId, credentialSource, credentialGroupId, protocolAdapterId, endpointVariant, epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [scopeId, ...key, epoch])
        return decodeScope((await tx.getFirst<ScopeRow>('SELECT * FROM provider_model_scopes WHERE scopeId=?', [scopeId]))!)
      })
    },
    async getScope(scopeId) {
      const row = await (await database()).getFirst<ScopeRow>('SELECT * FROM provider_model_scopes WHERE scopeId=?', [identifier(scopeId)])
      return row ? decodeScope(row) : undefined
    },
    async beginOperation(scopeId, operationId) {
      const scope = await repository.getScope(scopeId)
      if (!scope) throw new Error('The model availability scope no longer exists')
      return { scopeId: scope.scopeId, epoch: scope.epoch, operationId: identifier(operationId ?? options.newId()), orderToken: positiveInteger(++order), startedAt: nonNegativeInteger(options.now()) }
    },
    async commit(operation, observations, refresh) {
      identifier(operation.scopeId); identifier(operation.epoch); identifier(operation.operationId); positiveInteger(operation.orderToken)
      if (observations.length > options.maxWriteBatchSize) throw new Error('Model observation batch exceeds the configured write budget')
      const inputs = observations.map((observation) => {
        const input = normalizeObservation(observation)
        if (new TextEncoder().encode(JSON.stringify(input)).byteLength > options.maxObservationPayloadBytes) {
          throw new Error('Model observation payload exceeds the configured byte budget')
        }
        return input
      })
      const summary = refresh && normalizeRefreshSummary(refresh)
      return (await database()).transaction(async (tx) => {
        const scope = await tx.getFirst<ScopeRow>('SELECT * FROM provider_model_scopes WHERE scopeId=?', [operation.scopeId])
        if (!scope) return { inserted: 0, deleted: true }
        let inserted = 0
        for (const input of inputs) {
          const previous = input.modelId ? await readCurrent(tx, operation.scopeId, input.modelId) : undefined
          const invalidated = scope.epoch !== operation.epoch
          const superseded = !invalidated && !!previous && !previous.invalidated && previous.lastAppliedOrder >= operation.orderToken
          const transition = applyProviderModelAvailabilityEvidence(previous, input.evidence)
          const effect: ProviderModelObservationEffect = invalidated ? 'invalidated' : superseded ? 'superseded' : transition.effect
          const row = await tx.run(`INSERT OR IGNORE INTO provider_model_observations
            (eventKey,scopeId,epoch,modelId,operationId,orderToken,observedAt,source,outcome,classification,availabilityAfter,effect,latencyMs,httpStatus,detailsJson)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            input.eventKey, operation.scopeId, operation.epoch, input.modelId ?? null, operation.operationId,
            operation.orderToken, input.observedAt, input.source, input.outcome,
            input.evidence.kind === 'operational' ? input.evidence.reason : input.evidence.kind,
            invalidated || !input.modelId ? null : superseded ? previous!.availability : transition.availability,
            effect, input.latencyMs ?? null, input.httpStatus ?? null,
            JSON.stringify({ schema: 'islemind.model-observation-details.v1', evidence: input.evidence }),
          ])
          if (!row.changes) continue
          inserted++
          if (!input.modelId || invalidated || superseded) continue
          const decisive = input.evidence.kind !== 'operational' && (input.evidence.kind !== 'discovery_absent' || input.evidence.complete)
          if (!decisive && previous) continue
          const retainsRetirement = previous?.availability === 'retired' && transition.availability === 'retired'
          const evidence = decisive ? retainsRetirement ? previous!.evidence : {
            schema: 'islemind.model-availability-evidence.v1', source: input.source, observedAt: input.observedAt, evidence: input.evidence,
          } : undefined
          await tx.run(`INSERT INTO provider_model_current
            (scopeId,modelId,epoch,availability,lastAppliedOrder,evidenceJson,advertisement,lastSeenAt,updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(scopeId,modelId) DO UPDATE SET
            epoch=excluded.epoch,availability=excluded.availability,lastAppliedOrder=excluded.lastAppliedOrder,
            evidenceJson=excluded.evidenceJson,advertisement=excluded.advertisement,lastSeenAt=excluded.lastSeenAt,updatedAt=excluded.updatedAt
            WHERE provider_model_current.epoch <> excluded.epoch OR provider_model_current.lastAppliedOrder < excluded.lastAppliedOrder`, [
            operation.scopeId, input.modelId, operation.epoch, transition.availability, decisive ? operation.orderToken : 0,
            evidence ? JSON.stringify(evidence) : null, transition.advertisement,
            input.evidence.kind === 'discovery_present' ? input.observedAt : previous?.lastSeenAt ?? null, input.observedAt,
          ])
        }
        if (summary) await tx.run(`UPDATE provider_model_scopes SET refreshOrder=?, refreshSummaryJson=?,
          lastSuccessfulRefreshAt=CASE WHEN ?='success' THEN ? ELSE lastSuccessfulRefreshAt END
          WHERE scopeId=? AND epoch=? AND refreshOrder < ?`, [operation.orderToken, JSON.stringify(summary), summary.status, summary.observedAt, operation.scopeId, operation.epoch, operation.orderToken])
        return { inserted, deleted: false }
      })
    },
    async getCurrent(scopeId, modelId) { return readCurrent(await database(), identifier(scopeId), identifier(modelId)) },
    async listCurrent(input) {
      const limit = pageLimit(input.limit, options.maxPageSize)
      const where = ['1=1']; const values: SqliteValue[] = []
      for (const [field, value] of [['s.providerId', input.providerId], ['c.scopeId', input.scopeId], ['c.modelId', input.modelId]] as const) {
        if (value !== undefined) { where.push(`${field}=?`); values.push(identifier(value)) }
      }
      if (input.credentialSource) {
        where.push('s.credentialSource=?')
        values.push(member(input.credentialSource.kind, ['primary', 'group', 'none'] as const))
        if (input.credentialSource.kind === 'group') {
          where.push('s.credentialGroupId=?'); values.push(identifier(input.credentialSource.groupId))
        }
      }
      if (input.after) { where.push('(c.scopeId > ? OR (c.scopeId=? AND c.modelId > ?))'); values.push(identifier(input.after.scopeId), input.after.scopeId, identifier(input.after.modelId)) }
      const rows = await (await database()).getAll<CurrentRow>(`${CURRENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.scopeId,c.modelId LIMIT ?`, [...values, limit])
      return rows.map(decodeCurrent)
    },
    async queryHistory(input) {
      const limit = pageLimit(input.limit, options.maxPageSize)
      const { where, values, key } = historyWhere(input.filter)
      const cursor = input.cursor
      if (cursor && (cursor.schema !== 'islemind.model-history-cursor.v1' || cursor.filterKey !== key)) throw new Error('Invalid model history cursor')
      if (cursor) { nonNegativeInteger(cursor.highWaterId); nonNegativeInteger(cursor.observedAt); positiveInteger(cursor.id) }
      return (await database()).transaction(async (tx) => {
        const highWaterId = cursor?.highWaterId ?? (await tx.getFirst<{ id: number }>('SELECT COALESCE(MAX(id),0) AS id FROM provider_model_observations'))!.id
        const bounded = [...where, 'o.id <= ?']; const boundedValues = [...values, highWaterId]
        const counts = await tx.getFirst<ProviderModelHistoryPage['counts']>(`SELECT COUNT(*) AS total,
          COALESCE(SUM(o.outcome='success'),0) AS success, COALESCE(SUM(o.outcome='failure'),0) AS failure,
          COALESCE(SUM(o.effect='applied'),0) AS applied, COALESCE(SUM(o.effect='preserved'),0) AS preserved,
          COALESCE(SUM(o.effect='superseded'),0) AS superseded, COALESCE(SUM(o.effect='invalidated'),0) AS invalidated
          FROM provider_model_observations o JOIN provider_model_scopes s ON s.scopeId=o.scopeId WHERE ${bounded.join(' AND ')}`, boundedValues)
        if (cursor) { bounded.push('(o.observedAt < ? OR (o.observedAt=? AND o.id < ?))'); boundedValues.push(cursor.observedAt, cursor.observedAt, cursor.id) }
        const rows = await tx.getAll<ObservationRow>(`SELECT o.id,o.eventKey,o.scopeId,o.epoch,o.modelId,o.operationId,o.orderToken,o.observedAt,
          o.source,o.outcome,o.classification,o.availabilityAfter,o.effect,o.latencyMs,o.httpStatus,
          s.providerId,s.credentialSource,s.credentialGroupId,s.protocolAdapterId,s.endpointVariant
          FROM provider_model_observations o JOIN provider_model_scopes s ON s.scopeId=o.scopeId
          WHERE ${bounded.join(' AND ')} ORDER BY o.observedAt DESC,o.id DESC LIMIT ?`, [...boundedValues, limit + 1])
        const items = rows.slice(0, limit).map(decodeObservation)
        const last = items[items.length - 1]
        return { items, highWaterId, counts: counts!, ...(rows.length > limit && last ? { nextCursor: {
          schema: 'islemind.model-history-cursor.v1' as const, filterKey: key, highWaterId, observedAt: last.observedAt, id: last.id,
        } } : {}) }
      })
    },
    async invalidateProvider(providerId) {
      await (await database()).run('UPDATE provider_model_scopes SET epoch=?, invalidatedAt=?, refreshSummaryJson=NULL, lastSuccessfulRefreshAt=NULL WHERE providerId=?', [identifier(options.newId()), nonNegativeInteger(options.now()), identifier(providerId)])
    },
    async invalidateAll() {
      await (await database()).run('UPDATE provider_model_scopes SET epoch=?, invalidatedAt=?, refreshSummaryJson=NULL, lastSuccessfulRefreshAt=NULL', [identifier(options.newId()), nonNegativeInteger(options.now())])
    },
    async removeProvider(providerId) { await (await database()).run('DELETE FROM provider_model_scopes WHERE providerId=?', [identifier(providerId)]) },
    async clear() { await (await database()).run('DELETE FROM provider_model_scopes') },
    async cleanup(input) {
      nonNegativeInteger(input.before); positiveInteger(input.maxRecords); pageLimit(input.batchSize, options.maxWriteBatchSize)
      return (await database()).transaction(async (tx) => {
        const cutoff = await tx.getFirst<{ observedAt: number; id: number }>('SELECT observedAt,id FROM provider_model_observations ORDER BY observedAt DESC,id DESC LIMIT 1 OFFSET ?', [input.maxRecords - 1])
        const where = cutoff ? '(observedAt < ? OR observedAt < ? OR (observedAt=? AND id < ?))' : 'observedAt < ?'
        const values = cutoff ? [input.before, cutoff.observedAt, cutoff.observedAt, cutoff.id] : [input.before]
        const deleted = await tx.run(`DELETE FROM provider_model_observations WHERE id IN (
          SELECT id FROM provider_model_observations WHERE ${where} ORDER BY observedAt,id LIMIT ?
        )`, [...values, input.batchSize])
        const more = await tx.getFirst<{ id: number }>(`SELECT id FROM provider_model_observations WHERE ${where} LIMIT 1`, values)
        return { removed: deleted.changes, hasMore: !!more }
      })
    },
  }
  return repository
}

const CURRENT_SELECT = `SELECT s.providerId,s.credentialSource,s.credentialGroupId,s.protocolAdapterId,s.endpointVariant,s.epoch AS scopeEpoch,
  c.scopeId,c.modelId,c.epoch,c.availability,c.advertisement,c.lastAppliedOrder,c.evidenceJson,c.lastSeenAt,c.updatedAt
  FROM provider_model_current c JOIN provider_model_scopes s ON s.scopeId=c.scopeId`

async function readCurrent(db: SqliteExecutor, scopeId: string, modelId: string) {
  const row = await db.getFirst<CurrentRow>(`${CURRENT_SELECT} WHERE c.scopeId=? AND c.modelId=?`, [scopeId, modelId])
  return row ? decodeCurrent(row) : undefined
}

function decodeIdentity(row: Pick<ScopeRow, 'providerId' | 'credentialSource' | 'credentialGroupId' | 'protocolAdapterId' | 'endpointVariant'>): ProviderModelScopeIdentity {
  const kind = member(row.credentialSource, ['primary', 'group', 'none'] as const)
  return { providerId: identifier(row.providerId), credentialSource: kind === 'group' ? { kind, groupId: identifier(row.credentialGroupId) } : { kind }, protocolAdapterId: member(row.protocolAdapterId, PROVIDER_PROTOCOL_ADAPTER_IDS), endpointVariant: identifier(row.endpointVariant) }
}

function scopeKey(identity: ProviderModelScopeIdentity): SqliteValue[] {
  const normalized = decodeIdentity({ ...identity, credentialSource: identity.credentialSource?.kind, credentialGroupId: identity.credentialSource?.kind === 'group' ? identity.credentialSource.groupId : '' })
  return [normalized.providerId, normalized.credentialSource.kind, normalized.credentialSource.kind === 'group' ? normalized.credentialSource.groupId : '', normalized.protocolAdapterId, normalized.endpointVariant]
}

function decodeScope(row: ScopeRow): ProviderModelScope {
  return { ...decodeIdentity(row), scopeId: identifier(row.scopeId), epoch: identifier(row.epoch), refreshOrder: nonNegativeInteger(row.refreshOrder),
    ...(row.invalidatedAt !== null ? { invalidatedAt: nonNegativeInteger(row.invalidatedAt) } : {}),
    ...(row.refreshSummaryJson !== null ? { refreshSummary: normalizeRefreshSummary(JSON.parse(row.refreshSummaryJson)) } : {}),
    ...(row.lastSuccessfulRefreshAt !== null ? { lastSuccessfulRefreshAt: nonNegativeInteger(row.lastSuccessfulRefreshAt) } : {}),
  }
}

function decodeCurrent(row: CurrentRow): ProviderModelCurrent {
  const invalidated = row.epoch !== row.scopeEpoch
  let evidence: ProviderModelCurrent['evidence']
  if (row.evidenceJson !== null) {
    const parsed = JSON.parse(row.evidenceJson)
    if (parsed?.schema !== 'islemind.model-availability-evidence.v1') throw new Error('Unsupported model availability evidence')
    evidence = { schema: parsed.schema, source: member(parsed.source, SOURCES), observedAt: nonNegativeInteger(parsed.observedAt), evidence: normalizeEvidence(parsed.evidence) }
  }
  return { ...decodeIdentity(row), scopeId: identifier(row.scopeId), modelId: identifier(row.modelId), epoch: identifier(row.epoch),
    availability: invalidated ? 'unknown' : member(row.availability, AVAILABILITIES), advertisement: invalidated ? 'unknown' : member(row.advertisement, ADVERTISEMENTS),
    lastAppliedOrder: nonNegativeInteger(row.lastAppliedOrder), updatedAt: nonNegativeInteger(row.updatedAt), invalidated,
    ...(!invalidated && evidence ? { evidence } : {}), ...(row.lastSeenAt !== null ? { lastSeenAt: nonNegativeInteger(row.lastSeenAt) } : {}),
  }
}

function decodeObservation(row: ObservationRow): ProviderModelObservation {
  return { ...decodeIdentity(row), id: positiveInteger(row.id), eventKey: identifier(row.eventKey), scopeId: identifier(row.scopeId), epoch: identifier(row.epoch),
    operationId: identifier(row.operationId), orderToken: positiveInteger(row.orderToken), observedAt: nonNegativeInteger(row.observedAt),
    ...(row.modelId !== null ? { modelId: identifier(row.modelId) } : {}), source: member(row.source, SOURCES), outcome: member(row.outcome, OUTCOMES),
    classification: member(row.classification, [...REASONS, 'discovery_present', 'discovery_absent', 'probe_success', 'generation_success', 'model_invalidated', 'model_retired', 'model_reinstated'] as const),
    effect: member(row.effect, EFFECTS), ...(row.availabilityAfter !== null ? { availabilityAfter: member(row.availabilityAfter, AVAILABILITIES) } : {}),
    ...(row.latencyMs !== null ? { latencyMs: finiteNonNegative(row.latencyMs) } : {}), ...(row.httpStatus !== null ? { httpStatus: httpStatus(row.httpStatus) } : {}),
  }
}

function normalizeObservation(input: ProviderModelObservationInput): ProviderModelObservationInput {
  return { eventKey: identifier(input.eventKey), ...(input.modelId !== undefined ? { modelId: identifier(input.modelId) } : {}), observedAt: nonNegativeInteger(input.observedAt),
    source: member(input.source, SOURCES), outcome: member(input.outcome, OUTCOMES), evidence: normalizeEvidence(input.evidence),
    ...(input.latencyMs !== undefined ? { latencyMs: finiteNonNegative(input.latencyMs) } : {}), ...(input.httpStatus !== undefined ? { httpStatus: httpStatus(input.httpStatus) } : {}),
  }
}

function normalizeEvidence(value: ProviderModelAvailabilityEvidence): ProviderModelAvailabilityEvidence {
  if (!value || typeof value !== 'object') throw new Error('Invalid model availability evidence')
  switch (value.kind) {
    case 'operational': return { kind: value.kind, reason: member(value.reason, REASONS) }
    case 'discovery_present':
    case 'discovery_absent':
      if (typeof value.accessAuthoritative !== 'boolean' || (value.kind === 'discovery_absent' && typeof value.complete !== 'boolean')) throw new Error('Invalid discovery evidence')
      return value.kind === 'discovery_present' ? { kind: value.kind, accessAuthoritative: value.accessAuthoritative } : { kind: value.kind, accessAuthoritative: value.accessAuthoritative, complete: value.complete }
    case 'probe_success': case 'generation_success': case 'model_invalidated': case 'model_retired': case 'model_reinstated': return { kind: value.kind }
    default: throw new Error('Unsupported model availability evidence')
  }
}

function normalizeRefreshSummary(value: ProviderModelRefreshSummary): ProviderModelRefreshSummary {
  if (value?.schema !== 'islemind.model-refresh-summary.v1') throw new Error('Unsupported model refresh summary')
  return { schema: value.schema, status: member(value.status, OUTCOMES), completeness: member(value.completeness, ['complete', 'partial', 'unknown'] as const),
    authority: member(value.authority, ['catalog-only', 'access-authoritative'] as const), coverage: member(value.coverage, ['exact-scope', 'filtered', 'unknown'] as const),
    pagination: member(value.pagination, ['exhausted', 'incomplete', 'unknown'] as const), truncation: member(value.truncation, ['none', 'detected', 'unknown'] as const),
    source: member(value.source, ['openai', 'anthropic', 'google', 'compatible', 'github-catalog', 'mimo', 'unsupported'] as const), observedAt: nonNegativeInteger(value.observedAt),
  }
}

function historyWhere(filter: ProviderModelHistoryFilter) {
  const where: string[] = []; const values: SqliteValue[] = []; const normalized: Record<string, SqliteValue> = {}
  for (const [name, field, value] of [['providerId','s.providerId',filter.providerId], ['scopeId','o.scopeId',filter.scopeId], ['modelId','o.modelId',filter.modelId]] as const) {
    if (value !== undefined) { normalized[name] = identifier(value); where.push(`${field}=?`); values.push(value) }
  }
  if (filter.credentialSource) {
    const kind = member(filter.credentialSource.kind, ['primary', 'group', 'none'] as const)
    normalized.credentialSource = kind; where.push('s.credentialSource=?'); values.push(kind)
    if (kind === 'group' && filter.credentialSource.kind === 'group') { normalized.credentialGroupId = identifier(filter.credentialSource.groupId); where.push('s.credentialGroupId=?'); values.push(filter.credentialSource.groupId) }
  }
  for (const [name, field, value, allowed] of [['source','o.source',filter.source,SOURCES], ['outcome','o.outcome',filter.outcome,OUTCOMES]] as const) {
    if (value !== undefined) { normalized[name] = member<string>(value, allowed); where.push(`${field}=?`); values.push(value) }
  }
  if (filter.from !== undefined) { normalized.from = nonNegativeInteger(filter.from); where.push('o.observedAt >= ?'); values.push(filter.from) }
  if (filter.to !== undefined) { normalized.to = nonNegativeInteger(filter.to); where.push('o.observedAt < ?'); values.push(filter.to) }
  return { where, values, key: JSON.stringify(normalized) }
}

function identifier(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f]/u.test(value)) throw new Error('Invalid model availability identity')
  return value
}
function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('Unsupported model availability value')
  return value as T
}
function nonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid model availability integer')
  return value
}
function positiveInteger(value: number): number { if (nonNegativeInteger(value) === 0) throw new Error('Invalid model availability limit'); return value }
function finiteNonNegative(value: number): number { if (!Number.isFinite(value) || value < 0) throw new Error('Invalid model observation duration'); return value }
function httpStatus(value: number): number { if (!Number.isInteger(value) || value < 100 || value > 599) throw new Error('Invalid model observation HTTP status'); return value }
function pageLimit(value: number, maximum: number): number { if (positiveInteger(value) > maximum) throw new Error('Model availability query exceeds the configured limit'); return value }
