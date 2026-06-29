const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const memoryStorage = new Map()

registerTypeScriptSupport()

const {
  PROVIDER_RUNTIME_HEALTH_VIEW_SCHEMA,
  providerRuntimeHealthRoute,
  recordProviderRuntimeFailure,
  recordProviderRuntimeRouteFailure,
  recordProviderRuntimeRouteSuccess,
  recordProviderRuntimeSuccess,
  resolveProviderRuntimeHealthView,
} = require('../src/services/ai/providerRuntimeHealth.ts')
const {
  PROVIDER_HEALTH_SNAPSHOT_VERSION,
  PROVIDER_HEALTH_STORAGE_KEY,
  loadProviderHealthSnapshot,
  normalizeProviderHealthSnapshot,
  saveProviderHealthRecords,
} = require('../src/services/ai/providerHealthStore.ts')
const { providerHealthKey } = require('../src/services/ai/providerHealth.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderRuntimeHealthCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === '@react-native-async-storage/async-storage') {
      return {
        __esModule: true,
        default: {
          getItem: async (key) => memoryStorage.get(key),
          setItem: async (key, value) => {
            memoryStorage.set(key, value)
          },
          removeItem: async (key) => {
            memoryStorage.delete(key)
          },
        },
      }
    }
    if (request === '@/services/attachmentContract') {
      return {
        filterSendableAttachments: (attachments) => Array.isArray(attachments) ? attachments.filter((item) => item?.sendable !== false) : [],
      }
    }
    return originalLoad.call(this, request, parent, isMain)
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
  hook.isProviderRuntimeHealthCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function createRequest(overrides = {}) {
  return {
    provider: {
      id: 'provider-health-main',
      type: 'openai-compatible',
      name: 'Provider Health Main',
      apiKey: 'sk-provider-health-secret',
      tokenPlanRegion: 'us-east-1',
    },
    model: 'model-health',
    structuredOutput: {
      type: 'json_schema',
      name: 'health_result',
      schema: { type: 'object' },
    },
    providerToolDeclarations: [{ name: 'lookup' }],
    webSearchMode: 'native',
    attachments: [
      { id: 'image-1', type: 'image', name: 'image.png', uri: 'file://image.png' },
      { id: 'file-1', type: 'pdf', name: 'report.pdf', uri: 'file://report.pdf' },
    ],
    ...overrides,
  }
}

function storedSnapshot() {
  const raw = memoryStorage.get(PROVIDER_HEALTH_STORAGE_KEY)
  return raw ? JSON.parse(raw) : undefined
}

