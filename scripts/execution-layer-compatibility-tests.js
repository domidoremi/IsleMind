const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  EXECUTION_LAYER_COMPATIBILITY_EVAL_SCHEMA,
  EXECUTION_LAYER_COMPATIBILITY_FIXTURE_IDS,
  runExecutionLayerCompatibilityEvaluation,
} = require('../src/services/executionLayerCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isExecutionLayerCompatibilityHook) return

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
  hook.isExecutionLayerCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertSafeCliWorker(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.guardrails.toolContractRequired, true, `${item.fixtureId} requires a tool contract`)
  assert.equal(item.guardrails.modelMayComposeCommand, false, `${item.fixtureId} blocks model-composed raw commands`)
  assert.equal(item.guardrails.commandAllowlist, true, `${item.fixtureId} requires command allowlists`)
  assert.equal(item.guardrails.cwdScope, 'worker-sandbox', `${item.fixtureId} uses worker sandbox cwd scope`)
  assert.equal(item.guardrails.envAllowlist, true, `${item.fixtureId} requires env allowlists`)
  assert.ok(item.guardrails.timeoutMs >= 30000, `${item.fixtureId} has a timeout`)
  assert.ok(item.guardrails.outputByteLimit > 0, `${item.fixtureId} has an output budget`)
  assert.equal(item.guardrails.artifactManifest, true, `${item.fixtureId} records artifact manifests`)
  assert.equal(item.guardrails.auditEvent, true, `${item.fixtureId} emits audit events`)
  assert.equal(item.guardrails.secretsRedacted, true, `${item.fixtureId} redacts secrets`)
}

function run() {
  assert.equal(EXECUTION_LAYER_COMPATIBILITY_EVAL_SCHEMA, 'islemind.execution-layer-compatibility-eval.v1', 'execution layer schema is versioned')
  assert.deepEqual(
    EXECUTION_LAYER_COMPATIBILITY_FIXTURE_IDS,
    [
      'mcp-control-surface',
      'android-native-intent-files',
      'on-device-onnx-worker',
      'desktop-cli-worker',
      'lan-cli-worker',
      'cloud-job-runner',
      'blocked-mobile-shell-direct',
      'blocked-model-raw-shell',
    ],
    'execution layer fixtures cover control, local native, external CLI, remote jobs, and blocked shell paths'
  )

  const evaluation = runExecutionLayerCompatibilityEvaluation({ now: () => 2100000000000 })
  assert.equal(evaluation.schema, EXECUTION_LAYER_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, EXECUTION_LAYER_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `execution layer gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  const mcp = diagnostic(evaluation, 'mcp-control-surface')
  assert.equal(mcp.kind, 'control', 'MCP remains the control surface')
  assert.equal(mcp.controlPlane, 'mcp', 'MCP fixture records MCP control plane')
  assert.equal(mcp.executionSurface, 'none', 'MCP control surface does not execute work directly')
  assert.equal(mcp.guardrails.modelMayComposeCommand, false, 'MCP control surface does not expose raw shell composition')

  const androidNative = diagnostic(evaluation, 'android-native-intent-files')
  assert.equal(androidNative.readiness, 'ready', 'Android native file adapter is ready')
  assert.equal(androidNative.executionSurface, 'android-native-api', 'Android native file adapter uses native APIs')
  assert.ok(androidNative.riskCodes.includes('native_permission_required'), 'Android native adapter records native permission requirements')
  assert.equal(androidNative.guardrails.userConfirmation, 'destructive', 'Android native destructive operations require confirmation')

  const onDevice = diagnostic(evaluation, 'on-device-onnx-worker')
  assert.equal(onDevice.executionSurface, 'onnx-runtime', 'on-device local inference uses ONNX runtime, not shell')
  assert.equal(onDevice.readiness, 'ready', 'on-device ONNX worker remains ready')

  assertSafeCliWorker(diagnostic(evaluation, 'desktop-cli-worker'))
  assertSafeCliWorker(diagnostic(evaluation, 'lan-cli-worker'))
  assertSafeCliWorker(diagnostic(evaluation, 'cloud-job-runner'))

  const mobileShell = diagnostic(evaluation, 'blocked-mobile-shell-direct')
  assert.equal(mobileShell.readiness, 'blocked', 'direct mobile shell is blocked')
  assert.ok(mobileShell.riskCodes.includes('direct_mobile_shell_blocked'), 'direct mobile shell records Android sandbox risk')
  assert.ok(mobileShell.riskCodes.includes('model_raw_shell_blocked'), 'direct mobile shell records raw model command risk')

  const rawShell = diagnostic(evaluation, 'blocked-model-raw-shell')
  assert.equal(rawShell.readiness, 'blocked', 'model-composed raw shell is blocked')
  assert.ok(rawShell.riskCodes.includes('model_raw_shell_blocked'), 'raw shell fixture records model command risk')

  console.log('Execution layer compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
