const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  AGENT_SECURITY_EVAL_CASES,
  AGENT_SECURITY_EVAL_SCHEMA,
  AGENT_SECURITY_RUNTIME_SUMMARY_SCHEMA,
  buildAgentSecurityRuntimeSummary,
  emitAgentSecurityRuntimeSummaryEvent,
  runAgentSecurityEvaluation,
} = require('../src/services/agent/agentSecurityEvaluation.ts')

const requiredAgentToolPolicyCases = [
  'validateAgentWorkflowRunTrace()',
  'quickOutput',
  'confirmAgentAction()',
  'normalizeAgentToolResult()',
  'reusableToolRequestsJson',
  'runtimeArgumentRunSkillSuggestion',
  'deletedSkillRuntimePatch',
  'listEnabledAgentWorkflowIdsForSkillSnapshot',
  'output truncated',
  'running state must stay in trace while message content stays empty',
  'isAgentWorkflowWaitingTrace',
  'nonWorkflowRecoveryActivityTitle',
  'ChatRunner first provider request declares native provider tools',
  'native provider tool per-step limit test',
  'assert.equal(nativeProviderLimitTrace.metadata?.toolCallIndex, 1)',
  'metadataSummary(nativeProviderLimitTrace.metadata) tool call 2',
  'synthesis request must not recursively expose native provider tools',
  'conversation-chat-runner-agent-permission-drift',
  'conversation-chat-runner-agent-identity-drift',
  'conversation-chat-runner-agent-source-drift',
  'conversation-chat-runner-agent-disabled-manifest',
  'mismatchedServerVisibleResumePendingAction',
  'mismatchedDeclaredToolIdResumePendingAction',
  'Forged suggestion swaps the reviewed workflow skill payload',
  'buildAgentWorkflowSkillReviewRequiredEdit',
  'Workflow edit requires local review',
  'hiddenPendingAction',
  'nonWorkflowTracePendingAction',
  'nonWorkflowTraceEvidenceRepairAction',
  'hiddenWorkflowRecoveryAction',
  'nonWorkflowTraceRecoveryAction',
  'hiddenWorkflowContinuationAction',
  'work-artifact-follow-up',
  'hiddenWorkflowSkillSuggestion',
  'missingRagEvidenceTraceAudit',
  'lowConfidenceRagEvidenceTraceAudit',
  'missingEvidenceRagTraceAudit',
  'lowConfidenceRagWorkflow',
  'offlineLowEvidenceRagWorkflow',
  'missingRagRepairStrategyTraceAudit',
  'mismatchedRagRepairStrategyTraceAudit',
  'mismatchedPendingActionResumeAudit',
  'mismatchedCompletionPendingActionToolIdentityAudit',
  'repair-strategy-tail',
  'rag-fallback-tail',
  'missing evidence|缺少证据|根拠不足',
  'quality-gap-tail|missing-kind-tail',
  'agent-workflow-copy-source-visible',
  'workflowCopySourceTraceText',
  'assert.equal((workflowCopySourceTraceText.match(/Copied workflow/g) ?? []).length, 1)',
  'const contextCompressionSummary = metadataSummary({})',
  'const sensitiveContextCompressionSummary = metadataSummary({})',
  'single-message-truncation',
  'const defaultAgentRunLimits = resolveSettingsAgentRunLimits(testSettings)',
  'assert.equal(defaultAgentRunLimits.maxSteps, 3)',
  "assert.equal(defaultAgentRunLimits.allowReadWriteTools, 'visible')",
  "assert.equal(defaultAgentRunLimits.allowDestructiveTools, 'confirm')",
  'assert.equal(defaultAgentRunLimits.allowBackgroundContinuation, false)',
  'assert.equal(defaultAgentRunLimits.requireTrace, true)',
  'assert.equal(defaultAgentRunLimits.outputCharLimit, 4800)',
  'const boundedAgentRunLimits = resolveSettingsAgentRunLimits({})',
  'assert.equal(boundedAgentRunLimits.maxSteps, 8)',
  'assert.equal(boundedAgentRunLimits.maxToolCallsPerStep, 1)',
  'const perStepToolLimit = {}',
  "assert.equal(perStepToolLimit.errorCode, 'step_limit_reached')",
  'assert.equal(perStepToolLimit.trace.metadata?.maxToolCallsPerStep, 1)',
  'assert.equal(boundedAgentRunLimits.outputCharLimit, 512)',
  'const importedUnsafeAgentRunLimits = resolveSettingsAgentRunLimits({})',
  "assert.equal(importedUnsafeAgentRunLimits.allowReadWriteTools, 'visible')",
  "assert.equal(importedUnsafeAgentRunLimits.allowDestructiveTools, 'confirm')",
  'const directInvalidAgentRunLimits = resolveAgentRunLimits({})',
  'const directOversizedAgentRunLimits = resolveAgentRunLimits({})',
  'const directUnsafeAgentRunLimits = resolveAgentRunLimits({})',
  'assert.equal(directUnsafeAgentRunLimits.allowBackgroundContinuation, false)',
  'assert.equal(directUnsafeAgentRunLimits.requireTrace, true)',
  'const perStepToolLimit = await executeAgentTool({})',
  'perStepToolLimit.trace.metadata?.stepIndex',
  'perStepToolLimit.trace.metadata?.toolCallIndex',
  'perStepToolLimit.trace.metadata?.maxToolCallsPerStep',
  'perStepToolLimit.trace.metadata?.maxStepCount',
  "assert.equal(destructiveConfirmedTrace.metadata?.allowReason, 'user-confirmed')",
  'assert.equal(destructiveConfirmedTrace.metadata?.userConfirmed, true)',
  'const wrongCompletionTraceIdAudit = validateAgentWorkflowRunTrace(run)',
  'const wrongSynthesisTraceIdAudit = validateAgentWorkflowRunTrace(run)',
  'const hiddenCompletionTraceAudit = validateAgentWorkflowRunTrace(run)',
  'const appendedTraceAfterCompletionAudit = validateAgentWorkflowRunTrace(run)',
  'const missingStepTraceIdAudit = validateAgentWorkflowRunTrace(run)',
  'const missingObservationTraceIdAudit = validateAgentWorkflowRunTrace(run)',
  'const missingObservationTraceFromStepAudit = validateAgentWorkflowRunTrace(run)',
  'const hiddenAmbiguousWorkflowTraceAudit = validateAgentWorkflowRunTrace(run)',
  'const missingAmbiguousWorkflowCountAudit = validateAgentWorkflowRunTrace(run)',
  'const mismatchedAmbiguousWorkflowNamesAudit = validateAgentWorkflowRunTrace(run)',
  'const truncatedAmbiguousWorkflowNamesAudit = validateAgentWorkflowRunTrace(run)',
  'const missingReadWriteAllowReasonAudit = validateAgentWorkflowRunTrace(run)',
  'const missingDestructiveConfirmationAudit = validateAgentWorkflowRunTrace(run)',
  'Android undo button must require workflow follow-up trace metadata',
  'Android undo prompt must ignore arbitrary message body JSON',
  'Android undo operations must require Android apply-operation tool trace',
  'AGENT_SECURITY_EVAL_SCHEMA',
  'prompt-injection-destructive-tool',
  'prompt-injection-multi-step-tool-escalation',
  'native-provider-tool-permission-ceiling',
  'malformed-tool-arguments',
  'mcp-tool-schema-drift-extra-argument',
  'provider-native-tool-replay-call-id-mismatch',
  'saved-workflow-permission-ceiling-tamper',
  'rag-citation-drift',
  'provider-safety-refusal-fallback-block',
  'provider-rate-limit-approved-fallback',
]

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentToolPolicyHook) return

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
  hook.isAgentToolPolicyHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function findSecurityCase(run, id) {
  const item = run.cases.find((candidate) => candidate.id === id)
  assert.ok(item, `agent security eval includes ${id}`)
  return item
}

