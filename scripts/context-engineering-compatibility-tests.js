const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  CONTEXT_ENGINEERING_COMPATIBILITY_EVAL_SCHEMA,
  CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURE_IDS,
  runContextEngineeringCompatibilityEvaluation,
} = require('../src/services/contextEngineeringCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isContextEngineeringCompatibilityHook) return

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
  hook.isContextEngineeringCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.policy.tokenBudget > 0, true, `${item.fixtureId} has finite token budget`)
  assert.equal(item.policy.estimatedTokens <= item.policy.tokenBudget, true, `${item.fixtureId} stays within token budget`)
  assert.equal(item.policy.sourceHash, true, `${item.fixtureId} has source hash`)
  assert.equal(item.policy.provenance, true, `${item.fixtureId} has provenance`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} has redaction`)
  assert.equal(item.policy.rawTextSerialized, false, `${item.fixtureId} does not serialize raw context`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} is a non-networked control-plane artifact`)
  assert.equal(item.policy.runtimeEvents, true, `${item.fixtureId} emits runtime events`)
  assert.equal(item.policy.visibleDecision, true, `${item.fixtureId} has visible decisions`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(CONTEXT_ENGINEERING_COMPATIBILITY_EVAL_SCHEMA, 'islemind.context-engineering-compatibility-eval.v1', 'context engineering schema is versioned')
  assert.deepEqual(
    CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURE_IDS,
    [
      'long-context-budgeted-assembly',
      'retrieval-provenance-citation',
      'memory-review-boundary',
      'tool-output-permissioned-context',
      'remote-compact-local-fallback',
      'context-cache-reuse-hash',
      'runtime-manifest-observability',
      'blocked-unbounded-context-source',
      'blocked-raw-context-manifest',
      'blocked-cross-authority-memory-leak',
    ],
    'context engineering fixtures cover assembly, retrieval, memory, tools, compact, cache, observability, and blocked paths'
  )

  const evaluation = runContextEngineeringCompatibilityEvaluation({ now: () => 2500000000000 })
  assert.equal(evaluation.schema, CONTEXT_ENGINEERING_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `context engineering gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const sourceKind of ['system', 'conversation', 'retrieval', 'memory', 'tool-output', 'remote-compact-state']) {
    assert.ok(evaluation.qualityGate.requiredSourceKinds.includes(sourceKind), `quality gate tracks ${sourceKind}`)
  }
  for (const authority of ['system', 'conversation', 'user-private', 'external-public', 'permissioned-tool', 'local-state']) {
    assert.ok(evaluation.qualityGate.requiredAuthorities.includes(authority), `quality gate tracks ${authority}`)
  }

  assertReady(diagnostic(evaluation, 'long-context-budgeted-assembly'))
  const retrieval = diagnostic(evaluation, 'retrieval-provenance-citation')
  assertReady(retrieval)
  assert.equal(retrieval.policy.citationTrace, true, 'retrieval context carries citations')
  assert.equal(retrieval.policy.rankingScore, true, 'retrieval context carries ranking evidence')

  const memory = diagnostic(evaluation, 'memory-review-boundary')
  assertReady(memory)
  assert.equal(memory.policy.userReviewed, true, 'memory context requires review')

  const tool = diagnostic(evaluation, 'tool-output-permissioned-context')
  assertReady(tool)
  assert.equal(tool.policy.permissionChecked, true, 'tool output context requires permission checks')

  const compactFallback = diagnostic(evaluation, 'remote-compact-local-fallback')
  assert.equal(compactFallback.readiness, 'degraded', 'remote compact local fallback is degraded but allowed')
  assert.equal(compactFallback.policy.compactMode, 'fallback', 'remote compact fixture records fallback mode')
  assert.equal(compactFallback.policy.compactFallback, true, 'remote compact fixture has local fallback plan')
  assert.equal(compactFallback.policy.visibleDecision, true, 'remote compact fallback is visible')

  const cache = diagnostic(evaluation, 'context-cache-reuse-hash')
  assertReady(cache)
  assert.equal(cache.policy.cacheReuse, true, 'cache fixture records source-hash reuse')

  const manifest = diagnostic(evaluation, 'runtime-manifest-observability')
  assertReady(manifest)
  assert.equal(manifest.policy.runtimeEvents, true, 'manifest fixture emits runtime events')
  assert.equal(manifest.policy.rawTextSerialized, false, 'manifest fixture omits raw context text')

  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-context-source'), [
    'missing-token-budget',
    'context-budget-overrun',
    'missing-source-hash',
    'unbounded-context-source',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-raw-context-manifest'), [
    'raw-context-serialized',
    'missing-redaction',
    'control-plane-network-call',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-authority-memory-leak'), [
    'memory-review-missing',
    'missing-redaction',
    'authority-leak',
  ])

  console.log('Context engineering compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
