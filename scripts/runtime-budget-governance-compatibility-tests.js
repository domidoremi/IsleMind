const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA,
  RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS,
  runRuntimeBudgetGovernanceCompatibilityEvaluation,
} = require('../src/services/runtimeBudgetGovernanceCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isRuntimeBudgetGovernanceCompatibilityHook) return

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
  hook.isRuntimeBudgetGovernanceCompatibilityHook = true
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
  assert.ok(item.policy.inputTokenBudget > 0, `${item.fixtureId} has input token budget`)
  assert.ok(item.policy.outputTokenBudget > 0, `${item.fixtureId} has output token budget`)
  assert.ok(item.policy.costBudgetUsd > 0, `${item.fixtureId} has cost budget`)
  assert.ok(item.policy.latencyBudgetMs > 0, `${item.fixtureId} has latency budget`)
  assert.ok(item.policy.timeoutMs > 0, `${item.fixtureId} has timeout`)
  assert.ok(item.policy.retryLimit >= 0, `${item.fixtureId} has retry limit`)
  assert.equal(item.policy.circuitBreaker, true, `${item.fixtureId} has circuit breaker`)
  assert.ok(item.policy.streamIdleTimeoutMs > 0, `${item.fixtureId} has stream idle timeout`)
  assert.equal(item.policy.cancellationPropagated, true, `${item.fixtureId} propagates cancellation`)
  assert.equal(item.policy.fallbackBudgetPolicy, 'preserve-or-reduce', `${item.fixtureId} preserves or reduces fallback budgets`)
  assert.equal(item.policy.fallbackVisible, true, `${item.fixtureId} exposes fallback`)
  assert.ok(item.policy.maxToolCalls > 0, `${item.fixtureId} has tool-loop limit`)
  assert.ok(item.policy.localMemoryBudgetMb > 0, `${item.fixtureId} has local memory budget`)
  assert.equal(item.policy.thermalPolicy, true, `${item.fixtureId} has thermal policy`)
  assert.equal(item.policy.budgetLedger, true, `${item.fixtureId} records budget ledger`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} records audit event`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} stays local/offline`)
  assert.ok(item.policy.estimatedInputTokens <= item.policy.inputTokenBudget, `${item.fixtureId} input tokens are within budget`)
  assert.ok(item.policy.estimatedOutputTokens <= item.policy.outputTokenBudget, `${item.fixtureId} output tokens are within budget`)
  assert.ok(item.policy.estimatedCostUsd <= item.policy.costBudgetUsd, `${item.fixtureId} estimated cost is within budget`)
  assert.ok(item.policy.observedLatencyMs <= item.policy.latencyBudgetMs, `${item.fixtureId} observed latency is within budget`)
  assert.ok(item.policy.estimatedLocalMemoryMb <= item.policy.localMemoryBudgetMb, `${item.fixtureId} local memory is within budget`)
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

