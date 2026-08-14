const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_PERFORMANCE_FIXTURE_IDS,
  PROVIDER_PERFORMANCE_GUARD_SCHEMA,
  runProviderPerformanceGuardSelfTest,
} = require('../src/modules/providers/testing/providerPerformanceGuards.ts')
const { createProviderActivationPatchBuffer } = require('../src/modules/providers/providerActivationPatchBuffer.ts')
const providerModelAccess = require('../src/bootstrap/providerModelAccess.ts')
const providerSettingsList = require('../src/services/providerSettingsList.ts')
const providerActivationIssueSummary = require('../src/services/providerActivationIssueSummary.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderPerformanceGuardsHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isProviderPerformanceGuardsHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertSourceIncludes(relativePath, marker, label) {
  assert.ok(readSource(relativePath).includes(marker), label)
}

function assertSourceExcludes(relativePath, marker, label) {
  assert.equal(readSource(relativePath).includes(marker), false, label)
}

async function run() {
  const result = runProviderPerformanceGuardSelfTest({
    ...providerModelAccess,
    ...providerSettingsList,
    ...providerActivationIssueSummary,
  })
  assert.equal(result.schema, PROVIDER_PERFORMANCE_GUARD_SCHEMA, 'provider performance guard schema is versioned')
  assert.deepEqual(
    PROVIDER_PERFORMANCE_FIXTURE_IDS,
    [
      'batch-activation-progress-is-compacted',
      'provider-catalog-storage-is-pruned',
      'policy-model-lookup-is-bounded',
      'provider-settings-search-index-is-cached',
      'provider-settings-search-index-is-bounded',
      'provider-settings-policy-filter-stays-scoped',
      'provider-settings-policy-cache-is-lazy',
      'provider-settings-heavy-sort-rail-is-gated',
      'provider-settings-detail-mount-is-deferred',
      'batch-activation-provider-updates-are-coalesced',
      'specific-model-validation-checks-source',
      'diagnostics-heavy-provider-scan-is-bounded',
      'activation-failure-noise-is-grouped',
    ],
    'performance guards cover batch progress, catalog storage, lookup bounds, provider settings search indexing, bounded index size, scoped policy filtering, lazy policy cache, heavy sort rail gating, deferred detail mount, coalesced activation provider updates, source validation, diagnostics bounds, and grouped failure noise',
  )
  assert.equal(result.passed, true, `provider performance guard should pass: ${result.checks.filter((item) => !item.passed).map((item) => item.fixtureId).join(', ')}`)

  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'ACTIVATION_JOB_VISIBLE_ITEM_LIMIT', 'activation job compacts visible progress items')
  assertSourceIncludes('src/store/settingsStore.ts', 'compactProviderStorage', 'settings store exposes provider storage compaction')
  assertSourceIncludes('src/utils/providerModelStorage.ts', 'PROVIDER_REMOTE_MODEL_STORAGE_LIMIT', 'provider model storage limit is centralized')
  assertSourceIncludes('src/modules/providers/providerModelAccessPolicy.ts', 'providerHasAvailableSourceModel', 'specific policy validation checks model source availability')
  assertSourceIncludes('src/services/runtimeDiagnostics.ts', 'RUNTIME_DIAGNOSTICS_PROVIDER_HEAVY_LIMIT', 'runtime diagnostics caps heavy provider scans')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'RUNTIME_DIAGNOSTICS_DEBOUNCE_MS', 'provider settings debounces runtime diagnostics')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_MODEL_ENTRY_LIMIT', 'provider settings skips automatic diagnostics for imported catalogs')
  assertSourceIncludes('src/services/providerSettingsList.ts', 'buildProviderSettingsSearchIndex', 'provider settings caches normalized provider search text')
  assertSourceIncludes('src/services/providerSettingsList.ts', 'PROVIDER_SETTINGS_SEARCH_FIELD_SAMPLE_LIMIT', 'provider settings bounds normalized search-index field samples')
  assertSourceIncludes('src/services/providerSettingsList.ts', 'providerSourceModelMatchesFilter', 'provider settings keeps source-model fallback matching when bounded search index misses')
  assertSourceIncludes('src/services/providerSettingsList.ts', 'resolveProviderModelAliasAccess', 'provider settings source-model fallback keeps model policy scope')
  assertSourceExcludes('src/services/providerSettingsList.ts', '.flatMap((model) => [model.id, model.name])', 'provider settings search fallback avoids allocating full model-config value arrays')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'providerPolicyCacheRequired', 'provider settings avoids policy cache on default route mount')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'PROVIDER_MANUAL_SORT_RAIL_PROVIDER_LIMIT', 'provider settings gates drag rails on heavy imported lists')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'PROVIDER_DETAILS_DEFER_PROVIDER_LIMIT', 'provider settings defers heavy inline detail mount on imported lists')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'DeferredProviderDetails', 'provider settings renders expanded details through a deferring wrapper')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', '<ScrollView', 'provider settings uses a deterministic scroll layout for provider cards')
  assertSourceExcludes('src/components/providers/ProviderSettingsContent.tsx', 'FlashList', 'provider settings avoids virtualized row measurement gaps on provider cards')
  assertSourceIncludes('src/components/providers/ProviderCardGrid.tsx', 'aspectRatio: 1', 'provider settings uses stable square provider tiles')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'numberOfLines={2} ellipsizeMode="tail"', 'provider settings bounds provider names inside compact tiles')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', "persist: 'deferred'", 'provider import defers the heavy provider persistence flush after the UI recovers')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', "await publishImportProgress({ stage: 'parsing'", 'provider import starts the foreground-service notification before yielding to background')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', "AppState.addEventListener('change'", 'provider import paint yields resolve when Android backgrounds the app')
  assertSourceIncludes('src/store/settingsStore.ts', "AppState.addEventListener('change'", 'provider import batch store yields resolve when Android backgrounds the app')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'result.providers.length === 1 ? result.providers[0]?.id ?? null : null', 'provider import avoids opening inline details after large batch imports')
  assertSourceExcludes('src/components/providers/ProviderSettingsContent.tsx', 'expandedProviderId === null && index === 0 && !provider.enabled', 'provider settings does not auto-expand the first disabled row after batch imports')
  assertSourceIncludes('src/store/settingsStore.ts', 'persistProvidersSnapshot(updated, options?.persist)', 'settings store honors deferred persistence for batch provider imports')
  assertSourceIncludes('src/services/providerActivationIssueSummary.ts', 'summarizeProviderActivationIssueGroups', 'provider activation groups repeated failures')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'ActivationIssueGroupList', 'provider settings renders grouped activation issues')
  assertSourceIncludes('src/store/settingsStore.ts', 'updateProviderPatches', 'settings store can publish multiple provider patches in one update')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'createProviderActivationPatchBuffer', 'batch provider activation coalesces provider store writes')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', "from '@/modules/providers'", 'provider activation consumes the provider module public API')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'signal: abortController.signal', 'provider activation passes its exact cancellation signal to the patch buffer')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'await patchBuffer?.close()', 'provider activation awaits the final buffered persistence flush')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'patchBuffer?.dispose()', 'provider activation disposes its patch buffer lifecycle')
  assertSourceIncludes('src/modules/providers/providerActivationPatchBuffer.ts', 'enqueueCredentialGroupHealth', 'provider module coalesces credential group health into buffered patches')
  assertSourceIncludes('src/modules/providers/index.ts', "export * from './providerActivationPatchBuffer'", 'provider module publishes the activation patch buffer')
  const legacyPatchBufferPath = path.join(root, 'src', 'services', 'providerActivationPatchBuffer.ts')
  assert.equal(fs.existsSync(legacyPatchBufferPath), false, 'legacy provider activation patch buffer is deleted after cutover')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'hydrateProviderForActivation', 'batch provider activation hydrates against pending coalesced patches')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'ACTIVATION_PROVIDER_PATCH_FLUSH_LIMIT', 'batch provider activation has an explicit patch flush bound')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'foregroundService: true', 'batch provider activation publishes a foreground-service progress notification')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'await publishProviderActivationStatusNotification(initialActivationJob, t)', 'batch provider activation starts its foreground-service notification before network work')
  await assertActivationPatchBufferKeepsCredentialGroupHealth()
  await assertActivationPatchBufferSerializesFlushes()
  await assertActivationPatchBufferPreAbortPerformsNoIo()
  await assertActivationPatchBufferDropsQueuedWritesAfterAbort()
  await assertActivationPatchBufferChecksAbortAfterHydration()
  await assertActivationPatchBufferCapturesTimerFailureAndRecovers()

  console.log('Provider performance guard tests passed')
}

