const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load

registerTypeScriptSupport()

const {
  PROVIDER_FAILOVER_DECISION_SCHEMA,
  classifyProviderFailure,
  resolveFailoverDecision,
} = require('../src/services/ai/providerFailover.ts')
const {
  fallbackProvidersForRequest,
  providerForRuntimeFallback,
  requiredFallbackCapabilities,
  retryAfterMsFromFailure,
  routeForRuntimeFallback,
} = require('../src/services/ai/providerRuntimeFallback.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderFailoverCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  Module._load = function loadWithMocks(request, parent, isMain) {
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
  hook.isProviderFailoverCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function route(overrides = {}) {
  return {
    providerId: 'primary',
    model: 'strong-model',
    credentialGroupId: 'group-primary',
    family: 'openai',
    region: 'us',
    costTier: 'medium',
    capabilities: ['text', 'tools', 'structured_output'],
    ...overrides,
  }
}

function provider(overrides = {}) {
  return {
    id: 'primary',
    type: 'openai-compatible',
    name: 'Primary',
    enabled: true,
    apiKey: 'sk-primary-secret',
    models: ['strong-model'],
    manualModels: [],
    modelConfigs: [],
    tokenPlanRegion: 'us',
    credentialGroups: [
      { id: 'group-primary', label: 'Primary', apiKey: 'sk-group-primary', enabled: true, availableModels: ['strong-model'] },
    ],
    ...overrides,
  }
}

function assertNoSecret(value, label) {
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes('sk-primary-secret'), false, `${label} omits provider API key`)
  assert.equal(serialized.includes('sk-group-primary'), false, `${label} omits credential-group API key`)
  assert.equal(serialized.includes('sk-secondary-secret'), false, `${label} omits fallback API key`)
}