async function run() {
  memoryStorage.clear()

  assert.equal(PROVIDER_RUNTIME_HEALTH_VIEW_SCHEMA, 'islemind.provider-runtime-health-view.v1', 'provider runtime health view schema is versioned')
  assert.equal(PROVIDER_HEALTH_SNAPSHOT_VERSION, 1, 'provider health snapshots keep a stable version')

  const route = providerRuntimeHealthRoute(createRequest(), 'group-primary')
  assert.equal(route.providerId, 'provider-health-main', 'runtime health route preserves provider id')
  assert.equal(route.model, 'model-health', 'runtime health route preserves model')
  assert.equal(route.credentialGroupId, 'group-primary', 'runtime health route preserves credential group')
  assert.equal(route.region, 'us-east-1', 'runtime health route preserves provider region')
  assert.deepEqual(route.capabilities.sort(), ['file', 'image', 'native_search', 'structured_output', 'text', 'tools'].sort(), 'runtime health route preserves fallback capability requirements')
  assert.equal(await resolveProviderRuntimeHealthView(route, 1000), undefined, 'missing runtime health records resolve to undefined')

  await recordProviderRuntimeSuccess({ req: createRequest(), credentialGroupId: 'group-primary', nowMs: 1000, latencyMs: 120 })
  let successView = await resolveProviderRuntimeHealthView(route, 1001)
  assert.equal(successView.schema, PROVIDER_RUNTIME_HEALTH_VIEW_SCHEMA, 'runtime health views expose the versioned schema')
  assert.equal(successView.status, 'healthy', 'runtime success records healthy state')
  assert.equal(successView.successes, 1, 'runtime success increments success count')
  assert.equal(successView.consecutiveFailures, 0, 'runtime success clears consecutive failures')
  assert.equal(successView.lastSuccessAtMs, 1000, 'runtime success records timestamp')
  assert.equal(storedSnapshot().records[0].averageLatencyMs, 120, 'runtime success records average latency')

  const rateLimitClassification = await recordProviderRuntimeFailure({
    req: createRequest(),
    credentialGroupId: 'group-primary',
    nowMs: 2000,
    latencyMs: 300,
    status: 429,
    responseText: 'rate limit quota exceeded',
  })
  assert.equal(rateLimitClassification.trigger, 'rate_limited', 'runtime failure classifies 429 quota responses as rate limited')
  const cooldownView = await resolveProviderRuntimeHealthView(route, 2001)
  assert.equal(cooldownView.status, 'cooldown', 'rate limits create active cooldown state')
  assert.equal(cooldownView.failures, 1, 'runtime failure increments failure count')
  assert.equal(cooldownView.consecutiveFailures, 1, 'runtime failure increments consecutive failures')
  assert.equal(cooldownView.cooldownUntilMs, 62000, '429 runtime failures use retry-after cooldown')
  assert.equal(cooldownView.lastFailureAtMs, 2000, 'runtime failure records timestamp')

  await recordProviderRuntimeRouteFailure(route, { nowMs: 3000, status: 500, errorMessage: 'upstream unavailable' })
  await recordProviderRuntimeRouteFailure(route, { nowMs: 4000, status: 500, errorMessage: 'upstream unavailable' })
  const circuitView = await resolveProviderRuntimeHealthView(route, 4001)
  assert.equal(circuitView.status, 'circuit-open', 'repeated runtime failures open the circuit')
  assert.equal(circuitView.consecutiveFailures, 3, 'circuit opening follows the failure threshold')
  assert.equal(circuitView.circuitOpenUntilMs, 64000, 'circuit-open view records finite expiry')
  const expiredCircuitView = await resolveProviderRuntimeHealthView(route, 65000)
  assert.equal(expiredCircuitView.status, 'degraded', 'expired cooldown and circuit states degrade instead of staying active')

  await recordProviderRuntimeRouteSuccess(route, { nowMs: 70000, latencyMs: 80 })
  successView = await resolveProviderRuntimeHealthView(route, 70001)
  assert.equal(successView.status, 'healthy', 'runtime success clears active circuit state')
  assert.equal(successView.consecutiveFailures, 0, 'runtime success resets consecutive failures after recovery')
  assert.equal(successView.cooldownUntilMs, undefined, 'runtime success clears cooldown expiry')
  assert.equal(successView.circuitOpenUntilMs, undefined, 'runtime success clears circuit expiry')
  assert.equal(storedSnapshot().records.some((record) => JSON.stringify(record).includes('sk-provider-health-secret')), false, 'runtime health snapshots omit provider secrets')

  await saveProviderHealthRecords([
    ...storedSnapshot().records,
    { providerId: 'provider-health-main', status: 'healthy', successes: 4, failures: 0, consecutiveFailures: 0, lastSuccessAtMs: 70002 },
  ], { nowMs: 70002 })
  const fallbackRoute = { providerId: 'provider-health-main', model: 'other-model', credentialGroupId: 'other-group', region: 'us-east-1' }
  assert.equal((await resolveProviderRuntimeHealthView(fallbackRoute, 70003)).status, 'healthy', 'runtime health lookup falls back from route-specific keys to provider-level records')
  assert.equal(providerHealthKey(route), 'provider-health-main|model-health|group-primary|us-east-1', 'provider health keys remain deterministic and scoped')

  const normalized = normalizeProviderHealthSnapshot({
    version: 999,
    updatedAtMs: 1,
    records: [
      { providerId: ' recent ', model: 'm', status: 'cooldown', successes: 2, failures: 3, consecutiveFailures: 1, lastFailureAtMs: 99 },
      { providerId: 'old', status: 'healthy', successes: 1, failures: 0, consecutiveFailures: 0, lastSuccessAtMs: 1 },
      { providerId: '', status: 'healthy' },
      { providerId: 'bad-status', status: 'not-real', successes: -4, failures: 2.8, consecutiveFailures: 1.2, lastSuccessAtMs: 98 },
    ],
  }, { nowMs: 100, maxAgeMs: 10, maxRecords: 2 })
  assert.equal(normalized.version, PROVIDER_HEALTH_SNAPSHOT_VERSION, 'snapshot normalization rewrites unknown versions')
  assert.deepEqual(normalized.records.map((record) => record.providerId), ['recent', 'bad-status'], 'snapshot normalization removes old and invalid records then applies max records')
  assert.equal(normalized.records[0].status, 'cooldown', 'snapshot normalization preserves known statuses')
  assert.equal(normalized.records[1].status, 'unknown', 'snapshot normalization downgrades unknown statuses')
  assert.equal(normalized.records[1].successes, 0, 'snapshot normalization clamps negative counters')
  assert.equal(normalized.records[1].failures, 2, 'snapshot normalization floors numeric counters')

  await saveProviderHealthRecords(normalized.records, { nowMs: 100 })
  assert.equal((await loadProviderHealthSnapshot({ nowMs: 100 })).records.length, 2, 'saved provider health snapshots round-trip through bounded storage')

  const providerRuntimeHealthSource = readSource('src/services/ai/providerRuntimeHealth.ts')
  assert.ok(providerRuntimeHealthSource.includes('PROVIDER_RUNTIME_HEALTH_VIEW_SCHEMA'), 'runtime health source declares the view schema')
  assert.ok(providerRuntimeHealthSource.includes('retryAfterMsFromFailure'), 'runtime health source applies retry-after cooldown policy')
  assert.ok(providerRuntimeHealthSource.includes('providerHealthActiveStatus'), 'runtime health source resolves active cooldown and circuit states')
  assert.ok(providerRuntimeHealthSource.includes('catch'), 'runtime health telemetry is isolated from provider execution failures')

  const providerHealthStoreSource = readSource('src/services/ai/providerHealthStore.ts')
  assert.ok(providerHealthStoreSource.includes('DEFAULT_MAX_RECORDS = 500'), 'provider health store caps record count')
  assert.ok(providerHealthStoreSource.includes('DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000'), 'provider health store caps record age')
  assert.ok(providerHealthStoreSource.includes('removeProviderHealthRecordsByProviderId'), 'provider health store supports provider-scoped cleanup')

  console.log('Provider runtime health compatibility tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
