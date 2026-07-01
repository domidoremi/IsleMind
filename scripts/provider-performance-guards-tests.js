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
} = require('../src/services/providerPerformanceGuards.ts')
const { createProviderActivationPatchBuffer } = require('../src/services/providerActivationPatchBuffer.ts')

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

async function run() {
  const result = runProviderPerformanceGuardSelfTest()
  assert.equal(result.schema, PROVIDER_PERFORMANCE_GUARD_SCHEMA, 'provider performance guard schema is versioned')
  assert.deepEqual(
    PROVIDER_PERFORMANCE_FIXTURE_IDS,
    [
      'batch-activation-progress-is-compacted',
      'provider-catalog-storage-is-pruned',
      'policy-model-lookup-is-bounded',
      'provider-settings-search-index-is-cached',
      'provider-settings-policy-cache-is-lazy',
      'provider-settings-heavy-sort-rail-is-gated',
      'provider-settings-detail-mount-is-deferred',
      'batch-activation-provider-updates-are-coalesced',
      'specific-model-validation-checks-source',
      'diagnostics-heavy-provider-scan-is-bounded',
      'activation-failure-noise-is-grouped',
    ],
    'performance guards cover batch progress, catalog storage, lookup bounds, provider settings search indexing, lazy policy cache, heavy sort rail gating, deferred detail mount, coalesced activation provider updates, source validation, diagnostics bounds, and grouped failure noise',
  )
  assert.equal(result.passed, true, `provider performance guard should pass: ${result.checks.filter((item) => !item.passed).map((item) => item.fixtureId).join(', ')}`)

  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'ACTIVATION_JOB_VISIBLE_ITEM_LIMIT', 'activation job compacts visible progress items')
  assertSourceIncludes('src/store/settingsStore.ts', 'compactProviderStorage', 'settings store exposes provider storage compaction')
  assertSourceIncludes('src/utils/providerModelStorage.ts', 'PROVIDER_REMOTE_MODEL_STORAGE_LIMIT', 'provider model storage limit is centralized')
  assertSourceIncludes('src/services/ai/policy/providerModelAccess.ts', 'providerHasAvailableSourceModel', 'specific policy validation checks model source availability')
  assertSourceIncludes('src/services/runtimeDiagnostics.ts', 'RUNTIME_DIAGNOSTICS_PROVIDER_HEAVY_LIMIT', 'runtime diagnostics caps heavy provider scans')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'RUNTIME_DIAGNOSTICS_DEBOUNCE_MS', 'provider settings debounces runtime diagnostics')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_MODEL_ENTRY_LIMIT', 'provider settings skips automatic diagnostics for imported catalogs')
  assertSourceIncludes('src/services/providerSettingsList.ts', 'buildProviderSettingsSearchIndex', 'provider settings caches normalized provider search text')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'providerPolicyCacheRequired', 'provider settings avoids policy cache on default route mount')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'PROVIDER_MANUAL_SORT_RAIL_PROVIDER_LIMIT', 'provider settings gates drag rails on heavy imported lists')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'PROVIDER_DETAILS_DEFER_PROVIDER_LIMIT', 'provider settings defers heavy inline detail mount on imported lists')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'DeferredProviderDetails', 'provider settings renders expanded details through a deferring wrapper')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'drawDistance={PROVIDER_LIST_DRAW_DISTANCE}', 'provider settings limits offscreen list work')
  assertSourceIncludes('src/services/providerActivationIssueSummary.ts', 'summarizeProviderActivationIssueGroups', 'provider activation groups repeated failures')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'ActivationIssueGroupList', 'provider settings renders grouped activation issues')
  assertSourceIncludes('src/store/settingsStore.ts', 'updateProviderPatches', 'settings store can publish multiple provider patches in one update')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'createProviderActivationPatchBuffer', 'batch provider activation coalesces provider store writes')
  assertSourceIncludes('src/services/providerActivationPatchBuffer.ts', 'enqueueCredentialGroupHealth', 'batch provider activation coalesces credential group health into buffered patches')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'hydrateProviderForActivation', 'batch provider activation hydrates against pending coalesced patches')
  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'ACTIVATION_PROVIDER_PATCH_FLUSH_LIMIT', 'batch provider activation has an explicit patch flush bound')
  await assertActivationPatchBufferKeepsCredentialGroupHealth()

  console.log('Provider performance guard tests passed')
}

async function assertActivationPatchBufferKeepsCredentialGroupHealth() {
  let storeProvider = {
    id: 'provider-1',
    type: 'openai-compatible',
    name: 'Provider 1',
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
  const buffer = createProviderActivationPatchBuffer({
    flushLimit: 99,
    flushMs: 60000,
    hydrateProviderKey: async (id) => id === storeProvider.id ? storeProvider : null,
    flushPatches: async (patches) => {
      for (const patch of patches) {
        if (patch.id !== storeProvider.id) continue
        storeProvider = { ...storeProvider, ...patch.updates }
      }
    },
  })
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
  await buffer.flush()
  assert.equal(storeProvider.lastTestStatus, 'bad', 'activation patch buffer keeps final test status')
  assert.deepEqual(storeProvider.credentialGroups[0].availableModels, ['model-a'], 'activation patch buffer keeps synced group models')
  assert.equal(storeProvider.credentialGroups[0].failureCount, 1, 'activation patch buffer keeps credential group failure count')
  assert.equal(typeof storeProvider.credentialGroups[0].lastFailureAt, 'number', 'activation patch buffer keeps credential group last failure timestamp')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { run }
