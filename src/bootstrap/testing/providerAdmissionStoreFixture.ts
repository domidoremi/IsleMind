import type { AIProvider } from '@/types/providerContracts'
import type { SqliteDatabase, SqliteDatabaseProvider, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { ProviderExecutionTarget, ProviderRuntimeChatRequest } from '@/modules/providers'
import type { HttpSseExecutionInput, ProviderRuntimeChatExecutionInput } from '../providerRuntimeExecutor'

export function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export async function flushAdmissionMicrotasks() {
  for (let index = 0; index < 160; index++) await Promise.resolve()
}

function createHostPorts() {
  const { DatabaseSync } = require('node:sqlite')
  const native = new DatabaseSync(':memory:')
  const values = new Map<string, string>()
  const events: string[] = []
  const hooks: {
    beforeSql?: (sql: string, values: readonly SqliteValue[]) => Promise<void>
    beforeSecureRead?: (key: string) => Promise<void>
    beforeHealthRead?: (key: string) => Promise<void>
    beforeHealthWrite?: (key: string, value: string) => Promise<void>
  } = {}
  const executor: SqliteExecutor = {
    async exec(sql) {
      await hooks.beforeSql?.(sql, [])
      native.exec(sql)
    },
    async run(sql, parameters = []) {
      await hooks.beforeSql?.(sql, parameters)
      const result = native.prepare(sql).run(...parameters)
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst<Row extends object>(sql: string, parameters: readonly SqliteValue[] = []) {
      await hooks.beforeSql?.(sql, parameters)
      return (native.prepare(sql).get(...parameters) ?? null) as Row | null
    },
    async getAll<Row extends object>(sql: string, parameters: readonly SqliteValue[] = []) {
      await hooks.beforeSql?.(sql, parameters)
      return native.prepare(sql).all(...parameters) as Row[]
    },
  }
  let tail = Promise.resolve()
  function enqueue<Value>(work: () => Promise<Value>) {
    const result = tail.then(work, work)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  const database: SqliteDatabase = {
    exec: sql => enqueue(() => executor.exec(sql)),
    run: (sql, parameters) => enqueue(() => executor.run(sql, parameters)),
    getFirst: (sql, parameters) => enqueue(() => executor.getFirst(sql, parameters)),
    getAll: (sql, parameters) => enqueue(() => executor.getAll(sql, parameters)),
    transaction: work => enqueue(async () => {
      native.exec('BEGIN IMMEDIATE')
      try {
        const result = await work(executor)
        native.exec('COMMIT')
        return result
      } catch (error) {
        native.exec('ROLLBACK')
        throw error
      }
    }),
  }
  const provider: SqliteDatabaseProvider = { get: async () => database }
  const secureStorage = {
    async getItem(key: string) {
      events.push('secure-read')
      await hooks.beforeSecureRead?.(key)
      return values.get(key) ?? null
    },
    async setItem(key: string, value: string) { events.push('secure-write'); values.set(key, value) },
    async removeItem(key: string) { events.push('secure-delete'); values.delete(key) },
  }
  return { native, provider, secureStorage, values, hooks, events, idle: () => tail }
}

/** Real bootstrap/store/SQL/credential owners; only platform and external effects are replaced. */
export async function loadProviderAdmissionStoreFixture() {
  jest.resetModules()
  const host = createHostPorts()
  const network = { online: true }
  const effects = {
    usage: jest.fn(async () => undefined),
    log: jest.fn(async () => undefined),
    event: jest.fn(),
    streamWire: jest.fn(),
    fallbackWire: jest.fn(),
  }
  jest.doMock('@/platform/storage', () => ({
    ...jest.requireActual('@/platform/storage'),
    createExpoSqliteDatabaseProvider: () => host.provider,
  }))
  jest.doMock('@/platform/secureStorage', () => ({
    createExpoSecureKeyValueStoragePort: () => host.secureStorage,
  }))
  jest.doMock('expo-network', () => ({
    getNetworkStateAsync: async () => ({ isConnected: network.online, isInternetReachable: network.online }),
  }))
  jest.doMock('../assistantExecutionHostRuntime', () => ({
    assistantExecutionHost: { assertAdmission: jest.fn(), executionStarted: jest.fn(), persisted: jest.fn() },
  }))
  jest.doMock('../providerCompactStateRepository', () => ({
    invalidateAllCompactStates: jest.fn(async () => undefined),
    invalidateCompactStatesByProvider: jest.fn(async () => undefined),
  }))
  jest.doMock('../providerRemoteCompactLifecycle', () => ({
    providerRemoteCompactLifecycle: { getCompactionGuardState: () => ({ autoDisabled: false }) },
  }))
  jest.doMock('../usageStatisticsRuntime', () => ({ recordProviderUsageAttempt: effects.usage }))
  jest.doMock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: effects.log }))
  jest.doMock('@/services/runtimeEvents', () => ({ emitRuntimeEvent: effects.event }))
  const providers = require('@/modules/providers') as typeof import('@/modules/providers')
  const routes = providers.createProviderRouteAssemblyPolicy({
    compatibilityCapabilityCanBeSent: providers.providerCompatibilityCapabilityCanBeSentForProvider,
  })
  const transport = {
    assembleRoute: routes.assemble, resolveEndpoint: routes.resolveEndpoint,
    endpointHost: () => 'example.invalid', toWebSocketUrl: (url: string) => url.replace('https:', 'wss:'),
    requestStream: effects.streamWire, request: effects.fallbackWire,
    readResponseText: (response: Response) => response.text(),
  }
  jest.doMock('../providerTransport', () => ({ providerTransport: transport }))
  const healthValues = new Map<string, string>()
  const healthRepository = providers.createProviderHealthRepository({
    getItem: async key => {
      await host.hooks.beforeHealthRead?.(key)
      return healthValues.get(key) ?? null
    },
    setItem: async (key, value) => {
      await host.hooks.beforeHealthWrite?.(key, value)
      healthValues.set(key, value)
    },
    removeItem: async key => { healthValues.delete(key) },
  })
  jest.doMock('../providerHealthRepository', () => ({
    providerHealthRepository: healthRepository,
    loadProviderHealthSnapshot: healthRepository.load,
    removeProviderHealthRecordsByProviderId: healthRepository.removeByProviderId,
    clearProviderHealthSnapshot: healthRepository.clear,
  }))
  const settingsPersistence = require('@/presentation/features/settings/settingsStorePersistenceCommand') as
    typeof import('@/presentation/features/settings/settingsStorePersistenceCommand')
  const saveProviders = jest.fn(async (_value: readonly AIProvider[]) => undefined)
  const saveSettings = jest.fn(async () => undefined)
  const persistence: SettingsStorePersistence = {
    providers: { load: async () => [], save: saveProviders },
    settings: { load: async () => null, save: saveSettings },
  }
  settingsPersistence.bindSettingsStorePersistence(persistence)
  const { useSettingsStore } = require('@/store/settingsStore') as typeof import('@/store/settingsStore')
  const availability = require('../providerModelAvailabilityRuntime') as typeof import('../providerModelAvailabilityRuntime')
  const resolution = require('../providerChatResolutionRuntime') as typeof import('../providerChatResolutionRuntime')
  const executor = require('../providerRuntimeExecutor') as typeof import('../providerRuntimeExecutor')
  const { assistantRunBudgetStore } = require('../assistantRunGovernance') as typeof import('../assistantRunGovernance')
  const { executionResources } = require('../executionResources') as typeof import('../executionResources')
  const health = require('../providerRuntimeHealth') as typeof import('../providerRuntimeHealth')
  const requestBinding = require('../providerRequestBinding') as typeof import('../providerRequestBinding')
  const { buildProviderFallbackCandidates } = require('../providerFallbackCandidates') as typeof import('../providerFallbackCandidates')
  const streamRuntime = require('../providerRuntime') as typeof import('../providerRuntime')
  const initial = useSettingsStore.getState()
  useSettingsStore.setState({ settings: { ...initial.settings, defaultProvider: 'fixture-provider',
    upstreamMaxRetries: 3, upstreamCircuitBreakerEnabled: false, transportMode: 'http',
    modelAllowlist: [], modelBlocklist: [], providerAllowlist: [], providerBlocklist: [] }, providers: [] })
  return {
    ...host, network, effects, providers, health, healthRepository,
    captureEvidence: availability.captureProviderModelDispatchEvidence,
    captureHealth: health.captureProviderRuntimeHealthDispatch,
    useSettingsStore, availability: availability.providerModelAvailabilityRuntime,
    resolution: resolution.providerChatResolutionRuntime, executor, streamRuntime, assistantRunBudgetStore,
    executionResources, requestBinding, buildProviderFallbackCandidates,
    saveProviders, saveSettings,
    async close() {
      host.hooks.beforeSql = undefined
      host.hooks.beforeSecureRead = undefined
      host.hooks.beforeHealthRead = undefined
      host.hooks.beforeHealthWrite = undefined
      await useSettingsStore.getState().flushProviderPersistence()
      await settingsPersistence.flushPersistedSettings()
      await host.idle()
      settingsPersistence.releaseSettingsStorePersistence(persistence)
      host.native.close()
    },
  }
}

