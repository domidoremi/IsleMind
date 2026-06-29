const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  TOOL_CALLING_COMPATIBILITY_EVAL_SCHEMA,
  TOOL_CALLING_COMPATIBILITY_FIXTURE_IDS,
  runToolCallingCompatibilityEvaluation,
} = require('../src/services/toolCallingCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isToolCallingCompatibilityHook) return

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
  hook.isToolCallingCompatibilityHook = true
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
  assert.equal(item.policy.typedContract, true, `${item.fixtureId} has typed contract`)
  assert.equal(item.policy.schemaValidation, true, `${item.fixtureId} validates schema`)
  assert.equal(item.policy.uniqueToolIdentity, true, `${item.fixtureId} has unique identity`)
  assert.equal(item.policy.argumentValid, true, `${item.fixtureId} has valid arguments`)
  assert.equal(item.policy.permissionChecked, true, `${item.fixtureId} checks permissions`)
  assert.equal(item.policy.outputByteLimit > 0, true, `${item.fixtureId} has output budget`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} redacts output`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} emits audit event`)
  assert.equal(item.policy.structuredOutputSeparate, true, `${item.fixtureId} separates structured output from tools`)
  assert.equal(item.policy.modelMayComposeCommand, false, `${item.fixtureId} blocks model-composed commands`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(TOOL_CALLING_COMPATIBILITY_EVAL_SCHEMA, 'islemind.tool-calling-compatibility-eval.v1', 'tool calling schema is versioned')
  assert.deepEqual(
    TOOL_CALLING_COMPATIBILITY_FIXTURE_IDS,
    [
      'mcp-manifest-tool-contract',
      'provider-native-function-call',
      'structured-output-separated-from-tools',
      'android-native-tool-confirmation',
      'rag-tool-citation-output',
      'tool-result-output-budget-redaction',
      'tool-call-replay-id-reconciliation',
      'blocked-ambiguous-tool-name',
      'blocked-malformed-tool-arguments',
      'blocked-destructive-tool-without-confirmation',
      'blocked-model-composed-command-tool',
    ],
    'tool calling fixtures cover MCP, provider-native, structured output, Android, RAG, gateway, replay, and blocked paths'
  )

  const evaluation = runToolCallingCompatibilityEvaluation({ now: () => 2600000000000 })
  assert.equal(evaluation.schema, TOOL_CALLING_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, TOOL_CALLING_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `tool calling gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const shape of [
    'mcp-tools-list-schema',
    'provider-function-call',
    'structured-output-non-tool',
    'android-native-action',
    'rag-tool',
    'tool-result-envelope',
    'provider-tool-replay',
    'none',
  ]) {
    assert.ok(evaluation.qualityGate.requiredRequestShapes.includes(shape), `quality gate tracks ${shape}`)
  }

  assertReady(diagnostic(evaluation, 'mcp-manifest-tool-contract'))
  assertReady(diagnostic(evaluation, 'provider-native-function-call'))

  const structured = diagnostic(evaluation, 'structured-output-separated-from-tools')
  assertReady(structured)
  assert.equal(structured.requestShape, 'structured-output-non-tool', 'structured output is not an executable tool shape')
  assert.equal(structured.policy.structuredOutputSeparate, true, 'structured output stays separate from tool execution')

  const android = diagnostic(evaluation, 'android-native-tool-confirmation')
  assertReady(android)
  assert.equal(android.policy.permission, 'destructive', 'Android apply operations are destructive')
  assert.equal(android.policy.userConfirmation, true, 'Android destructive tools require confirmation')

  assertReady(diagnostic(evaluation, 'rag-tool-citation-output'))
  assertReady(diagnostic(evaluation, 'tool-result-output-budget-redaction'))

  const replay = diagnostic(evaluation, 'tool-call-replay-id-reconciliation')
  assertReady(replay)
  assert.equal(replay.policy.replayIdStable, true, 'tool replay has stable id')
  assert.equal(replay.policy.providerReplayIdMatch, true, 'tool replay id matches provider state')

  assertBlocked(diagnostic(evaluation, 'blocked-ambiguous-tool-name'), ['ambiguous-tool-identity'])
  assertBlocked(diagnostic(evaluation, 'blocked-malformed-tool-arguments'), ['malformed-arguments'])
  assertBlocked(diagnostic(evaluation, 'blocked-destructive-tool-without-confirmation'), [
    'missing-user-confirmation',
    'destructive-tool-blocked',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-model-composed-command-tool'), [
    'missing-tool-contract',
    'missing-schema-validation',
    'model-composed-command-blocked',
    'missing-user-confirmation',
  ])

  console.log('Tool calling compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