async function assertActivationPatchBufferKeepsCredentialGroupHealth() {
  let storeProvider = createProviderFixture('provider-1')
  const controller = new AbortController()
  const flushSignals = []
  const hydrationSignals = []
  const flushedBatches = []
  const buffer = createProviderActivationPatchBuffer({
    flushLimit: 99,
    flushMs: 60000,
    signal: controller.signal,
    hydrateProviderKey: async (id, signal) => {
      hydrationSignals.push(signal)
      return id === storeProvider.id ? storeProvider : null
    },
    flushPatches: async (patches, signal) => {
      flushSignals.push(signal)
      flushedBatches.push(patches)
      for (const patch of patches) {
        if (patch.id !== storeProvider.id) continue
        storeProvider = { ...storeProvider, ...patch.updates }
      }
    },
  })
  await buffer.enqueue(storeProvider.id, { lastTestStatus: 'ok' })
  await buffer.enqueue(storeProvider.id, {
    credentialGroups: [{
      id: 'group-1',
      label: 'Group 1',
      enabled: true,
      apiKey: 'secret',
      availableModels: ['model-a'],
      lastModelSyncStatus: 'ok',
      failureCount: 0,
    }],
  })
  await buffer.enqueueCredentialGroupHealth(storeProvider.id, 'group-1', false)
  await buffer.enqueue(storeProvider.id, { lastTestStatus: 'bad' })
  await buffer.close()
  assert.equal(flushedBatches.length, 1, 'activation patch buffer batches pending providers into one final flush')
  assert.equal(flushedBatches[0].length, 1, 'activation patch buffer merges writes for the same provider')
  assert.equal(flushSignals[0], controller.signal, 'activation patch buffer propagates the exact signal to persistence')
  assert.equal(hydrationSignals[0], controller.signal, 'activation patch buffer propagates the exact signal to hydration')
  assert.equal(storeProvider.lastTestStatus, 'bad', 'activation patch buffer keeps final test status')
  assert.deepEqual(storeProvider.credentialGroups[0].availableModels, ['model-a'], 'activation patch buffer keeps synced group models')
  assert.equal(storeProvider.credentialGroups[0].failureCount, 1, 'activation patch buffer keeps credential group failure count')
  assert.equal(typeof storeProvider.credentialGroups[0].lastFailureAt, 'number', 'activation patch buffer keeps credential group last failure timestamp')
  await assert.rejects(
    buffer.enqueue(storeProvider.id, { enabled: false }),
    /patch buffer is closed/,
    'closed activation patch buffer rejects new writes',
  )
  buffer.dispose()
}

