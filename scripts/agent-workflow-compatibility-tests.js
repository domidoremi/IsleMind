const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA,
  AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS,
  runAgentWorkflowCompatibilityEvaluation,
} = require('../src/services/agentWorkflowCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentWorkflowCompatibilityHook) return

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
  hook.isAgentWorkflowCompatibilityHook = true
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
  assert.equal(item.policy.runtimeSchema, true, `${item.fixtureId} records runtime schema`)
  assert.equal(item.policy.stateMachine, true, `${item.fixtureId} uses finite state machine`)
  assert.equal(item.policy.maxSteps > 0 && item.policy.maxSteps <= 8, true, `${item.fixtureId} has bounded steps`)
  assert.equal(item.policy.maxToolCallsPerStep > 0 && item.policy.maxToolCallsPerStep <= 3, true, `${item.fixtureId} has bounded tool calls`)
  assert.equal(item.policy.visibleTrace, true, `${item.fixtureId} exposes visible trace`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} emits audit event`)
  assert.equal(item.policy.toolActionVisible, true, `${item.fixtureId} keeps tool action visible`)
  assert.equal(item.policy.outputCharLimit >= 512 && item.policy.outputCharLimit <= 12000, true, `${item.fixtureId} has output budget`)
  assert.equal(item.policy.cancellationSupported, true, `${item.fixtureId} supports cancellation`)
  assert.equal(item.policy.recoveryPrompt, true, `${item.fixtureId} has recovery prompt`)
  assert.equal(item.policy.resumePayloadSafe, true, `${item.fixtureId} has safe resume payload`)
  assert.equal(item.policy.backgroundContinuationAllowed, false, `${item.fixtureId} blocks background continuation`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} redacts outputs`)
  assert.equal(item.policy.rawCommandAllowed, false, `${item.fixtureId} blocks raw commands`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertPaused(item) {
  assert.equal(item.readiness, 'paused', `${item.fixtureId} is paused`)
  assertReadyWithoutReadiness(item)
  assert.equal(item.policy.pendingActionRecorded, true, `${item.fixtureId} records pending action`)
}

function assertReadyWithoutReadiness(item) {
  assert.equal(item.policy.runtimeSchema, true, `${item.fixtureId} records runtime schema`)
  assert.equal(item.policy.stateMachine, true, `${item.fixtureId} uses finite state machine`)
  assert.equal(item.policy.visibleTrace, true, `${item.fixtureId} exposes visible trace`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} emits audit event`)
  assert.equal(item.policy.permissionChecked, true, `${item.fixtureId} checks permission`)
  assert.equal(item.policy.toolActionVisible, true, `${item.fixtureId} keeps tool action visible`)
  assert.equal(item.policy.backgroundContinuationAllowed, false, `${item.fixtureId} blocks background continuation`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} redacts outputs`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA, 'islemind.agent-workflow-compatibility-eval.v1', 'agent workflow schema is versioned')
  assert.deepEqual(
    AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS,
    [
      'runtime-state-machine-boundary',
      'direct-chat-controlled-bypass',
      'permission-pending-action-confirmation',
      'step-limit-human-resume',
      'cancellation-progress-recovery',
      'rag-evidence-repair-pause',
      'work-artifact-quality-audit',
      'handoff-diagnostic-visible-output',
      'runtime-trace-observability',
      'blocked-unbounded-autonomous-loop',
      'blocked-hidden-tool-action',
      'blocked-background-continuation',
      'blocked-unsafe-resume-payload',
    ],
    'agent workflow fixtures cover state machine, permissions, step limits, cancellation, evidence repair, artifacts, handoff, observability, and blocked paths'
  )

  const evaluation = runAgentWorkflowCompatibilityEvaluation({ now: () => 2700000000000 })
  assert.equal(evaluation.schema, AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `agent workflow gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const runKind of ['direct-chat', 'tool-workflow', 'saved-workflow', 'rag-evidence', 'work-artifact', 'handoff', 'diagnostic', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredRunKinds.includes(runKind), `quality gate tracks ${runKind}`)
  }
  for (const controlPattern of ['state-machine', 'permission-gate', 'step-limit', 'cancellation', 'evidence-repair', 'quality-audit', 'handoff', 'trace-observability', 'resume']) {
    assert.ok(evaluation.qualityGate.requiredControlPatterns.includes(controlPattern), `quality gate tracks ${controlPattern}`)
  }

  assertReady(diagnostic(evaluation, 'runtime-state-machine-boundary'))

  const directChat = diagnostic(evaluation, 'direct-chat-controlled-bypass')
  assertReady(directChat)
  assert.equal(directChat.policy.permissionChecked, false, 'direct chat does not require tool permission checks')
  assert.equal(directChat.policy.stepAttribution, false, 'direct chat does not require step attribution')

  const permission = diagnostic(evaluation, 'permission-pending-action-confirmation')
  assertPaused(permission)
  assert.equal(permission.policy.userConfirmationRequired, true, 'permission fixture requires confirmation')
  assert.equal(permission.policy.userConfirmationAvailable, true, 'permission fixture has visible confirmation')

  const stepLimit = diagnostic(evaluation, 'step-limit-human-resume')
  assertPaused(stepLimit)
  assert.equal(stepLimit.policy.recoveryPrompt, true, 'step-limit fixture has recovery prompt')

  assertReady(diagnostic(evaluation, 'cancellation-progress-recovery'))

  const ragRepair = diagnostic(evaluation, 'rag-evidence-repair-pause')
  assertPaused(ragRepair)
  assert.equal(ragRepair.policy.evidenceRepair, true, 'RAG evidence fixture has repair strategy')

  const workArtifact = diagnostic(evaluation, 'work-artifact-quality-audit')
  assertReady(workArtifact)
  assert.equal(workArtifact.policy.qualityAudit, true, 'work artifact fixture has quality audit')
  assert.equal(workArtifact.policy.evidenceRepair, true, 'work artifact fixture has evidence repair metadata')

  const handoff = diagnostic(evaluation, 'handoff-diagnostic-visible-output')
  assertReady(handoff)
  assert.equal(handoff.policy.qualityAudit, true, 'handoff fixture has quality audit')

  const observability = diagnostic(evaluation, 'runtime-trace-observability')
  assertReady(observability)
  assert.equal(observability.policy.auditEvent, true, 'observability fixture emits audit events')

  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-autonomous-loop'), [
    'step-limit-overrun',
    'tool-call-limit-overrun',
    'background-continuation-enabled',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-hidden-tool-action'), [
    'missing-visible-trace',
    'missing-audit-event',
    'missing-permission-check',
    'hidden-tool-action',
    'missing-user-confirmation',
    'missing-pending-action',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-background-continuation'), [
    'background-continuation-enabled',
    'missing-human-review',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-unsafe-resume-payload'), [
    'unsafe-resume-payload',
    'missing-redaction',
    'raw-command-enabled',
  ])

  console.log('Agent workflow compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
