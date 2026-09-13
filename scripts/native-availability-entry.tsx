/** Offline-only Android qualification entry. Never selected by the production build. */
import React, { useEffect, useState } from 'react'
import { AppState, NativeModules, Text, View } from 'react-native'
import { registerRootComponent } from 'expo'
import { File, Paths } from 'expo-file-system'
import type { SqliteDatabase, SqliteDatabaseProvider, SqliteExecutor, SqliteValue } from '../src/platform/storage/contracts'
import type { ProviderModelAvailabilityRepository, ProviderModelObservationInput, ProviderModelScopeIdentity } from '../src/modules/providers/providerModelAvailabilityContracts'
import type { ProviderModelAvailabilityPort } from '../src/modules/providers/providerModelAvailabilityRuntime'

type Input = Record<string, any>
const native = NativeModules.Stage9
if (!native || native.packageName !== 'com.islemind.stage9') throw new Error('Qualification entry refuses a non-isolated package')
const global = globalThis as typeof globalThis & Record<string, any>
const started = performance.now()
const commandFile = new File(Paths.document, 'stage9-command.json')
const resultFile = new File(Paths.document, 'stage9-result.json')
const statusFile = new File(Paths.document, 'stage9-status.json')
const checkpointFile = new File(Paths.document, 'stage9-checkpoint.json')
const releaseFile = new File(Paths.document, 'stage9-release.json')
const lifecycleFile = new File(Paths.document, 'stage9-lifecycle.json')
const startupReads: string[] = []
const lifecycle: { state: string; at: number }[] = [{ state: AppState.currentState, at: Date.now() }]
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function save(file: File, value: unknown) { file.write(JSON.stringify(value)) }
function memory() {
  const info = (performance as any).memory
  return { usedJSHeapSize: info?.usedJSHeapSize ?? null, totalJSHeapSize: info?.totalJSHeapSize ?? null }
}
AppState.addEventListener('change', state => { lifecycle.push({ state, at: Date.now() }); save(lifecycleFile, lifecycle) })
global.__stage9SqlRead = (sql: string) => { if (native.mode === 'app' && /provider_model_observations/.test(sql)) startupReads.push(sql.replace(/\s+/g, ' ')) }
global.__stage9BootstrapReady = async (detail: Input) => {
  const rendered = await native.presented()
  const settings = require('../src/store/settingsStore').useSettingsStore.getState().settings
  save(resultFile, { id: native.runId, name: 'startup', value: { ...rendered, jsElapsedMs: performance.now() - started,
    ...detail, memory: memory(), availabilityHistoryReads: startupReads, hermes: Boolean(global.HermesInternal), dev: __DEV__,
    fixtureSettings: { autoUpdateCheckEnabled: settings.autoUpdateCheckEnabled, lastPreferredModel: settings.lastPreferredModel } } })
}

let provider: SqliteDatabaseProvider
let repo: ProviderModelAvailabilityRepository
let runtime: ReturnType<typeof import('../src/modules/providers/providerModelAvailabilityRuntime').createProviderModelAvailabilityRuntime>
let config: Input = {}
let clock = Date.now()
let counter = 0
let commits: number[] = []
let cleanups: number[] = []
let aggregates: number[] = []
let aggregateCapture = false
let pause: Input | undefined
let commitNumber = 0
let ui: ((value: Input | undefined) => void) | undefined
let pageCommitted: ((value: Input) => void) | undefined
global.__stage9PageCommitted = async (detail: Input) => { const notify = pageCommitted; pageCommitted = undefined; if (notify) notify({ ...detail, presented: await native.presented() }) }
const identity = (index = 0): ProviderModelScopeIdentity => ({ providerId: `stage9-provider-${index % 2}`,
  credentialSource: index < 2 ? { kind: 'primary' } : { kind: 'group', groupId: 'default' },
  protocolAdapterId: 'openai-chat', endpointVariant: 'direct' })

function instrument(executor: SqliteExecutor): SqliteExecutor {
  return {
    exec: sql => executor.exec(sql),
    async run(sql, values) {
      const value = await executor.run(sql, values)
      if (pause?.kind === 'transaction' && commitNumber === 2 && /INSERT OR IGNORE INTO provider_model_observations/.test(sql)) await paused()
      return value
    },
    async getFirst<Row extends object>(sql: string, values?: readonly SqliteValue[]) {
      const start = performance.now()
      const result = await executor.getFirst<Row>(sql, values)
      if (aggregateCapture && /SELECT COUNT\(\*\) AS total/.test(sql)) aggregates.push(performance.now() - start)
      return result
    },
    getAll: (sql, values) => executor.getAll(sql, values),
  }
}

