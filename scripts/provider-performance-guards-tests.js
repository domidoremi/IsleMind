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

function run() {
  const result = runProviderPerformanceGuardSelfTest()
  assert.equal(result.schema, PROVIDER_PERFORMANCE_GUARD_SCHEMA, 'provider performance guard schema is versioned')
  assert.deepEqual(
    PROVIDER_PERFORMANCE_FIXTURE_IDS,
    [
      'batch-activation-progress-is-compacted',
      'provider-catalog-storage-is-pruned',
      'policy-model-lookup-is-bounded',
      'specific-model-validation-checks-source',
      'diagnostics-heavy-provider-scan-is-bounded',
    ],
    'performance guards cover batch progress, catalog storage, lookup bounds, source validation, and diagnostics bounds',
  )
  assert.equal(result.passed, true, `provider performance guard should pass: ${result.checks.filter((item) => !item.passed).map((item) => item.fixtureId).join(', ')}`)

  assertSourceIncludes('src/components/providers/useProviderActivationJob.ts', 'ACTIVATION_JOB_VISIBLE_ITEM_LIMIT', 'activation job compacts visible progress items')
  assertSourceIncludes('src/store/settingsStore.ts', 'compactProviderStorage', 'settings store exposes provider storage compaction')
  assertSourceIncludes('src/utils/providerModelStorage.ts', 'PROVIDER_REMOTE_MODEL_STORAGE_LIMIT', 'provider model storage limit is centralized')
  assertSourceIncludes('src/services/ai/policy/providerModelAccess.ts', 'providerHasAvailableSourceModel', 'specific policy validation checks model source availability')
  assertSourceIncludes('src/services/runtimeDiagnostics.ts', 'RUNTIME_DIAGNOSTICS_PROVIDER_HEAVY_LIMIT', 'runtime diagnostics caps heavy provider scans')
  assertSourceIncludes('src/components/providers/ProviderSettingsContent.tsx', 'RUNTIME_DIAGNOSTICS_DEBOUNCE_MS', 'provider settings debounces runtime diagnostics')

  console.log('Provider performance guard tests passed')
}

if (require.main === module) run()

module.exports = { run }