function run() {
  assert.equal(
    RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA,
    'islemind.runtime-budget-governance-compatibility-eval.v1',
    'runtime budget governance schema is versioned',
  )
  assert.deepEqual(
    RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS,
    [
      'token-budget-normalization',
      'cost-budget-ceiling',
      'latency-timeout-policy',
      'retry-and-circuit-breaker-policy',
      'streaming-idle-timeout',
      'cancellation-propagation',
      'visible-fallback-with-budget-preservation',
      'local-inference-resource-budget',
      'tool-loop-budget-boundary',
      'observability-budget-accounting',
      'blocked-unbounded-retries',
      'blocked-missing-timeout',
      'blocked-fallback-budget-escalation',
      'blocked-no-cancellation',
      'blocked-unmetered-tool-loop',
      'blocked-unbounded-local-resource-use',
    ],
    'runtime budget fixtures cover token, cost, latency, retry, streaming, cancellation, fallback, local resource, tool loop, observability, and blocked paths',
  )

  const evaluation = runRuntimeBudgetGovernanceCompatibilityEvaluation({ now: () => 2930000000000 })
  assert.equal(evaluation.schema, RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `runtime budget governance gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['provider-request', 'provider-stream', 'retry', 'fallback', 'local-inference', 'tool-loop', 'observability', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }
  for (const kind of ['input-tokens', 'output-tokens', 'cost', 'latency', 'timeout', 'retry', 'stream-idle', 'tool-calls', 'local-memory', 'thermal']) {
    assert.ok(evaluation.qualityGate.requiredBudgetKinds.includes(kind), `quality gate tracks ${kind}`)
  }

  const tokenBudget = diagnostic(evaluation, 'token-budget-normalization')
  assertReady(tokenBudget)
  assert.ok(tokenBudget.policy.budgetKinds.includes('input-tokens'), 'token budget fixture tracks input tokens')
  assert.ok(tokenBudget.policy.budgetKinds.includes('output-tokens'), 'token budget fixture tracks output tokens')

  const cost = diagnostic(evaluation, 'cost-budget-ceiling')
  assertReady(cost)
  assert.ok(cost.policy.estimatedCostUsd <= cost.policy.costBudgetUsd, 'cost fixture stays within budget')

  const latency = diagnostic(evaluation, 'latency-timeout-policy')
  assertReady(latency)
  assert.ok(latency.policy.timeoutMs > latency.policy.observedLatencyMs, 'latency fixture has timeout beyond observed latency')

  const retry = diagnostic(evaluation, 'retry-and-circuit-breaker-policy')
  assertReady(retry)
  assert.ok(retry.policy.retryLimit > 0, 'retry fixture allows bounded retries')
  assert.equal(retry.policy.circuitBreaker, true, 'retry fixture uses circuit breaker')

  const stream = diagnostic(evaluation, 'streaming-idle-timeout')
  assertReady(stream)
  assert.ok(stream.policy.streamIdleTimeoutMs > 0, 'stream fixture has idle timeout')

  const cancellation = diagnostic(evaluation, 'cancellation-propagation')
  assertReady(cancellation)
  assert.equal(cancellation.policy.cancellationPropagated, true, 'cancellation fixture propagates aborts')

  const fallback = diagnostic(evaluation, 'visible-fallback-with-budget-preservation')
  assertDegraded(fallback)
  assert.equal(fallback.policy.fallbackBudgetPolicy, 'preserve-or-reduce', 'fallback preserves or reduces budgets')
  assert.equal(fallback.policy.fallbackVisible, true, 'fallback is visible')

  const local = diagnostic(evaluation, 'local-inference-resource-budget')
  assertDegraded(local)
  assert.ok(local.policy.budgetKinds.includes('local-memory'), 'local inference tracks memory')
  assert.ok(local.policy.budgetKinds.includes('thermal'), 'local inference tracks thermal policy')

  const tools = diagnostic(evaluation, 'tool-loop-budget-boundary')
  assertReady(tools)
  assert.ok(tools.policy.estimatedToolCalls <= tools.policy.maxToolCalls, 'tool loop stays within call budget')

  const observability = diagnostic(evaluation, 'observability-budget-accounting')
  assertReady(observability)
  assert.equal(observability.policy.budgetLedger, true, 'observability fixture records budget ledger')

  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-retries'), [
    'missing-retry-limit',
    'missing-circuit-breaker',
    'unbounded-retries',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-missing-timeout'), [
    'missing-latency-budget',
    'missing-timeout',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-fallback-budget-escalation'), [
    'fallback-budget-escalation',
    'missing-visible-downgrade',
    'budget-exceeded',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-no-cancellation'), ['missing-cancellation'])
  assertBlocked(diagnostic(evaluation, 'blocked-unmetered-tool-loop'), [
    'missing-tool-loop-limit',
    'unmetered-tool-loop',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-local-resource-use'), [
    'missing-thermal-policy',
    'budget-exceeded',
    'unbounded-local-resource-use',
  ])

  console.log('Runtime budget governance compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