export type ProviderAdmissionStoreFixture = Awaited<ReturnType<typeof loadProviderAdmissionStoreFixture>>

export async function prepareStoreExecution(
  fixture: ProviderAdmissionStoreFixture,
  credential: 'primary' | 'group' = 'primary',
) {
  const store = fixture.useSettingsStore
  await store.getState().addProvider({
    id: 'fixture-provider', name: 'Reviewed provider', type: 'openai',
    baseUrl: 'https://example.invalid/v1', enabled: true, apiKey: '', models: ['gpt-4o'],
    lastModelSyncStatus: 'ok',
    ...(credential === 'group' ? { credentialGroups: [{
      id: 'default', label: 'Real default group', enabled: true, apiKey: '',
      availableModels: ['gpt-4o'], source: { kind: 'group' as const, groupId: 'default' },
    }] } : {}),
  })
  await store.getState().setProviderApiKey('fixture-provider', 'synthetic-primary-key')
  if (credential === 'group') {
    await store.getState().setProviderCredentialGroupKey('fixture-provider', 'default', 'synthetic-group-key')
  }
  const controller = new AbortController()
  const catalog = fixture.providers.snapshotProviderConfiguration(store.getState().providers)
  const admission = await fixture.resolution.resolvePreferred({
    preferred: { providerId: 'fixture-provider', model: 'gpt-4o' }, signal: controller.signal,
    providers: catalog, settings: store.getState().settings, allowFallback: false,
    ...(credential === 'group' ? { targetCredentialGroupId: 'default' } : {}),
  })
  if (admission.kind !== 'ready') throw new Error(`Fixture admission failed: ${admission.kind}`)
  const targets: ProviderExecutionTarget[] = []
  const observer = jest.fn(async (target: ProviderExecutionTarget) => { targets.push(target) })
  const req: ProviderRuntimeChatRequest = {
    provider: admission.selection.provider, model: admission.selection.model,
    requestedModel: 'gpt-4o', messages: [{ role: 'user', content: 'fixture request' }],
    generationParameterSources: { maxTokens: 'explicit' }, maxTokens: 100,
    settings: { ...store.getState().settings }, signal: controller.signal,
    executionConstraint: admission.selection.constraint, fallbackProviders: [admission.selection.provider],
    ...(credential === 'group' ? { targetCredentialGroupId: 'default' } : {}),
    onExecutionTarget: observer,
  }
  const wire = fixture.effects.streamWire.mockImplementation(async (_url: string, _options: RequestInit, _timeout: number) =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'fixture answer' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }), { status: 200 }))
  const fallbackWire = fixture.effects.fallbackWire.mockImplementation(async (_url: string, _options: RequestInit, _timeout: number) =>
    new Response('fallback must not be admitted', { status: 503 }))
  const routes = fixture.providers.createProviderRouteAssemblyPolicy({
    compatibilityCapabilityCanBeSent: fixture.providers.providerCompatibilityCapabilityCanBeSentForProvider,
  })
  const input: HttpSseExecutionInput = {
    req, controller, stream: false, url: 'https://example.invalid/v1/chat/completions',
    headers: { Authorization: `Bearer ${req.provider.apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o', messages: req.messages, max_tokens: 100 }),
    ...(credential === 'group' ? { credentialGroupId: 'default' } : {}),
    resolveRoute: fixture.requestBinding.providerRequestSerializer.serialize,
    buildFallbackCandidates: fixture.buildProviderFallbackCandidates,
    onChunk: jest.fn(), onDone: jest.fn(), onError: jest.fn(),
    transport: {
      assembleRoute: routes.assemble, resolveEndpoint: routes.resolveEndpoint,
      endpointHost: () => 'example.invalid', toWebSocketUrl: url => url.replace('https:', 'wss:'),
      requestStream: wire, request: fallbackWire, readResponseText: response => response.text(),
    },
    fallbackEffects: {
      logDecision: jest.fn(async () => undefined), recordRouteFailure: jest.fn(async () => undefined),
      recordRouteSuccess: jest.fn(async () => undefined),
    },
  }
  return { req, controller, catalog, targets, observer, wire, fallbackWire, input }
}

export function asSocketExecution(execution: Awaited<ReturnType<typeof prepareStoreExecution>>) {
  const run = jest.fn(async (_input: unknown) => undefined)
  const input = {
    ...execution.input,
    pipeline: {
      runtimeReq: execution.req, effectiveReq: execution.req, stream: true,
      transportSelection: { transport: 'responses_websocket' },
      headers: execution.input.headers,
      rawBody: { input: [{ role: 'user', content: 'fixture request' }], max_output_tokens: 100, stream: true },
      proxyPolicy: { effectiveUrl: 'https://example.invalid/v1/responses' },
      preparedHttpRequest: { url: execution.input.url, headers: execution.input.headers, body: execution.input.body },
      credentialGroupId: execution.input.credentialGroupId,
    },
    responsesWebSocketTransport: { run },
  } as unknown as ProviderRuntimeChatExecutionInput
  return { input, run }
}