function run() {
  assert.equal(PROVIDER_FAILOVER_DECISION_SCHEMA, 'islemind.provider-failover-decision.v1', 'provider failover decision schema is versioned')

  const statusCases = [
    [408, 'timeout'],
    [401, 'credential_unhealthy'],
    [403, 'credential_unhealthy'],
    [404, 'model_unavailable'],
    [410, 'model_unavailable'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'overloaded'],
    [529, 'overloaded'],
    [400, 'payload_error'],
    [413, 'payload_error'],
    [422, 'payload_error'],
  ]
  for (const [status, trigger] of statusCases) {
    assert.equal(classifyProviderFailure({ status }).trigger, trigger, `HTTP ${status} maps to ${trigger}`)
  }
  assert.deepEqual(
    classifyProviderFailure({ streamStarted: true }),
    { trigger: 'stream_started', retryable: false, source: 'stream', evidence: { status: undefined, errorName: undefined, errorCode: undefined } },
    'stream-started failures are non-retryable',
  )
  assert.equal(classifyProviderFailure({ errorMessage: 'rate limit exceeded' }).trigger, 'rate_limited', 'rate-limit text is classified')
  assert.equal(classifyProviderFailure({ errorMessage: 'model does not exist' }).trigger, 'model_unavailable', 'model unavailability text is classified')
  assert.equal(classifyProviderFailure({ errorCode: 'ECONNRESET' }).trigger, 'network_error', 'network error codes are classified')
  assert.equal(classifyProviderFailure({ payloadRejected: true }).retryable, false, 'payload errors are not retryable')
  assert.equal(classifyProviderFailure({ safetyRefusal: true }).retryable, false, 'safety refusals are not retryable')

  const selectedDecision = resolveFailoverDecision({
    policy: { mode: 'capability-equivalent', preserveRegion: true, maxCostTier: 'medium' },
    trigger: 'rate_limited',
    original: route(),
    requiredCapabilities: ['text', 'tools'],
    candidates: [
      route({ providerId: 'primary', model: 'strong-model' }),
      route({ providerId: 'primary', model: 'backup-model', credentialGroupId: 'group-secondary', capabilities: ['text', 'tools'], healthScore: 20, costTier: 'medium' }),
      route({ providerId: 'other', model: 'other-model', credentialGroupId: 'group-other', capabilities: ['text', 'tools'], healthScore: 100, costTier: 'low' }),
      route({ providerId: 'cooldown', model: 'cooldown-model', cooldownActive: true }),
      route({ providerId: 'unhealthy', model: 'unhealthy-model', healthy: false }),
      route({ providerId: 'missing-capability', model: 'text-only', capabilities: ['text'] }),
      route({ providerId: 'eu-provider', model: 'eu-model', region: 'eu' }),
      route({ providerId: 'expensive', model: 'expensive-model', costTier: 'high' }),
    ],
  })
  assert.equal(selectedDecision.schema, PROVIDER_FAILOVER_DECISION_SCHEMA, 'failover decisions carry the versioned schema')
  assert.equal(selectedDecision.eligible, true, 'eligible failover decisions are selectable')
  assert.equal(selectedDecision.reason, 'selected', 'selected failover decisions record selected reason')
  assert.equal(selectedDecision.selected.providerId, 'primary', 'same-provider candidate is preferred before cross-provider candidates')
  assert.equal(selectedDecision.selected.model, 'backup-model', 'same-route candidate is rejected while same-provider backup can be selected')
  assert.ok(selectedDecision.rejectedCandidates.some((item) => item.reason === 'same_route'), 'same route is rejected')
  assert.ok(selectedDecision.rejectedCandidates.some((item) => item.reason === 'cooldown'), 'cooldown candidates are rejected')
  assert.ok(selectedDecision.rejectedCandidates.some((item) => item.reason === 'unhealthy'), 'unhealthy candidates are rejected')
  assert.ok(selectedDecision.rejectedCandidates.some((item) => item.reason === 'capability_mismatch'), 'capability mismatches are rejected')
  assert.ok(selectedDecision.rejectedCandidates.some((item) => item.reason === 'region_changed'), 'region changes are rejected when region preservation is enabled')
  assert.ok(selectedDecision.rejectedCandidates.some((item) => item.reason === 'cost_tier_exceeded'), 'cost-tier overages are rejected')
  assertNoSecret(selectedDecision, 'failover decision')

  const offDecision = resolveFailoverDecision({
    policy: { mode: 'off' },
    trigger: 'rate_limited',
    original: route(),
    candidates: [route({ providerId: 'primary', model: 'backup-model' })],
  })
  assert.equal(offDecision.eligible, false, 'policy-off failover decisions are blocked')
  assert.ok(offDecision.blockedReasons.includes('policy_off'), 'policy-off block reason is visible')

  const unknownTriggerDecision = resolveFailoverDecision({
    policy: { mode: 'same-provider' },
    trigger: 'payload_error',
    original: route(),
    candidates: [route({ providerId: 'primary', model: 'backup-model' })],
  })
  assert.ok(unknownTriggerDecision.blockedReasons.includes('trigger_not_allowed'), 'non-retryable triggers are blocked')

  const streamDecision = resolveFailoverDecision({
    policy: { mode: 'same-provider' },
    trigger: 'server_error',
    original: route(),
    streamStarted: true,
    candidates: [route({ providerId: 'primary', model: 'backup-model' })],
  })
  assert.ok(streamDecision.blockedReasons.includes('stream_already_started'), 'stream-started failover is blocked by default')

  const lockDecision = resolveFailoverDecision({
    policy: { mode: 'same-provider', explicitModelLock: true },
    trigger: 'server_error',
    original: route(),
    candidates: [route({ providerId: 'primary', model: 'backup-model' })],
  })
  assert.ok(lockDecision.blockedReasons.includes('explicit_model_lock'), 'explicit model locks block failover')

  const approvalDecision = resolveFailoverDecision({
    policy: { mode: 'ask-before-cross-provider' },
    trigger: 'rate_limited',
    original: route(),
    candidates: [route({ providerId: 'other', model: 'other-model' })],
  })
  assert.equal(approvalDecision.requiresUserConfirmation, true, 'cross-provider ask mode requires user confirmation')
  assert.equal(approvalDecision.reason, 'confirmation_required', 'cross-provider ask mode records confirmation requirement')
  assert.ok(approvalDecision.blockedReasons.includes('cross_provider_confirmation_required'), 'confirmation block reason is visible')

  const request = {
    provider: provider(),
    model: 'strong-model',
    fallbackProviders: [
      provider({ id: 'secondary', name: 'Secondary', apiKey: 'sk-secondary-secret', models: ['secondary-model'], credentialGroups: [{ id: 'secondary-group', label: 'Secondary', apiKey: 'sk-secondary-secret', enabled: true, availableModels: ['secondary-model'] }] }),
    ],
    reasoningEffort: 'high',
    providerToolDeclarations: [{ name: 'lookup' }],
    structuredOutput: { type: 'json_schema', name: 'result', schema: { type: 'object' } },
    webSearchMode: 'native',
    attachments: [
      { id: 'image', type: 'image', uri: 'file://image.png' },
      { id: 'pdf', type: 'pdf', uri: 'file://report.pdf' },
      { id: 'blocked', type: 'image', uri: 'file://blocked.png', sendable: false },
    ],
  }
  assert.deepEqual(
    requiredFallbackCapabilities(request).sort(),
    ['file', 'image', 'native_search', 'reasoning', 'structured_output', 'text', 'tools'].sort(),
    'runtime fallback capabilities include text, reasoning, tools, structured output, native search, and sendable attachment modalities',
  )
  assert.equal(retryAfterMsFromFailure(429), 60_000, 'rate-limited fallback uses a finite retry-after cooldown')
  assert.equal(retryAfterMsFromFailure(503), 20_000, 'server-error fallback uses a finite retry-after cooldown')
  assert.equal(retryAfterMsFromFailure(400), undefined, 'payload errors do not get retry-after cooldowns')
  assert.deepEqual(fallbackProvidersForRequest(request).map((item) => item.id), ['primary', 'secondary'], 'runtime fallback keeps the active provider ahead of configured fallback providers')
  const fallbackProvider = providerForRuntimeFallback(request, { providerId: 'secondary', model: 'secondary-model', credentialGroupId: 'secondary-group' })
  assert.equal(fallbackProvider.id, 'secondary', 'runtime fallback resolves selected provider')
  assert.equal(fallbackProvider.apiKey, 'sk-secondary-secret', 'runtime fallback uses selected credential group for execution only')
  const fallbackRoute = routeForRuntimeFallback(request, 'group-primary')
  assertNoSecret(fallbackRoute, 'runtime fallback route')

  const providerFailoverSource = readSource('src/services/ai/providerFailover.ts')
  assert.ok(providerFailoverSource.includes('PROVIDER_FAILOVER_DECISION_SCHEMA'), 'provider failover source declares the decision schema')
  assert.ok(providerFailoverSource.includes('ALLOWED_TRIGGERS'), 'provider failover source keeps a finite retryable-trigger set')
  assert.ok(providerFailoverSource.includes('stream_already_started'), 'provider failover source blocks unsafe stream-started failover')
  assert.ok(providerFailoverSource.includes('cross_provider_confirmation_required'), 'provider failover source preserves user confirmation for cross-provider ask mode')
  assert.ok(providerFailoverSource.includes('capability_mismatch'), 'provider failover source rejects capability mismatch')
  assert.ok(providerFailoverSource.includes('cost_tier_exceeded'), 'provider failover source enforces cost ceilings')

  const providerRuntimeFallbackSource = readSource('src/services/ai/providerRuntimeFallback.ts')
  assert.ok(providerRuntimeFallbackSource.includes('filterSendableAttachments'), 'runtime fallback capabilities ignore unsendable attachments')
  assert.ok(providerRuntimeFallbackSource.includes('retryAfterMsFromFailure'), 'runtime fallback has bounded retry-after policy')

  console.log('Provider failover compatibility tests passed')
}

if (require.main === module) {
  try {
    run()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

module.exports = { run }
