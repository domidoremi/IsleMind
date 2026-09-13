import { describe, expect, it } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import { createSqliteModelAvailabilityRepository } from './sqliteModelAvailabilityRepository'
import type { ProviderModelObservationInput, ProviderModelScopeIdentity } from '../providerModelAvailabilityContracts'
import { createProviderModelAvailabilityRuntime } from '../providerModelAvailabilityRuntime'
import type { ProviderModelDiscoveryResult } from '../providerModelDiscoveryEvidence'

const identity: ProviderModelScopeIdentity = { providerId: 'p', credentialSource: { kind: 'primary' }, protocolAdapterId: 'openai-chat', endpointVariant: 'direct' }
const success = (eventKey: string, observedAt = 100): ProviderModelObservationInput => ({ eventKey, modelId: 'm', observedAt, source: 'generation', outcome: 'success', evidence: { kind: 'generation_success' } })

function fixture(path = ':memory:', maxObservationPayloadBytes = 8192) {
  const { Database } = require('bun:sqlite')
  let native = new Database(path)
  native.exec('PRAGMA foreign_keys=ON')
  const statements: string[] = []
  let failWrite = false
  const executor: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) {
      if (failWrite && sql.includes('INSERT INTO provider_model_current')) throw new Error('disk full')
      statements.push(sql)
      const value = native.query(sql).run(...values)
      return { changes: value.changes, lastInsertRowId: Number(value.lastInsertRowid) }
    },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { statements.push(sql); return native.query(sql).get(...values) as Row | null },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { statements.push(sql); return native.query(sql).all(...values) as Row[] },
  }
  const database: SqliteDatabase = { ...executor, async transaction(work) {
    native.exec('BEGIN IMMEDIATE')
    try { const result = await work(executor); native.exec('COMMIT'); return result }
    catch (error) { native.exec('ROLLBACK'); throw error }
  } }
  let next = 0
  const provider = { get: async () => database }
  const options = { newId: () => `id-${++next}`, now: () => 200, maxPageSize: 10, maxWriteBatchSize: 10, maxObservationPayloadBytes }
  const reopen = () => createSqliteModelAvailabilityRepository(provider, options)
  return { get native() { return native }, statements, reopen, repo: reopen(), failWrites: () => { failWrite = true },
    reconnect() { native.close(); native = new Database(path); native.exec('PRAGMA foreign_keys=ON'); return reopen() },
  }
}