async function assertActivationPatchBufferSerializesFlushes() {
  const firstFlush = deferred()
  const calls = []
  let activeFlushes = 0
  let maxActiveFlushes = 0
  const buffer = createProviderActivationPatchBuffer({
    flushLimit: 1,
    flushMs: 60000,
    hydrateProviderKey: async () => null,
    flushPatches: async (patches) => {
      activeFlushes += 1
      maxActiveFlushes = Math.max(maxActiveFlushes, activeFlushes)
      calls.push(patches.map((patch) => patch.id))
      if (calls.length === 1) await firstFlush.promise
      activeFlushes -= 1
    },
  })

  const first = buffer.enqueue('provider-1', { name: 'First' })
  assert.deepEqual(calls, [['provider-1']], 'first bounded activation flush starts immediately')
  const second = buffer.enqueue('provider-2', { name: 'Second' })
  firstFlush.resolve()
  await Promise.all([first, second])
  await buffer.close()

  assert.deepEqual(calls, [['provider-1'], ['provider-2']], 'activation patch flushes preserve enqueue order')
  assert.equal(maxActiveFlushes, 1, 'activation patch persistence remains serialized')
}

async function assertActivationPatchBufferPreAbortPerformsNoIo() {
  const controller = new AbortController()
  controller.abort(createAbortError('cancelled before activation'))
  let hydrateCalls = 0
  let flushCalls = 0
  const buffer = createProviderActivationPatchBuffer({
    flushLimit: 1,
    flushMs: 0,
    signal: controller.signal,
    hydrateProviderKey: async () => {
      hydrateCalls += 1
      return createProviderFixture('provider-1')
    },
    flushPatches: async () => {
      flushCalls += 1
    },
  })

  await assert.rejects(buffer.enqueue('provider-1', { enabled: false }), isAbortError, 'pre-aborted enqueue rejects')
  await assert.rejects(buffer.enqueueCredentialGroupHealth('provider-1', 'group-1', false), isAbortError, 'pre-aborted health hydration rejects')
  await assert.rejects(buffer.flush(), isAbortError, 'pre-aborted flush rejects')
  await assert.rejects(buffer.close(), isAbortError, 'pre-aborted close rejects')
  assert.equal(hydrateCalls, 0, 'pre-abort performs no hydration I/O')
  assert.equal(flushCalls, 0, 'pre-abort performs no persistence I/O')
  buffer.dispose()
}