async function configure(input: Input) {
  assert(typeof input.database === 'string' && /^(?:stage9-[a-z0-9-]+|islemind-context)\.db$/.test(input.database), 'Only isolated fixture databases are allowed')
  const { createExpoSqliteDatabaseProvider } = require('../src/platform/storage/expoSqliteDatabase') as typeof import('../src/platform/storage/expoSqliteDatabase')
  const { createSqliteModelAvailabilityRepository } = require('../src/modules/providers/adapters/sqliteModelAvailabilityRepository') as typeof import('../src/modules/providers/adapters/sqliteModelAvailabilityRepository')
  const { createProviderModelAvailabilityRuntime } = require('../src/modules/providers/providerModelAvailabilityRuntime') as typeof import('../src/modules/providers/providerModelAvailabilityRuntime')
  config = { pageSize: 100, writeBatchSize: 100, cleanupBatchSize: 100, historyAgeMs: 7 * 86400000,
    maxHistoryRecords: 500, autoCleanup: false, ...input }
  for (const key of ['pageSize', 'writeBatchSize', 'cleanupBatchSize']) assert(Number.isInteger(config[key]) && config[key] > 0 && config[key] <= 500, `Invalid ${key}`)
  const raw = createExpoSqliteDatabaseProvider({ databaseName: input.database })
  let wrapped: SqliteDatabase | undefined
  provider = { async get() {
    if (!wrapped) {
      const db = await raw.get()
      wrapped = { ...instrument(db), transaction: work => db.transaction(tx => work(instrument(tx))) }
    }
    return wrapped
  } }
  repo = createSqliteModelAvailabilityRepository(provider, { newId: () => `s9-${Date.now()}-${++counter}`,
    now: () => clock, maxPageSize: config.maxPageSize ?? 500, maxWriteBatchSize: Math.max(config.writeBatchSize, config.cleanupBatchSize),
    maxObservationPayloadBytes: config.maxObservationPayloadBytes ?? 8192 })
  const measured = { ...repo, async commit(...args: Parameters<typeof repo.commit>) {
    commitNumber++
    const start = performance.now()
    const result = await repo.commit(...args)
    commits.push(performance.now() - start)
    if (config.autoCleanup) {
      const cleanStart = performance.now()
      await repo.cleanup({ before: Math.max(0, clock - config.historyAgeMs), maxRecords: config.maxHistoryRecords, batchSize: config.cleanupBatchSize })
      cleanups.push(performance.now() - cleanStart)
    }
    if (pause && ['between', 'background'].includes(pause.kind) && commitNumber === 1) await paused()
    return result
  } }
  runtime = createProviderModelAvailabilityRuntime({ repository: measured, now: () => clock,
    writeBatchSize: config.writeBatchSize, queryPageSize: config.pageSize,
    async refresh() { await refresh(1000) },
    async retest(input) { await probe(input.model) },
  })
  commits = []; cleanups = []; aggregates = []; commitNumber = 0
  return { config, memory: memory() }
}