function run() {
  assert.ok(requiredAgentToolPolicyCases.includes('validateAgentWorkflowRunTrace()'), 'agent tool policy covers trace validation')
  assert.ok(requiredAgentToolPolicyCases.includes('native provider tool per-step limit test'), 'agent tool policy covers provider-native tool limits')
  assert.ok(requiredAgentToolPolicyCases.includes('Android undo prompt must ignore arbitrary message body JSON'), 'agent tool policy covers Android undo source safety')
  assert.equal(AGENT_SECURITY_EVAL_SCHEMA, 'islemind.agent-security-eval.v1', 'agent security eval schema is versioned')
  for (const category of ['prompt-injection', 'tool-call-misuse', 'malformed-tool-arguments', 'rag-citation-drift', 'provider-fallback-behavior', 'mcp-schema-drift', 'provider-native-tool-replay', 'saved-workflow-tampering']) {
    assert.ok(AGENT_SECURITY_EVAL_CASES.some((item) => item.category === category), `agent security fixtures cover ${category}`)
  }

  const securityRun = runAgentSecurityEvaluation({ now: () => 1900000000000 })
  assert.equal(securityRun.schema, AGENT_SECURITY_EVAL_SCHEMA, 'agent security eval run carries the schema')
  assert.equal(securityRun.qualityGate.passed, true, `agent security quality gate should pass: ${securityRun.qualityGate.failures.join(', ')}`)
  assert.equal(securityRun.summary.failed, 0, 'agent security eval has no failed cases')
  assert.equal(securityRun.cases.length, AGENT_SECURITY_EVAL_CASES.length, 'agent security eval covers every registered case')
  for (const item of securityRun.cases) {
    assert.ok(item.prompt, `${item.id} reports the evaluated prompt`)
    assert.ok(item.expectedPolicy, `${item.id} reports the expected policy`)
    assert.ok(item.actualBehavior, `${item.id} reports actual behavior`)
    assert.ok(item.traceId, `${item.id} reports trace id`)
    assert.ok(Array.isArray(item.evidence) && item.evidence.length > 0, `${item.id} reports evidence`)
  }
  assert.equal(findSecurityCase(securityRun, 'prompt-injection-destructive-tool').blockingCondition, 'permission_required', 'prompt injection destructive tool request pauses for confirmation')
  assert.equal(findSecurityCase(securityRun, 'prompt-injection-multi-step-tool-escalation').blockingCondition, 'permission_required', 'multi-step prompt injection cannot escalate through retrieved context')
  assert.equal(findSecurityCase(securityRun, 'native-provider-tool-permission-ceiling').blockingCondition, 'permission-ceiling', 'provider-native tools honor permission ceiling')
  assert.equal(findSecurityCase(securityRun, 'malformed-tool-arguments').blockingCondition, 'schema_invalid', 'malformed tool arguments fail schema validation')
  assert.equal(findSecurityCase(securityRun, 'mcp-tool-schema-drift-extra-argument').blockingCondition, 'schema_invalid', 'MCP schema drift fails against the current manifest')
  assert.equal(findSecurityCase(securityRun, 'provider-native-tool-replay-call-id-mismatch').blockingCondition, 'provider_tool_replay_mismatch', 'provider-native tool replay rejects mismatched call ids')
  assert.equal(findSecurityCase(securityRun, 'saved-workflow-permission-ceiling-tamper').blockingCondition, 'workflow_tampering', 'saved workflows are revalidated against permission ceilings')
  assert.equal(findSecurityCase(securityRun, 'rag-citation-drift').blockingCondition, 'unsupported-claims', 'RAG citation drift is routed to evidence repair')
  assert.equal(findSecurityCase(securityRun, 'provider-safety-refusal-fallback-block').blockingCondition, 'trigger_not_allowed', 'provider safety refusal does not silently fail over')
  assert.equal(findSecurityCase(securityRun, 'provider-rate-limit-approved-fallback').actualBehavior, 'selected-approved-fallback', 'retryable provider fallback selects approved candidate')

  const runtimeSummary = buildAgentSecurityRuntimeSummary(securityRun)
  assert.equal(AGENT_SECURITY_RUNTIME_SUMMARY_SCHEMA, 'islemind.agent-security-runtime-summary.v1', 'agent security runtime summary schema is versioned')
  assert.equal(runtimeSummary.schema, AGENT_SECURITY_RUNTIME_SUMMARY_SCHEMA, 'agent security runtime summary carries the schema')
  assert.equal(runtimeSummary.evaluationSchema, AGENT_SECURITY_EVAL_SCHEMA, 'agent security runtime summary names the eval schema')
  assert.equal(runtimeSummary.caseCount, securityRun.cases.length, 'agent security runtime summary counts all cases')
  assert.equal(runtimeSummary.failedCaseCount, 0, 'agent security runtime summary records failed cases')
  assert.ok(runtimeSummary.blockedPromptInjectionCount >= 2, 'agent security runtime summary counts prompt-injection blocks')
  assert.ok(runtimeSummary.blockedToolReplayCount >= 1, 'agent security runtime summary counts provider-native replay blocks')
  assert.ok(runtimeSummary.blockedWorkflowTamperingCount >= 1, 'agent security runtime summary counts workflow tampering blocks')
  assert.ok(runtimeSummary.blockingConditions.includes('provider_tool_replay_mismatch'), 'agent security runtime summary exposes replay mismatch blocking')
  assert.equal(typeof emitAgentSecurityRuntimeSummaryEvent, 'function', 'agent security eval can emit runtime telemetry')

  runArchitectureContractSmoke({
    label: 'Agent tool policy',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent tool policy tests passed')
}

if (require.main === module) run()

module.exports = { run, requiredAgentToolPolicyCases }
