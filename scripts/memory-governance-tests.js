const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  MEMORY_GOVERNANCE_EVAL_SCHEMA,
  MEMORY_GOVERNANCE_FIXTURE_IDS,
  MEMORY_GOVERNANCE_REFERENCE_STACKS,
  runMemoryGovernanceEvaluation,
} = require('../src/services/memoryGovernanceEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isMemoryGovernanceHook) return

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
  hook.isMemoryGovernanceHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertTraceable(item) {
  assert.ok(item.sourceMessageId, `${item.fixtureId} records source message id`)
  assert.ok(item.extractedClaim, `${item.fixtureId} records extracted claim`)
  assert.equal(typeof item.confidence, 'number', `${item.fixtureId} records confidence`)
  assert.ok(item.retentionClass, `${item.fixtureId} records retention class`)
  assert.ok(item.deletionPath, `${item.fixtureId} records deletion path`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no governance failures`)
}

function run() {
  assert.equal(MEMORY_GOVERNANCE_EVAL_SCHEMA, 'islemind.memory-governance-eval.v1', 'memory governance schema is versioned')
  assert.deepEqual(MEMORY_GOVERNANCE_REFERENCE_STACKS, ['mem0', 'zep-graphiti', 'letta'], 'memory governance tracks current reference stacks')
  assert.deepEqual(
    MEMORY_GOVERNANCE_FIXTURE_IDS,
    [
      'manual-user-preference',
      'model-inferred-preference',
      'mem0-import-review',
      'conversation-summary-scope',
      'conflicting-preference',
      'knowledge-source-boundary',
      'provider-response-boundary',
      'deletion-request-path',
    ],
    'memory governance fixtures cover write, import, conflict, retrieval-boundary, and deletion cases'
  )

  const evaluation = runMemoryGovernanceEvaluation({ now: () => 2000000000000 })
  assert.equal(evaluation.schema, MEMORY_GOVERNANCE_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, MEMORY_GOVERNANCE_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `memory governance gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  const manual = diagnostic(evaluation, 'manual-user-preference')
  assertTraceable(manual)
  assert.equal(manual.action, 'write-active', 'explicit manual memory can become active')
  assert.equal(manual.status, 'active', 'explicit manual memory is active')
  assert.equal(manual.retentionClass, 'long-term', 'explicit manual memory is long-term')
  assert.equal(manual.userVisibleReview, false, 'explicit confirmed memory does not require review')

  const inferred = diagnostic(evaluation, 'model-inferred-preference')
  assertTraceable(inferred)
  assert.equal(inferred.action, 'write-pending-review', 'model-inferred memory is pending')
  assert.equal(inferred.status, 'pending', 'model-inferred memory waits for review')
  assert.equal(inferred.userVisibleReview, true, 'model-inferred memory is visible in review')
  assert.equal(inferred.autonomousWrite, false, 'model-inferred memory is not auto-activated')

  const mem0 = diagnostic(evaluation, 'mem0-import-review')
  assertTraceable(mem0)
  assert.equal(mem0.sourceKind, 'imported', 'mem0 fixture keeps imported source kind')
  assert.match(mem0.sourceDetail, /^mem0:/, 'mem0 fixture records external scope')
  assert.equal(mem0.status, 'pending', 'mem0 import waits for review')
  assert.equal(mem0.retentionClass, 'review-required', 'mem0 import is review-required before long-term use')

  const summary = diagnostic(evaluation, 'conversation-summary-scope')
  assertTraceable(summary)
  assert.equal(summary.retrievalKind, 'generated-summary', 'conversation summaries stay distinct from memory')
  assert.equal(summary.retentionClass, 'session', 'conversation summaries are session-retained')
  assert.equal(summary.writeAllowed, false, 'conversation summaries are not written as long-term memory')

  const conflict = diagnostic(evaluation, 'conflicting-preference')
  assertTraceable(conflict)
  assert.equal(conflict.conflictDetected, true, 'conflicting memory is detected')
  assert.equal(conflict.conflictPolicy, 'review-required', 'conflicting memory requires review')
  assert.equal(conflict.status, 'pending', 'conflicting memory stays pending')
  assert.equal(conflict.autonomousWrite, false, 'conflicting memory is not auto-overwritten')

  const knowledge = diagnostic(evaluation, 'knowledge-source-boundary')
  assertTraceable(knowledge)
  assert.equal(knowledge.retrievalKind, 'knowledge', 'knowledge sources remain knowledge')
  assert.equal(knowledge.action, 'reject-memory-write', 'knowledge import is not promoted to memory')
  assert.equal(knowledge.writeAllowed, false, 'knowledge import cannot write long-term memory')

  const provider = diagnostic(evaluation, 'provider-response-boundary')
  assertTraceable(provider)
  assert.equal(provider.retrievalKind, 'provider-response', 'provider response remains provider response')
  assert.equal(provider.action, 'reject-memory-write', 'provider response is not promoted to memory')
  assert.equal(provider.writeAllowed, false, 'provider response cannot write long-term memory')

  const deletion = diagnostic(evaluation, 'deletion-request-path')
  assertTraceable(deletion)
  assert.equal(deletion.action, 'disable-memory', 'forget request disables memory')
  assert.equal(deletion.status, 'disabled', 'forget request has disabled status result')
  assert.equal(deletion.deletionPath, 'status-disabled', 'forget request records deletion path')
  assert.equal(deletion.retentionClass, 'none', 'forget request removes retention')

  console.log('Memory governance tests passed')
}

if (require.main === module) run()

module.exports = { run }
