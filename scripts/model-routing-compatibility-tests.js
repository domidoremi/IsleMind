const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  MODEL_ROUTING_COMPATIBILITY_EVAL_SCHEMA,
  MODEL_ROUTING_COMPATIBILITY_FIXTURE_IDS,
  runModelRoutingCompatibilityEvaluation,
} = require('../src/services/modelRoutingCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isModelRoutingCompatibilityHook) return

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
  hook.isModelRoutingCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item, capabilities) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.policy.capabilityEvidence, true, `${item.fixtureId} has capability evidence`)
  assert.equal(item.policy.modelMetadataFresh, true, `${item.fixtureId} has fresh model metadata`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} emits audit event`)
  assert.equal(item.policy.estimatedCostUsd <= item.policy.maxCostUsd, true, `${item.fixtureId} stays within cost budget`)
  assert.equal(item.policy.estimatedLatencyMs <= item.policy.maxLatencyMs, true, `${item.fixtureId} stays within latency budget`)
  assert.deepEqual(item.missingCapabilities, [], `${item.fixtureId} has no missing capabilities`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
  for (const capability of capabilities) {
    assert.ok(item.policy.selectedCapabilities.includes(capability), `${item.fixtureId} selects ${capability}`)
  }
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(MODEL_ROUTING_COMPATIBILITY_EVAL_SCHEMA, 'islemind.model-routing-compatibility-eval.v1', 'model routing schema is versioned')
  assert.deepEqual(
    MODEL_ROUTING_COMPATIBILITY_FIXTURE_IDS,
    [
      'cheap-intent-classifier-small-model',
      'privacy-local-embedding-route',
      'reasoning-upgrade-route',
      'vision-capability-route',
      'structured-output-model-gated-route',
      'tool-capable-agent-route',
      'fallback-with-visible-downgrade',
      'blocked-unsupported-capability-downgrade',
      'blocked-private-data-cloud-route',
      'blocked-budget-overrun-route',
      'blocked-cross-provider-state-replay',
    ],
    'model routing fixtures cover cheap, local, strong, vision, tool, fallback, and blocked paths'
  )

  const evaluation = runModelRoutingCompatibilityEvaluation({ now: () => 2400000000000 })
  assert.equal(evaluation.schema, MODEL_ROUTING_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, MODEL_ROUTING_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `model routing gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)
  for (const reason of ['cost', 'latency', 'privacy', 'capability', 'reasoning', 'multimodal', 'structured-output', 'tools', 'fallback']) {
    assert.ok(evaluation.qualityGate.requiredDecisionReasons.includes(reason), `quality gate tracks ${reason}`)
  }

  assertReady(diagnostic(evaluation, 'cheap-intent-classifier-small-model'), ['text', 'intent-classification'])
  assertReady(diagnostic(evaluation, 'privacy-local-embedding-route'), ['embedding', 'local-only'])
  assertReady(diagnostic(evaluation, 'reasoning-upgrade-route'), ['text', 'reasoning'])
  assertReady(diagnostic(evaluation, 'vision-capability-route'), ['text', 'vision'])
  assertReady(diagnostic(evaluation, 'structured-output-model-gated-route'), ['text', 'structured-output'])
  assertReady(diagnostic(evaluation, 'tool-capable-agent-route'), ['text', 'tools', 'provider-tool-replay'])

  const visibleFallback = diagnostic(evaluation, 'fallback-with-visible-downgrade')
  assert.equal(visibleFallback.readiness, 'degraded', 'visible fallback is degraded, not blocked')
  assert.equal(visibleFallback.policy.fallbackVisible, true, 'visible fallback records user-visible downgrade')
  assert.equal(visibleFallback.policy.auditEvent, true, 'visible fallback emits audit event')

  assertBlocked(diagnostic(evaluation, 'blocked-unsupported-capability-downgrade'), ['unsupported-capability-downgrade'])
  assertBlocked(diagnostic(evaluation, 'blocked-private-data-cloud-route'), [
    'privacy-cloud-route-blocked',
    'missing-redaction',
    'unsupported-capability-downgrade',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-budget-overrun-route'), [
    'cost-budget-exceeded',
    'latency-budget-exceeded',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-provider-state-replay'), [
    'unsafe-state-replay',
    'cache-continuation-mismatch',
    'tool-replay-mismatch',
  ])

  console.log('Model routing compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