function observation(key: string, modelId: string, observedAt = clock, kind = 'probe_success'): ProviderModelObservationInput {
  return { eventKey: key, modelId, observedAt, source: kind === 'model_retired' ? 'lifecycle' : kind === 'operational' ? 'discovery' : 'probe',
    outcome: kind === 'operational' ? 'failure' : 'success', evidence: kind === 'operational' ? { kind, reason: 'offline' } : { kind } as ProviderModelObservationInput['evidence'] }
}
function summary(observedAt: number) {
  return { schema: 'islemind.model-refresh-summary.v1' as const, status: 'success' as const, completeness: 'complete' as const,
    authority: 'access-authoritative' as const, coverage: 'exact-scope' as const, pagination: 'exhausted' as const,
    truncation: 'none' as const, source: 'compatible' as const, observedAt }
}
async function seed(input: Input) {
  assert(Number.isInteger(input.rows) && input.rows >= 0 && input.rows <= 20000, 'Bounded fixture required')
  await repo.clear()
  const before = memory()
  const start = performance.now()
  const id = ++counter
  let maxNormalizedBytes = 0
  for (let scopeIndex = 0; scopeIndex < 4; scopeIndex++) {
    const scope = await repo.ensureScope(identity(scopeIndex))
    const operation = await repo.beginOperation(scope.scopeId)
    let rows: ProviderModelObservationInput[] = []
    for (let index = scopeIndex; index < input.rows; index += 4) {
      const model = index === 0 ? 'retired' : `model-${String(index % (input.models ?? 1000)).padStart(5, '0')}`
      const key = `seed-${id}-${index}`
      const pad = (value: string) => input.payload === 'maximum' ? value.padEnd(512, '界') : value
      const row = observation(pad(key), pad(model), clock - (input.ageDays ? (index % (input.ageDays + 1)) * 86400000 : index % 10 * 3600000),
        index === 0 ? 'model_retired' : index % 5 === 0 ? 'operational' : 'probe_success')
      maxNormalizedBytes = Math.max(maxNormalizedBytes, new TextEncoder().encode(JSON.stringify(row)).byteLength)
      rows.push(row)
      if (rows.length === config.writeBatchSize) { await repo.commit(operation, rows); rows = [] }
    }
    if (rows.length) await repo.commit(operation, rows)
  }
  return { elapsedMs: performance.now() - start, memoryBefore: before, memoryAfter: memory(), storage: await storage(), spec: input, maxNormalizedBytes }
}
async function storage() {
  const db = await provider.get()
  const directory = new File(Paths.document, 'SQLite', config.database)
  const size = (suffix: string) => { const file = suffix ? new File(directory.uri + suffix) : directory; return file.exists ? file.size : 0 }
  return { database: config.database, dbBytes: size(''), walBytes: size('-wal'), shmBytes: size('-shm'),
    pageCount: await db.getFirst('PRAGMA page_count'), pageSize: await db.getFirst('PRAGMA page_size'),
    freePages: await db.getFirst('PRAGMA freelist_count'),
    journalMode: await db.getFirst('PRAGMA journal_mode'), synchronous: await db.getFirst('PRAGMA synchronous'),
    foreignKeys: await db.getFirst('PRAGMA foreign_keys'), autoCheckpoint: await db.getFirst('PRAGMA wal_autocheckpoint'),
    history: await db.getFirst('SELECT COUNT(*) AS count FROM provider_model_observations'),
    current: await db.getFirst('SELECT COUNT(*) AS count FROM provider_model_current'),
    maxPayload: await db.getFirst('SELECT MAX(length(CAST(detailsJson AS BLOB))) AS detailsBytes, MAX(length(CAST(eventKey AS BLOB))+COALESCE(length(CAST(modelId AS BLOB)),0)+length(CAST(detailsJson AS BLOB))) AS variableColumnBytes FROM provider_model_observations') }
}
async function integrity() {
  const db = await provider.get()
  const result = { integrity: await db.getAll('PRAGMA integrity_check'), foreignKeyViolations: await db.getAll('PRAGMA foreign_key_check') }
  assert(JSON.stringify(result.integrity) === '[{"integrity_check":"ok"}]', 'SQLite integrity failed')
  assert(result.foreignKeyViolations.length === 0, 'Foreign key violation')
  return result
}
async function queries(input: Input) {
  const rows = input.rows
  const detail: number[] = [], filtered: number[] = [], first: number[] = []
  const before = memory()
  aggregates = []; aggregateCapture = true
  try {
    for (let index = 0; index < input.repeats; index++) {
      let start = performance.now()
      const one = await runtime.port.queryHistory({ filter: {}, limit: config.pageSize })
      first.push(performance.now() - start)
      assert(one.counts.total === rows && one.items.length === Math.min(rows, config.pageSize), 'First page count mismatch')
      start = performance.now()
      await Promise.all([runtime.port.queryHistory({ filter: {}, limit: config.pageSize }),
        runtime.port.listCurrentModels({ limit: config.pageSize }),
        runtime.port.queryHistory({ filter: { outcome: 'failure' }, limit: 1 })])
      detail.push(performance.now() - start)
      const filter = { providerId: 'stage9-provider-0', credentialSource: { kind: 'group' as const, groupId: 'default' },
        source: 'probe' as const, from: Math.max(0, clock - 86400000), to: clock + 1 }
      start = performance.now()
      const page = await runtime.port.queryHistory({ filter, limit: config.pageSize })
      filtered.push(performance.now() - start)
      assert(page.items.every(row => row.providerId === filter.providerId && row.credentialSource.kind === 'group' && row.source === 'probe'), 'SQL filter mismatch')
      const specific = await runtime.port.queryHistory({ filter: { modelId: 'model-00002' }, limit: config.pageSize })
      assert(specific.items.every(row => row.modelId === 'model-00002'), 'Model filter mismatch')
    }
  } finally { aggregateCapture = false }
  return { first, detail, filtered, aggregates, memoryBefore: before, memoryAfter: memory(), config }
}
async function pagination() {
  const first = await repo.queryHistory({ filter: {}, limit: config.pageSize })
  const ids = new Set(first.items.map(row => row.id))
  let page = first
  while (page.nextCursor) {
    page = await repo.queryHistory({ filter: {}, limit: config.pageSize, cursor: page.nextCursor })
    for (const item of page.items) { assert(!ids.has(item.id), 'Cursor duplicated a record'); ids.add(item.id) }
  }
  assert(ids.size === first.counts.total, 'Cursor omitted records')
  return { count: ids.size, highWaterId: first.highWaterId, complete: true }
}
async function refresh(count: number, includeRetired = false) {
  const ids = Array.from({ length: count }, (_, index) => includeRetired && index === 0 ? 'retired' : `refresh-model-${index}`)
  return runtime.observeDiscovery(identity(), async operation => {
    if (pause) { pause.operation = operation; save(checkpointFile, { ...pause, config, clock }) }
    return { ...summary(clock), schema: 'islemind.model-discovery-result.v1', providerId: identity().providerId,
      models: [], advertisedModelIds: ids, valid: true, scope: identity(), operation }
  })
}
async function probe(model: string) {
  return runtime.observeProbe({ ...identity(), model }, async () => ({ ok: true, modelAccess: 'available', durationMs: 0,
    evidence: { classification: 'success' }, httpStatus: 200 } as any))
}
function frameSample() {
  const frames: number[] = []
  const heaps: Input[] = []
  let last = performance.now(), memoryAt = last, stopped = false
  function frame(at: number) {
    if (stopped) return
    frames.push(at - last); last = at
    if (at - memoryAt >= 250) { heaps.push({ at, ...memory() }); memoryAt = at }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  return () => { stopped = true; return { frameIntervalsMs: frames, heapSamples: heaps } }
}
async function measureRefresh(input: Input) {
  const before = await storage()
  commits = []; cleanups = []; commitNumber = 0
  const stop = frameSample(), beforeHeap = memory()
  const start = performance.now()
  await refresh(input.models)
  const elapsedMs = performance.now() - start
  const sampled = stop()
  const after = await storage()
  return { elapsedMs, commits, cleanups, before, after, memoryBefore: beforeHeap, memoryAfter: memory(), ...sampled }
}
async function cleanup() {
  const samples: number[] = []
  const before = await storage()
  let total = 0, result
  const stop = frameSample(), start = performance.now()
  do {
    const at = performance.now()
    result = await repo.cleanup({ before: clock - config.historyAgeMs, maxRecords: config.maxHistoryRecords, batchSize: config.cleanupBatchSize })
    samples.push(performance.now() - at)
    assert(result.removed <= config.cleanupBatchSize, 'Cleanup exceeded its bounded batch')
    total += result.removed
  } while (result.hasMore)
  const elapsedMs = performance.now() - start
  const sampled = stop()
  const scope = await repo.ensureScope(identity())
  assert((await repo.getCurrent(scope.scopeId, 'retired'))?.availability === 'retired', 'Cleanup lost current retirement proof')
  const after = await storage()
  assert((after.history as any).count <= config.maxHistoryRecords, 'History still exceeds count budget')
  const expired = await (await provider.get()).getFirst<{ count: number }>('SELECT COUNT(*) AS count FROM provider_model_observations WHERE observedAt < ?', [clock - config.historyAgeMs])
  assert(expired?.count === 0, 'Age cleanup incomplete')
  return { elapsedMs, samples, total, before, after, ...sampled, integrity: await integrity() }
}
async function paused() {
  const value = pause!
  pause = undefined
  save(statusFile, { state: 'paused', kind: value.kind, runId: native.runId, at: Date.now() })
  if (value.kind !== 'background') await new Promise(() => undefined)
  else {
    const deadline = Date.now() + 90000
    while (!releaseFile.exists || (await releaseFile.text()) !== native.runId) {
      assert(Date.now() < deadline, 'Background rendezvous timed out')
      await sleep(200)
    }
  }
}
async function arm(input: Input) {
  await repo.clear()
  const scope = await repo.ensureScope(identity())
  await repo.commit(await repo.beginOperation(scope.scopeId), [observation('prior-retired', 'retired', clock - 60000, 'model_retired'),
    observation('prior-old-only', 'old-only', clock - 60000)], summary(clock - 60000))
  commitNumber = 0
  pause = { kind: input.kind, scope, firstBatch: config.writeBatchSize, targetModels: input.models ?? 200, oldSuccessAt: clock - 60000 }
  await refresh(pause.targetModels, true)
  return { storage: await storage(), lifecycle, integrity: await integrity() }
}
async function recover(input: Input) {
  const saved = JSON.parse(await checkpointFile.text())
  await configure(saved.config)
  clock = saved.clock
  const scope = await repo.getScope(saved.scope.scopeId)
  const firstUncommitted = await repo.getCurrent(saved.scope.scopeId, `refresh-model-${saved.firstBatch}`)
  const old = await repo.getCurrent(saved.scope.scopeId, 'old-only')
  const retired = await repo.getCurrent(saved.scope.scopeId, 'retired')
  const before = await storage()
  assert(scope?.lastSuccessfulRefreshAt === saved.oldSuccessAt, 'Interrupted refresh reported a false completed success')
  assert(firstUncommitted === undefined, 'Uncommitted transaction survived process death')
  assert(old?.availability === 'available' && retired?.availability === 'retired', 'Interrupted refresh destroyed trusted proof')
  assert((before.history as any).count === 2 + saved.firstBatch, 'Wrong committed-prefix length')
  const newer = await repo.beginOperation(saved.scope.scopeId)
  assert(newer.orderToken > saved.operation.orderToken, 'Order token regressed after restart')
  const checked = await integrity()
  if (input.complete !== false) {
    clock += 1
    await refresh(saved.targetModels, true)
    assert((await repo.getCurrent(saved.scope.scopeId, 'old-only'))?.availability === 'unavailable', 'Complete authoritative absence not applied')
    assert((await repo.getCurrent(saved.scope.scopeId, 'retired'))?.availability === 'retired', 'Discovery overrode explicit retirement')
    assert((await repo.getScope(saved.scope.scopeId))?.lastSuccessfulRefreshAt === clock, 'Successful recovery not recorded')
  }
  return { interruption: saved.kind, before, after: await storage(), integrity: checked, orderAdvanced: true,
    trustedEvidencePreserved: true, falseSuccessPrevented: true, completed: input.complete !== false }
}
async function show(input: Input) {
  const { useSettingsStore } = require('../src/store/settingsStore') as typeof import('../src/store/settingsStore')
  useSettingsStore.setState({ providers: [0, 1].map(index => ({ id: `stage9-provider-${index}`, name: `Fixture ${index}`,
    type: 'custom' as const, enabled: true, models: [], baseUrl: 'https://invalid.invalid',
    credentialGroups: [{ id: 'default', name: 'Fixture group', enabled: true }] } as any)) })
  const start = performance.now()
  const rendered = new Promise<Input>((resolve, reject) => {
    const timeout = setTimeout(() => { pageCommitted = undefined; reject(new Error('Real availability screen did not commit its page')) }, 15000)
    pageCommitted = value => { clearTimeout(timeout); resolve(value) }
  })
  ui?.({ key: ++counter, availability: runtime.port, pageSize: input.pageSize ?? config.pageSize, initialProviderId: input.providerId ?? '' })
  const result = await rendered
  assert(!result.failed && result.count > 0, 'Rendered availability page was empty or failed')
  return { elapsedMs: performance.now() - start, ...result, memory: memory() }
}

async function payloadBoundary() {
  const previous = config
  await configure({ database: 'stage9-byte-boundary.db', writeBatchSize: 8, maxObservationPayloadBytes: 1024 })
  await repo.clear()
  const scope = await repo.ensureScope(identity())
  let rejected = false
  try { await repo.commit(await repo.beginOperation(scope.scopeId), [observation('valid', 'm'), observation('界'.repeat(512), 'm')]) }
  catch (error) { rejected = String(error).includes('byte budget') }
  assert(rejected, 'Oversized UTF-8 observation was accepted')
  assert((await repo.queryHistory({ filter: {}, limit: 1 })).counts.total === 0, 'Oversized batch was partially written')
  await configure(previous)
  return { rejected: true, atomic: true, bytesNotCharacters: true }
}

async function prepareStartup() {
  const { initializeSettingsStorePersistence } = require('../src/bootstrap/settingsStorePersistence')
  const { useSettingsStore } = require('../src/store/settingsStore')
  const { flushPersistedSettings, loadPersistedSettings } = require('../src/presentation/features/settings/settingsStorePersistenceCommand')
  initializeSettingsStorePersistence()
  await useSettingsStore.getState().load()
  // This is the isolated fixture's own ordinary preference, not a changed default
  // or a production network/security bypass. The APK still has no INTERNET grant.
  useSettingsStore.getState().updateSettings({ autoUpdateCheckEnabled: false })
  await useSettingsStore.getState().rememberPreferredModel('stage9-provider-0', 'fixture-preferred-model')
  await flushPersistedSettings()
  const stored = await loadPersistedSettings()
  assert(stored?.autoUpdateCheckEnabled === false, 'Offline startup fixture setting did not persist')
  return { autoUpdateCheckEnabled: false, lastPreferredModel: stored.lastPreferredModel }
}

async function command(name: string, input: Input) {
  switch (name) {
    case 'configure': return configure(input)
    case 'seed': return seed(input)
    case 'queries': return queries(input)
    case 'pagination': return pagination()
    case 'storage': return { storage: await storage(), integrity: await integrity(), memory: memory(), lifecycle }
    case 'refresh': return measureRefresh(input)
    case 'cleanup': return cleanup()
    case 'show': return show(input)
    case 'hide': ui?.(undefined); await sleep(300); return memory()
    case 'frames-start': await native.startFrames(); return { memory: memory() }
    case 'frames-stop': return { native: await native.stopFrames(), memory: memory() }
    case 'arm': return arm(input)
    case 'recover': return recover(input)
    case 'probe': await probe(input.model); return { storage: await storage() }
    case 'payload-boundary': return payloadBoundary()
    case 'prepare-startup': return prepareStartup()
    default: throw new Error(`Unknown offline qualification command: ${name}`)
  }
}
async function loop() {
  let previous = ''
  save(statusFile, { state: 'ready', runId: native.runId, package: native.packageName, hermes: Boolean(global.HermesInternal), dev: __DEV__, memory: memory() })
  while (true) {
    if (commandFile.exists) {
      let input: Input | undefined
      try { input = JSON.parse(await commandFile.text()) } catch { /* Atomic host rename normally prevents partial input. */ }
      if (input && input.id !== previous && input.runId === native.runId) {
        previous = input.id
        try { save(resultFile, { id: input.id, name: input.name, value: await command(input.name, input.args ?? {}) }) }
        catch (error) { save(resultFile, { id: input.id, name: input.name, error: String(error), stack: error instanceof Error ? error.stack : undefined }) }
      }
    }
    await sleep(150)
  }
}

function TestRoot() {
  const [screen, setScreen] = useState<Input>()
  useEffect(() => { ui = setScreen; void loop(); return () => { ui = undefined } }, [])
  const { SafeAreaProvider } = require('react-native-safe-area-context')
  const { GestureHandlerRootView } = require('react-native-gesture-handler')
  const { IsleDialogProvider } = require('../src/components/ui/isle')
  const { ModelAvailabilityScreen } = require('../src/presentation/features/settings/ModelAvailabilityScreen')
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><IsleDialogProvider>
    <View style={{ flex: 1, backgroundColor: '#f8fafc', paddingTop: 32 }}>
      <Text style={{ color: '#111827', padding: 12 }}>IsleMind Stage 9 · isolated · offline fixtures</Text>
      {screen ? <ModelAvailabilityScreen key={screen.key} {...screen} getProviderTestModel={() => 'refresh-model-1'} />
        : <Text style={{ color: '#111827', padding: 12 }}>Controlled native qualification. No provider traffic.</Text>}
    </View>
  </IsleDialogProvider></SafeAreaProvider></GestureHandlerRootView>
}
function Root() {
  if (native.mode === 'app') {
    const { ExpoRoot } = require('expo-router')
    // @ts-expect-error Metro's require.context is intentionally not Node's require.
    const context = require.context('../app')
    return <ExpoRoot context={context} />
  }
  return <TestRoot />
}
require('../src/i18n').initI18n('en')
registerRootComponent(Root)