async function assertActivationPatchBufferDropsQueuedWritesAfterAbort() {
  const controller = new AbortController()
  const runningFlush = deferred()
  const calls = []
  const committed = []
  const buffer = createProviderActivationPatchBuffer({
    flushLimit: 1,
    flushMs: 60000,
    signal: controller.signal,
    hydrateProviderKey: async () => null,
    flushPatches: async (patches, signal) => {
      calls.push({ ids: patches.map((patch) => patch.id), signal })
      if (calls.length === 1) await runningFlush.promise
      // This adapter intentionally ignores cancellation while its write is in
      // flight; queued writes must still never start after the abort.
      committed.push(...patches.map((patch) => patch.id))
    },
  })

  const first = buffer.enqueue('provider-1', { enabled: true })
  const queued = buffer.enqueue('provider-2', { enabled: true })
  controller.abort(createAbortError('cancelled during persistence'))
  runningFlush.resolve()
  const results = await Promise.allSettled([first, queued])

  assert.ok(results.every((result) => result.status === 'rejected' && isAbortError(result.reason)), 'in-flight callers observe activation cancellation')
  assert.deepEqual(calls.map((call) => call.ids), [['provider-1']], 'abort prevents queued persistence from starting')
  assert.equal(calls[0].signal, controller.signal, 'in-flight persistence receives the exact activation signal')
  assert.deepEqual(committed, ['provider-1'], 'already-running persistence may finish when its adapter cannot cancel')
  buffer.dispose()
}

async function assertActivationPatchBufferChecksAbortAfterHydration() {
  const controller = new AbortController()
  const hydration = deferred()
  let hydrationSignal
  let flushCalls = 0
  const buffer = createProviderActivationPatchBuffer({
    flushLimit: 1,
    flushMs: 0,
    signal: controller.signal,
    hydrateProviderKey: async (_id, signal) => {
      hydrationSignal = signal
      await hydration.promise
      return createProviderFixture('provider-1')
    },
    flushPatches: async () => {
      flushCalls += 1
    },
  })

  const healthUpdate = buffer.enqueueCredentialGroupHealth('provider-1', 'group-1', false)
  controller.abort(createAbortError('cancelled after hydration started'))
  hydration.resolve()
  await assert.rejects(healthUpdate, isAbortError, 'abort after hydration prevents health patch enqueue')
  assert.equal(hydrationSignal, controller.signal, 'health hydration receives the exact activation signal')
  assert.equal(flushCalls, 0, 'abort after hydration performs no persistence I/O')
  buffer.dispose()
}

async function assertActivationPatchBufferCapturesTimerFailureAndRecovers() {
  const timerFailure = new Error('timer persistence failed')
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  let attempts = 0
  let storeProvider = createProviderFixture('provider-1')
  const buffer = createProviderActivationPatchBuffer({
    flushLimit: 99,
    flushMs: 0,
    hydrateProviderKey: async () => storeProvider,
    flushPatches: async (patches) => {
      attempts += 1
      if (attempts === 1) throw timerFailure
      for (const patch of patches) {
        if (patch.id === storeProvider.id) storeProvider = { ...storeProvider, ...patch.updates }
      }
    },
  })

  try {
    await buffer.enqueue(storeProvider.id, { lastTestStatus: 'ok' })
    await buffer.enqueue(storeProvider.id, { lastTestStatus: 'bad' })
    await waitForTimerTurn()
    assert.equal(attempts, 1, 'timer starts one background persistence attempt')
    assert.deepEqual(unhandled, [], 'timer persistence rejection is captured')

    await assert.rejects(buffer.flush(), (error) => error === timerFailure, 'awaited flush surfaces the captured timer rejection')
    assert.equal(attempts, 1, 'surfacing a timer rejection does not silently retry it')
    await buffer.enqueue(storeProvider.id, { enabled: false })
    await buffer.close()
    await waitForTimerTurn()

    assert.equal(attempts, 2, 'a later close retries the preserved pending patches')
    assert.equal(storeProvider.lastTestStatus, 'bad', 'failed flush recovery preserves last-write-wins patches')
    assert.equal(storeProvider.enabled, false, 'failed flush recovery merges later patches without poisoning the queue')
    assert.deepEqual(unhandled, [], 'recovered timer failure never becomes an unhandled rejection')
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
    buffer.dispose()
  }
}

function createProviderFixture(id) {
  return {
    id,
    type: 'openai-compatible',
    name: `Provider ${id}`,
    enabled: true,
    apiKey: '',
    baseUrl: 'https://example.test/v1',
    models: [],
    modelConfigs: [],
    credentialGroups: [{
      id: 'group-1',
      label: 'Group 1',
      enabled: true,
      apiKey: 'secret',
      availableModels: [],
      failureCount: 0,
    }],
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createAbortError(message) {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError'
}

async function waitForTimerTurn() {
  await new Promise((resolve) => setTimeout(resolve, 10))
  await new Promise((resolve) => setImmediate(resolve))
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { run }