describe('model availability (real SQLite)', () => {
  it('bounds normalized UTF-8 payloads before any batch writes without persisting untrusted extra fields', async () => {
    const { repo, native } = fixture(':memory:', 1024)
    try {
      const scope = await repo.ensureScope(identity)
      const operation = await repo.beginOperation(scope.scopeId)
      await expect(repo.commit(operation, [success('valid'), { ...success('界'.repeat(400)), modelId: 'm' }])).rejects.toThrow('byte budget')
      expect((await repo.queryHistory({ filter: {}, limit: 1 })).counts.total).toBe(0)
      expect(await repo.getCurrent(scope.scopeId, 'm')).toBeUndefined()
      await repo.commit(operation, [{ ...success('allowlisted'), ...{ body: 'not-diagnostics'.repeat(1000) } }])
      expect((await repo.queryHistory({ filter: {}, limit: 1 })).counts.total).toBe(1)
      expect(JSON.stringify(native.query('SELECT * FROM provider_model_observations').all())).not.toContain('not-diagnostics')
    } finally { native.close() }
  })

  it('accepts maximum-length Unicode identifiers within the explicit observation budget', async () => {
    const { repo, native } = fixture()
    try {
      const scope = await repo.ensureScope(identity)
      const input = { ...success('界'.repeat(512)), modelId: '語'.repeat(512) }
      expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThan(8192)
      await repo.commit(await repo.beginOperation(scope.scopeId), [input])
      expect((await repo.queryHistory({ filter: {}, limit: 1 })).items[0].modelId).toBe(input.modelId)
    } finally { native.close() }
  })

  it('migrates idempotently, isolates tagged credentials, and does not hydrate history on startup', async () => {
    const { repo, reopen, native, statements } = fixture()
    try {
      const primary = await repo.ensureScope(identity)
      const group = await repo.ensureScope({ ...identity, credentialSource: { kind: 'group', groupId: 'default' } })
      expect(group.scopeId).not.toBe(primary.scopeId)
      expect(await reopen().ensureScope(identity)).toEqual(primary)
      expect(native.query("SELECT COUNT(*) AS count FROM platform_schema_migrations WHERE scope='provider-model-availability'").get().count).toBe(1)
      expect(statements.some((sql) => /SELECT \* FROM provider_model_observations/i.test(sql))).toBe(false)
      expect(native.query('PRAGMA foreign_keys').get().foreign_keys).toBe(1)
    } finally { native.close() }
  })

  it('atomically updates current evidence and history; duplicate events are idempotent', async () => {
    const { repo, native, failWrites } = fixture()
    try {
      const scope = await repo.ensureScope(identity)
      const operation = await repo.beginOperation(scope.scopeId)
      expect(await repo.commit(operation, [success('once')])).toEqual({ inserted: 1, deleted: false })
      expect(await repo.commit(operation, [success('once')])).toEqual({ inserted: 0, deleted: false })
      expect((await repo.getCurrent(scope.scopeId, 'm'))?.availability).toBe('available')
      failWrites()
      const next = await repo.beginOperation(scope.scopeId)
      await expect(repo.commit(next, [{ ...success('rollback'), evidence: { kind: 'model_invalidated' } }])).rejects.toThrow('disk full')
      expect((await repo.getCurrent(scope.scopeId, 'm'))?.availability).toBe('available')
      expect((await repo.queryHistory({ filter: {}, limit: 2 })).counts.total).toBe(1)
    } finally { native.close() }
  })

  it('protects newer evidence from older refreshes and operational failures, including after reopening', async () => {
    const { repo, reopen, native } = fixture()
    try {
      const scope = await repo.ensureScope(identity)
      const refresh = await repo.beginOperation(scope.scopeId)
      const generation = await repo.beginOperation(scope.scopeId)
      await repo.commit(generation, [success('generation')])
      await repo.commit(refresh, [{ ...success('old-refresh'), source: 'discovery', evidence: { kind: 'discovery_absent', complete: true, accessAuthoritative: true } }])
      const failure = await repo.beginOperation(scope.scopeId)
      await repo.commit(failure, [{ ...success('offline'), outcome: 'failure', evidence: { kind: 'operational', reason: 'offline' } }])
      expect((await repo.getCurrent(scope.scopeId, 'm'))?.lastAppliedOrder).toBe(generation.orderToken)
      expect((await repo.queryHistory({ filter: {}, limit: 10 })).counts).toMatchObject({ total: 3, applied: 1, preserved: 1, superseded: 1 })
      const restarted = reopen()
      expect((await restarted.beginOperation(scope.scopeId)).orderToken).toBeGreaterThan(failure.orderToken)
      expect((await restarted.getCurrent(scope.scopeId, 'm'))?.availability).toBe('available')
    } finally { native.close() }
  })

  it('pins pagination high-water and filters in SQL across equal timestamps and late/backdated inserts', async () => {
    const { repo, native, statements } = fixture()
    try {
      const scope = await repo.ensureScope(identity)
      for (let index = 0; index < 5; index++) await repo.commit(await repo.beginOperation(scope.scopeId), [success(`event-${index}`, 100)])
      const filter = { providerId: 'p', credentialSource: { kind: 'primary' as const }, modelId: 'm', from: 50, to: 150 }
      const page = await repo.queryHistory({ filter, limit: 2 })
      expect(page.counts.total).toBe(5)
      await repo.commit(await repo.beginOperation(scope.scopeId), [success('backdated', 90)])
      await repo.commit(await repo.beginOperation(scope.scopeId), [success('newest', 110)])
      const second = await repo.queryHistory({ filter, limit: 2, cursor: page.nextCursor })
      const third = await repo.queryHistory({ filter, limit: 2, cursor: second.nextCursor })
      expect([...page.items, ...second.items, ...third.items].map((row) => row.eventKey)).toEqual(['event-4', 'event-3', 'event-2', 'event-1', 'event-0'])
      expect(third.nextCursor).toBeUndefined()
      expect(third.counts.total).toBe(5)
      await expect(repo.queryHistory({ filter: { ...filter, modelId: 'different' }, limit: 2, cursor: page.nextCursor })).rejects.toThrow('cursor')
      expect(statements.some((sql) => /COUNT\(\*\)/i.test(sql))).toBe(true)
      expect(statements.filter((sql) => /SELECT o\./.test(sql)).every((sql) => sql.includes('LIMIT'))).toBe(true)
      expect((await repo.queryHistory({ filter: { ...filter, source: 'probe' }, limit: 2 })).counts.total).toBe(0)
    } finally { native.close() }
  })

  it('invalidates epochs without trusting stale summaries; deletion/recreation cannot resurrect results', async () => {
    const { repo, native } = fixture()
    try {
      const scope = await repo.ensureScope(identity)
      await repo.commit(await repo.beginOperation(scope.scopeId), [success('valid')])
      const old = await repo.beginOperation(scope.scopeId)
      await repo.invalidateProvider('p')
      expect((await repo.getCurrent(scope.scopeId, 'm'))).toMatchObject({ availability: 'unknown', invalidated: true })
      await repo.commit(old, [success('invalidated')])
      expect((await repo.queryHistory({ filter: {}, limit: 3 })).counts.invalidated).toBe(1)
      await repo.removeProvider('p')
      expect((await repo.queryHistory({ filter: {}, limit: 3 })).counts.total).toBe(0)
      const recreated = await repo.ensureScope(identity)
      expect(recreated.scopeId).not.toBe(scope.scopeId)
      expect(await repo.commit(old, [success('deleted')])).toEqual({ inserted: 0, deleted: true })
      expect(await repo.getCurrent(recreated.scopeId, 'm')).toBeUndefined()
    } finally { native.close() }
  })

  it('projects scope identity by SQL join and filters current credential sources in SQL', async () => {
    const { repo, native } = fixture()
    try {
      for (const credentialSource of [{ kind: 'primary' as const }, { kind: 'group' as const, groupId: 'default' }]) {
        const scope = await repo.ensureScope({ ...identity, credentialSource })
        await repo.commit(await repo.beginOperation(scope.scopeId), [success(`source-${credentialSource.kind}`)])
      }
      const group = { kind: 'group' as const, groupId: 'default' }
      const current = await repo.listCurrent({ providerId: 'p', credentialSource: group, limit: 10 })
      expect(current).toHaveLength(1)
      expect(current[0].credentialSource).toEqual(group)
      const page = await repo.queryHistory({ filter: { credentialSource: group }, limit: 10 })
      expect(page.items).toHaveLength(1)
      expect(page.items[0]).toMatchObject({ providerId: 'p', credentialSource: group,
        protocolAdapterId: identity.protocolAdapterId, endpointVariant: identity.endpointVariant })
    } finally { native.close() }
  })

  it('bounds cleanup by age/count/batch without losing current retirement evidence', async () => {
    const { repo, native } = fixture()
    try {
      const scope = await repo.ensureScope(identity)
      await repo.commit(await repo.beginOperation(scope.scopeId), [{ ...success('retired', 1), source: 'lifecycle', evidence: { kind: 'model_retired' } }])
      for (let index = 2; index <= 8; index++) await repo.commit(await repo.beginOperation(scope.scopeId), [{ ...success(`probe-${index}`, index), source: 'probe', evidence: { kind: 'probe_success' } }])
      expect(await repo.cleanup({ before: 4, maxRecords: 3, batchSize: 2 })).toEqual({ removed: 2, hasMore: true })
      expect(await repo.cleanup({ before: 4, maxRecords: 3, batchSize: 2 })).toEqual({ removed: 2, hasMore: true })
      expect(await repo.cleanup({ before: 4, maxRecords: 3, batchSize: 2 })).toEqual({ removed: 1, hasMore: false })
      expect((await repo.queryHistory({ filter: {}, limit: 10 })).counts.total).toBe(3)
      expect((await repo.getCurrent(scope.scopeId, 'm'))).toMatchObject({ availability: 'retired', evidence: { evidence: { kind: 'model_retired' } } })
    } finally { native.close() }
  })

  it('advances ordering on repeated positive evidence and preserves it across a real connection restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'islemind-model-availability-'))
    const state = fixture(join(directory, 'availability.db'))
    try {
      const scope = await state.repo.ensureScope(identity)
      await state.repo.commit(await state.repo.beginOperation(scope.scopeId), [success('first')])
      const old = await state.repo.beginOperation(scope.scopeId)
      const latest = await state.repo.beginOperation(scope.scopeId)
      await state.repo.commit(latest, [success('still-available')])
      await state.repo.commit(old, [{ ...success('late'), evidence: { kind: 'model_invalidated' } }])
      const restarted = state.reconnect()
      expect((await restarted.getCurrent(scope.scopeId, 'm'))?.availability).toBe('available')
      expect((await restarted.beginOperation(scope.scopeId)).orderToken).toBeGreaterThan(latest.orderToken)
      expect((await restarted.listCurrent({ providerId: 'p', limit: 1 }))).toHaveLength(1)
      expect((await restarted.listCurrent({ providerId: 'other', limit: 1 }))).toHaveLength(0)
    } finally {
      state.native.close()
      if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Temporary database escaped its test directory')
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('projects allowlisted diagnostics only and rejects future versions without altering retained data', async () => {
    const { repo, reopen, native } = fixture()
    try {
      const scope = await repo.ensureScope({ ...identity, ...{ apiKey: 'must-not-persist' } })
      await repo.commit(await repo.beginOperation(scope.scopeId), [{ ...success('sanitized'), ...{ authorization: 'must-not-persist' }, evidence: { kind: 'generation_success', ...{ body: 'must-not-persist' } } }])
      expect(JSON.stringify(native.query('SELECT * FROM provider_model_observations').all())).not.toContain('must-not-persist')
      native.query('UPDATE provider_model_current SET evidenceJson=?').run('{"schema":"islemind.model-availability-evidence.v99"}')
      await expect(repo.getCurrent(scope.scopeId, 'm')).rejects.toThrow('Unsupported')
      expect(native.query('SELECT evidenceJson FROM provider_model_current').get().evidenceJson).toContain('v99')
      native.query('INSERT INTO platform_schema_migrations VALUES (?,?,?,?)').run('provider-model-availability', 99, 'future', 0)
      await expect(reopen().getScope(scope.scopeId)).rejects.toThrow('Unsupported')
      expect(native.query('SELECT COUNT(*) AS count FROM provider_model_observations').get().count).toBe(1)
    } finally { native.close() }
  })

  it('reconciles only qualified absence and cannot let an older refresh overwrite a newer generation', async () => {
    const { repo, native } = fixture()
    const runtime = createProviderModelAvailabilityRuntime({ repository: repo, refresh: async () => {}, retest: async () => {}, now: () => 200, writeBatchSize: 2, queryPageSize: 2 })
    const target = { ...identity, model: 'm' }
    try {
      await runtime.settleExecution(await runtime.beginExecution(target, 'initial'), 'm', { kind: 'generation_success' })
      const listing = (operation: ProviderModelDiscoveryResult['operation']): ProviderModelDiscoveryResult => ({
        schema: 'islemind.model-discovery-result.v1', providerId: 'p', scope: identity, operation, models: [], advertisedModelIds: [],
        valid: true, status: 'success', completeness: 'complete', authority: 'access-authoritative', coverage: 'exact-scope', pagination: 'exhausted', truncation: 'none', source: 'openai',
      })
      await runtime.observeDiscovery(identity, async (operation) => ({ ...listing(operation), completeness: 'partial' }))
      expect((await runtime.getAvailability(target)).availability).toBe('available')
      await runtime.observeDiscovery(identity, async (operation) => {
        await runtime.settleExecution(await runtime.beginExecution(target, 'newer'), 'm', { kind: 'generation_success' })
        return listing(operation)
      })
      expect((await runtime.getAvailability(target)).availability).toBe('available')
      await runtime.observeDiscovery(identity, async (operation) => listing(operation))
      expect((await runtime.getAvailability(target)).availability).toBe('unavailable')
      const group = { ...target, credentialSource: { kind: 'group' as const, groupId: 'failed-group' } }
      expect((await runtime.getAvailability(group)).availability).toBe('unknown')
      await runtime.withProviderMutation('p', async () => {
        await expect(runtime.beginExecution(target, 'during-change')).rejects.toThrow('configuration changed')
      })
      expect((await runtime.getAvailability(target)).availability).toBe('unknown')
    } finally { native.close() }
  })

  it('fences global route changes and refuses current evidence after failed durable invalidation until retry', async () => {
    const { repo, native } = fixture()
    let rejectInvalidation = true
    const runtime = createProviderModelAvailabilityRuntime({ repository: { ...repo, async invalidateAll() {
      if (rejectInvalidation) throw new Error('disk unavailable')
      await repo.invalidateAll()
    } }, refresh: async () => {}, retest: async () => {}, now: () => 200, writeBatchSize: 2, queryPageSize: 2 })
    const target = { ...identity, model: 'm' }
    try {
      const old = await runtime.beginExecution(target, 'before-proxy-change')
      await runtime.settleExecution(old, 'm', { kind: 'generation_success' })
      const pending = await runtime.beginExecution(target, 'pending-proxy-change')
      const captured = runtime.captureConfiguration()
      await expect(runtime.invalidateAll()).rejects.toThrow('disk unavailable')
      expect(captured).toThrow('configuration changed')
      await expect(runtime.getAvailability(target)).rejects.toThrow('configuration changed')
      await expect(runtime.port.listCurrentModels({ limit: 2 })).rejects.toThrow('could not be invalidated')
      // Historical observations remain inspectable; they do not admit execution.
      expect((await runtime.port.queryHistory({ filter: {}, limit: 2 })).counts.total).toBe(1)
      rejectInvalidation = false
      await runtime.invalidateAll()
      expect((await runtime.getAvailability(target)).availability).toBe('unknown')
      await runtime.settleExecution(pending, 'm', { kind: 'generation_success' })
      expect((await runtime.getAvailability(target)).availability).toBe('unknown')
      expect((await runtime.port.queryHistory({ filter: {}, limit: 2 })).counts.invalidated).toBe(1)
      await runtime.withAllMutation(async () => {
        await expect(runtime.beginExecution(target, 'during-import')).rejects.toThrow('configuration changed')
      })
      expect((await runtime.getAvailability(target)).availability).toBe('unknown')
    } finally { native.close() }
  })
})
