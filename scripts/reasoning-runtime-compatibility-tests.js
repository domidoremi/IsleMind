const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  REASONING_RUNTIME_COMPATIBILITY_EVAL_SCHEMA,
  REASONING_RUNTIME_COMPATIBILITY_FIXTURE_IDS,
  runReasoningRuntimeCompatibilityEvaluation,
} = require('../src/services/reasoningRuntimeCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isReasoningRuntimeCompatibilityHook) return

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
  hook.isReasoningRuntimeCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item, shape) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.requestShape, shape, `${item.fixtureId} uses ${shape}`)
  assert.equal(item.appRequestControl, true, `${item.fixtureId} has app request control`)
  assert.equal(item.modelMetadataSupportsReasoning, true, `${item.fixtureId} has model metadata`)
  assert.equal(item.policy.cancellation, true, `${item.fixtureId} is cancellable`)
  assert.equal(item.policy.storesHiddenChain, false, `${item.fixtureId} does not store hidden reasoning`)
  assert.equal(item.trace.hiddenChainOfThought, false, `${item.fixtureId} does not leak hidden chain of thought`)
  assert.equal(item.policy.inputTokenBudget > 0, true, `${item.fixtureId} has input token budget`)
  assert.equal(item.policy.outputTokenBudget > 0, true, `${item.fixtureId} has output token budget`)
  assert.equal(item.policy.estimatedCostUsd > 0, true, `${item.fixtureId} has cost budget`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(REASONING_RUNTIME_COMPATIBILITY_EVAL_SCHEMA, 'islemind.reasoning-runtime-compatibility-eval.v1', 'reasoning runtime schema is versioned')
  assert.deepEqual(
    REASONING_RUNTIME_COMPATIBILITY_FIXTURE_IDS,
    [
      'openai-responses-reasoning-effort',
      'anthropic-thinking-budget',
      'google-thinking-budget',
      'provider-response-reasoning-trace',
      'bounded-verification-loop',
      'tool-result-self-check-loop',
      'unsupported-provider-effort-blocked',
      'budget-escalation-blocked',
      'hidden-reasoning-export-blocked',
      'prompt-only-cot-blocked',
    ],
    'reasoning runtime fixtures cover provider controls, trace-only paths, app loops, and blocked paths'
  )

  const evaluation = runReasoningRuntimeCompatibilityEvaluation({ now: () => 2200000000000 })
  assert.equal(evaluation.schema, REASONING_RUNTIME_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, REASONING_RUNTIME_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `reasoning runtime gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)
  for (const shape of [
    'openai-responses-reasoning',
    'anthropic-thinking-budget',
    'google-thinking-budget',
    'response-reasoning-trace-only',
    'bounded-verifier-loop',
    'tool-result-self-check',
    'none',
  ]) {
    assert.ok(evaluation.qualityGate.requiredRequestShapes.includes(shape), `quality gate tracks ${shape}`)
  }

  assertReady(diagnostic(evaluation, 'openai-responses-reasoning-effort'), 'openai-responses-reasoning')
  assertReady(diagnostic(evaluation, 'anthropic-thinking-budget'), 'anthropic-thinking-budget')
  assertReady(diagnostic(evaluation, 'google-thinking-budget'), 'google-thinking-budget')

  const traceOnly = diagnostic(evaluation, 'provider-response-reasoning-trace')
  assert.equal(traceOnly.readiness, 'trace-only', 'response-side reasoning traces stay trace-only')
  assert.equal(traceOnly.requestShape, 'response-reasoning-trace-only', 'trace-only fixture uses trace-only shape')
  assert.equal(traceOnly.appRequestControl, false, 'trace-only fixture does not claim request controls')
  assert.equal(traceOnly.failureCodes.length, 0, 'trace-only fixture has no failure codes')

  const verifier = diagnostic(evaluation, 'bounded-verification-loop')
  assertReady(verifier, 'bounded-verifier-loop')
  assert.equal(verifier.policy.maxSteps, 3, 'verification loop is step-bounded')
  assert.equal(verifier.policy.verifierRequired, true, 'verification loop requires verifier pass')
  assert.equal(verifier.policy.evalOutcomeRequired, true, 'verification loop requires eval outcome')
  assert.equal(verifier.trace.evalOutcome, true, 'verification loop records eval outcome')

  const toolCheck = diagnostic(evaluation, 'tool-result-self-check-loop')
  assertReady(toolCheck, 'tool-result-self-check')
  assert.equal(toolCheck.policy.toolEvidenceRequired, true, 'tool self-check requires tool evidence')
  assert.equal(toolCheck.trace.toolEvidence, true, 'tool self-check records tool evidence')

  assertBlocked(diagnostic(evaluation, 'unsupported-provider-effort-blocked'), [
    'missing-model-metadata',
    'unsupported-request-control',
    'unsupported-request-shape',
  ])
  assertBlocked(diagnostic(evaluation, 'budget-escalation-blocked'), [
    'token-budget-missing',
    'cost-budget-missing',
    'fallback-escalates-reasoning',
    'retry-unbounded',
    'eval-outcome-missing',
  ])
  assertBlocked(diagnostic(evaluation, 'hidden-reasoning-export-blocked'), ['hidden-reasoning-leak'])
  assertBlocked(diagnostic(evaluation, 'prompt-only-cot-blocked'), [
    'prompt-only-cot-blocked',
    'hidden-reasoning-leak',
    'cancellation-missing',
  ])

  console.log('Reasoning runtime compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
