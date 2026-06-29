const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  PROVIDER_STATE_ISOLATION_COMPATIBILITY_EVAL_SCHEMA,
  PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURE_IDS,
  runProviderStateIsolationCompatibilityEvaluation,
} = require('../src/services/providerStateIsolationCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isProviderStateIsolationCompatibilityHook) return

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
  hook.isProviderStateIsolationCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertBaseline(item) {
  assert.equal(item.policy.docsMapped, true, `${item.fixtureId} maps docs`)
  assert.equal(item.policy.providerScoped, true, `${item.fixtureId} scopes provider state`)
  assert.equal(item.policy.modelScoped, true, `${item.fixtureId} scopes model state`)
  assert.equal(item.policy.conversationScoped, true, `${item.fixtureId} scopes conversation state`)
  assert.equal(item.policy.sessionScoped, true, `${item.fixtureId} scopes session state`)
  assert.equal(item.policy.credentialGroupScoped, true, `${item.fixtureId} scopes credential group state`)
  assert.ok(Number.isFinite(item.policy.ttlMs) && item.policy.ttlMs > 0, `${item.fixtureId} has finite TTL`)
  assert.equal(item.policy.expiryPruned, true, `${item.fixtureId} prunes expired state`)
  assert.ok(item.policy.maxBindings > 0, `${item.fixtureId} has binding cap`)
  assert.equal(item.policy.healthInvalidation, true, `${item.fixtureId} invalidates on health failures`)
  assert.equal(item.policy.sameProviderReplayOnly, true, `${item.fixtureId} only replays same-provider state`)
  assert.equal(item.policy.crossProviderReplayBlocked, true, `${item.fixtureId} blocks cross-provider replay`)
  assert.equal(item.policy.crossModelReplayBlocked, true, `${item.fixtureId} blocks cross-model replay`)
  assert.equal(item.policy.rawStateExported, false, `${item.fixtureId} does not export raw state`)
  assert.equal(item.policy.redactionApplied, true, `${item.fixtureId} redacts diagnostics`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} emits audit event`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} stays local/offline`)
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assertBaseline(item)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertDegraded(item) {
  assert.equal(item.readiness, 'degraded', `${item.fixtureId} is degraded`)
  assertBaseline(item)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no blocking failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertSourceIncludes(source, marker, label) {
  assert.ok(source.includes(marker), label)
}

function run() {
  assert.equal(
    PROVIDER_STATE_ISOLATION_COMPATIBILITY_EVAL_SCHEMA,
    'islemind.provider-state-isolation-compatibility-eval.v1',
    'provider state isolation schema is versioned',
  )
  assert.deepEqual(
    PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURE_IDS,
    [
      'session-affinity-key-provider-model-conversation',
      'credential-group-binding-ttl',
      'responses-previous-response-provider-scope',
      'compact-state-provider-model-scope',
      'provider-tool-replay-same-provider',
      'session-lease-provider-model-session-scope',
      'fallback-same-provider-state-policy',
      'diagnostics-redacted-state-events',
      'blocked-cross-provider-response-id-replay',
      'blocked-cross-model-cache-continuation',
      'blocked-stale-session-affinity-binding',
      'blocked-tool-replay-id-mismatch',
      'blocked-raw-state-export',
      'blocked-unbounded-session-state',
    ],
    'provider state isolation fixtures cover session affinity, responses state, compact state, tool replay, leases, fallback, diagnostics, and blocked paths',
  )

  const evaluation = runProviderStateIsolationCompatibilityEvaluation({ now: () => 2930000000000 })
  assert.equal(evaluation.schema, PROVIDER_STATE_ISOLATION_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `provider state isolation gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['session-affinity', 'responses-state', 'compact-state', 'tool-replay', 'session-lease', 'fallback', 'diagnostics', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }

  assertReady(diagnostic(evaluation, 'session-affinity-key-provider-model-conversation'))
  assertReady(diagnostic(evaluation, 'credential-group-binding-ttl'))

  const responses = diagnostic(evaluation, 'responses-previous-response-provider-scope')
  assertReady(responses)
  assert.equal(responses.policy.previousResponseIdProviderMatch, true, 'responses fixture scopes previous response id')

  const compact = diagnostic(evaluation, 'compact-state-provider-model-scope')
  assertReady(compact)
  assert.equal(compact.policy.compactStateProviderModelMatch, true, 'compact fixture scopes provider/model')

  const tools = diagnostic(evaluation, 'provider-tool-replay-same-provider')
  assertReady(tools)
  assert.equal(tools.policy.providerToolReplayIdMatch, true, 'tool fixture requires replay id match')

  assertReady(diagnostic(evaluation, 'session-lease-provider-model-session-scope'))
  assertReady(diagnostic(evaluation, 'diagnostics-redacted-state-events'))
  assertDegraded(diagnostic(evaluation, 'fallback-same-provider-state-policy'))

  assertBlocked(diagnostic(evaluation, 'blocked-cross-provider-response-id-replay'), [
    'missing-provider-scope',
    'missing-same-provider-policy',
    'cross-provider-state-replay',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-model-cache-continuation'), [
    'missing-model-scope',
    'cross-model-state-replay',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-stale-session-affinity-binding'), [
    'missing-ttl',
    'missing-expiry-prune',
    'missing-health-invalidation',
    'stale-session-binding',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-tool-replay-id-mismatch'), [
    'missing-same-provider-policy',
    'tool-replay-id-mismatch',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-raw-state-export'), [
    'raw-state-export',
    'missing-redaction',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-session-state'), [
    'missing-ttl',
    'missing-expiry-prune',
    'unbounded-session-state',
  ])

  const sessionAffinitySource = readSource('src/services/ai/providerSessionAffinity.ts')
  assertSourceIncludes(sessionAffinitySource, 'providerId,', 'session affinity key includes provider id')
  assertSourceIncludes(sessionAffinitySource, 'model,', 'session affinity key includes model')
  assertSourceIncludes(sessionAffinitySource, "conversationId ?? 'global'", 'session affinity key includes conversation id')
  assertSourceIncludes(sessionAffinitySource, "sessionId ?? 'default'", 'session affinity key includes session id')
  assertSourceIncludes(sessionAffinitySource, 'SESSION_AFFINITY_DEFAULT_TTL_MS', 'session affinity defines default TTL')
  assertSourceIncludes(sessionAffinitySource, 'SESSION_AFFINITY_MAX_BINDINGS', 'session affinity caps binding count')
  assertSourceIncludes(sessionAffinitySource, 'pruneSessionAffinityBindings', 'session affinity prunes expired bindings')
  assertSourceIncludes(sessionAffinitySource, 'provider_mismatch', 'session affinity rejects provider mismatch')
  assertSourceIncludes(sessionAffinitySource, 'model_mismatch', 'session affinity rejects model mismatch')
  assertSourceIncludes(sessionAffinitySource, 'credential_group_cooling_down', 'session affinity rejects cooling-down credentials')
  assertSourceIncludes(sessionAffinitySource, 'sessionAffinityFailureShouldInvalidate', 'session affinity invalidates quota and health failures')

  const compactStateSource = readSource('src/services/ai/compact/compactStateStore.ts')
  assertSourceIncludes(compactStateSource, 'WHERE conversationId = ? AND providerId = ? AND model = ?', 'compact state lookup scopes conversation provider and model')
  assertSourceIncludes(compactStateSource, "status = 'active'", 'compact state lookup requires active status')
  assertSourceIncludes(compactStateSource, 'expiresAt IS NULL OR expiresAt > ?', 'compact state lookup rejects expired rows')
  assertSourceIncludes(compactStateSource, 'invalidateCompactStatesByProvider', 'compact state can invalidate provider-scoped state')

  const remoteCompactSource = readSource('src/services/chatRemoteCompactUtils.ts')
  assertSourceIncludes(remoteCompactSource, 'providerId: input.record.providerId', 'remote compact state records provider id')
  assertSourceIncludes(remoteCompactSource, 'model: input.record.model', 'remote compact state records model')
  assertSourceIncludes(remoteCompactSource, 'previousResponseId: input.previousResponseId', 'remote compact state records previous response id')
  assertSourceIncludes(remoteCompactSource, 'contextFragmentIdentitiesJson', 'remote compact state records source fragment identity summary')

  const pipelineSource = readSource('src/services/ai/providerRuntimePipeline.ts')
  assertSourceIncludes(pipelineSource, 'sessionAffinityEnabled', 'runtime pipeline gates session affinity by settings')
  assertSourceIncludes(pipelineSource, 'deriveSessionAffinityKey', 'runtime pipeline derives session affinity keys')
  assertSourceIncludes(pipelineSource, 'chooseCredentialForModel', 'runtime pipeline chooses credential after affinity resolution')
  assertSourceIncludes(pipelineSource, 'provider.route.snapshot.created', 'runtime pipeline emits route snapshot audit event')
  assertSourceIncludes(pipelineSource, "strategy: 'runtime-log-redaction-v1'", 'route snapshot records redaction strategy')

  const executorSource = readSource('src/services/ai/providerRuntimeExecutor.ts')
  assertSourceIncludes(executorSource, "policy: { mode: 'same-provider' }", 'runtime fallback uses same-provider policy')
  assertSourceIncludes(executorSource, 'selectedProviderId !== input.req.provider.id', 'session affinity rotation rejects cross-provider fallback')
  assertSourceIncludes(executorSource, 'session.affinity.invalidated', 'runtime executor emits affinity invalidation event')
  assertSourceIncludes(executorSource, 'session.affinity.rotated', 'runtime executor emits affinity rotation event')
  assertSourceIncludes(executorSource, 'mergeOpenAIResponseReplayItems', 'runtime executor merges provider response replay items')
  assertSourceIncludes(executorSource, 'acquireSessionLease', 'runtime executor acquires scoped session lease')
  assertSourceIncludes(executorSource, 'provider.id}:${runtimeReq.model}:${effectiveReq.conversationId', 'session lease key includes provider model and conversation')

  const modelRoutingSource = readSource('src/services/modelRoutingCompatibilityEvaluation.ts')
  assertSourceIncludes(modelRoutingSource, 'blocked-cross-provider-state-replay', 'model routing gate blocks cross-provider state replay')

  console.log('Provider state isolation compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
