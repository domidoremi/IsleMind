import type { ProcessTrace, ToolContentBlock } from '@/types'
import type { AgentStep, AgentWorkflowRun } from '@/services/agent/agentToolTypes'
import { WORK_ARTIFACT_WORKFLOW_CONTRACT } from '@/services/agent/workArtifactWorkflow'
import {
  containsSensitiveText as traceContainsSensitiveText,
  isSensitiveTraceMetadataKey,
  redactSensitiveText as redactTraceSensitiveText,
  sanitizeTraceMetadata,
} from '@/utils/traceSafety'

const RAG_EVIDENCE_MIN_CONFIDENCE = 0.5
const SAVED_WORKFLOW_PLAN_TRACE_ACCEPTANCE_MAX_ITEMS = 3
const SAVED_WORKFLOW_PLAN_TRACE_TOOL_MAX_ITEMS = 5
const VISIBLE_TRACE_CONTENT_LIMIT = 1200

export function createAgentTrace(trace: ProcessTrace): ProcessTrace {
  const completedAt = trace.completedAt ?? Date.now()
  const startedAt = trace.startedAt ?? completedAt
  return sanitizeAgentTrace({
    ...trace,
    title: redactSensitiveText(trace.title),
    completedAt,
    durationMs: trace.durationMs ?? Math.max(0, completedAt - startedAt),
  })
}

export function runningAgentTrace(trace: ProcessTrace): ProcessTrace {
  return sanitizeAgentTrace(trace)
}

export function sanitizeAgentTrace(trace: ProcessTrace): ProcessTrace {
  return {
    ...trace,
    title: redactSensitiveText(trace.title),
    content: trace.content ? clampAgentOutput(redactSensitiveText(trace.content), trace.type === 'tool' ? 1600 : 1200) : undefined,
    metadata: sanitizeMetadata(trace.metadata),
  }
}

export function summarizeToolBlocks(blocks: ToolContentBlock[] | undefined, outputCharLimit = 4800): string {
  if (!blocks?.length) return ''
  const output = blocks
    .map((block) => block.text ?? block.uri ?? block.name ?? block.type)
    .filter(Boolean)
    .join('\n')
  return clampAgentOutput(redactSensitiveText(output), outputCharLimit)
}

export function normalizeToolBlocks(blocks: ToolContentBlock[] | undefined, outputCharLimit = 4800): ToolContentBlock[] | undefined {
  if (!blocks) return undefined
  let used = 0
  return blocks.map((block) => {
    if (!block.text) return block
    const remaining = Math.max(0, outputCharLimit - used)
    const text = clampAgentOutput(redactSensitiveText(block.text), remaining)
    used += text.length
    return { ...block, text }
  })
}

export interface AgentWorkflowRunTraceAuditResult {
  ok: boolean
  errors: string[]
}

export function validateAgentWorkflowRunTrace(run: AgentWorkflowRun): AgentWorkflowRunTraceAuditResult {
  const errors: string[] = []
  const traces = run.traces ?? []
  const traceIds = new Set<string>()

  if (!traces.length) {
    errors.push('Agent workflow run must record trace evidence.')
  }

  for (const trace of traces) {
    if (!trace.id) errors.push('Agent workflow trace entries must include stable ids.')
    if (trace.id && traceIds.has(trace.id)) errors.push(`Agent workflow trace id must be unique: ${trace.id}.`)
    if (trace.id) traceIds.add(trace.id)
  }

  if (!traces.some(isVisibleTrace)) {
    errors.push('Agent workflow run must include at least one visible trace entry.')
  }
  auditSavedWorkflowPlanTrace(traces, errors)

  for (const step of run.steps) {
    if (!step.trace.length) {
      errors.push(`Agent workflow step ${step.id} must record trace evidence.`)
    }
    if (step.trace.length && !step.trace.some(isVisibleTrace)) {
      errors.push(`Agent workflow step ${step.id} must expose visible trace evidence.`)
    }
    for (const trace of step.trace) {
      if (!trace.id) {
        errors.push(`Agent workflow step trace for step ${step.id} must include a stable id.`)
      } else if (!traceIds.has(trace.id)) {
        errors.push(`Agent workflow step trace ${trace.id} must be included in the run trace list.`)
      }
    }
    if (step.toolRequest && !step.observation?.trace) {
      errors.push(`Agent workflow step ${step.id} must record the tool observation trace.`)
    }
    if (step.toolRequest && step.observation?.trace && !isVisibleTrace(step.observation.trace)) {
      errors.push(`Agent workflow step ${step.id} must expose a visible tool observation trace.`)
    }
    if (step.toolRequest && step.observation?.trace) {
      auditObservationStepAttribution(step, errors)
    }
    if (step.observation?.trace && !step.observation.trace.id) {
      errors.push(`Agent workflow observation trace for step ${step.id} must include a stable id.`)
    } else if (step.observation?.trace.id && !traceIds.has(step.observation.trace.id)) {
      errors.push(`Agent workflow observation trace ${step.observation.trace.id} must be included in the run trace list.`)
    }
    if (step.observation?.trace.id && !step.trace.some((trace) => trace.id === step.observation?.trace.id)) {
      errors.push(`Agent workflow observation trace ${step.observation.trace.id} must be included in step ${step.id} trace evidence.`)
    }
  }

  const completionTrace = findCompletionTrace(run)
  if (!completionTrace) {
    errors.push('Agent workflow run must record a completion trace.')
  } else {
    auditCompletionTrace(run, completionTrace, errors)
  }
  const synthesisTrace = findSynthesisTrace(run)
  auditSynthesisTrace(run, synthesisTrace, completionTrace, errors)

  if (isSettledRunStatus(run.status) && typeof run.completedAt !== 'number') {
    errors.push('Settled agent workflow run must record completedAt.')
  }

  if (run.status === 'waiting') {
    if (!run.pendingAction) {
      errors.push('Waiting agent workflow run must record a pending action.')
    } else if (run.failureCode && run.pendingAction.reason !== run.failureCode) {
      errors.push('Waiting agent workflow pending action reason must match failureCode.')
    }
  } else if (run.pendingAction) {
    errors.push('Only waiting agent workflow runs may retain a pending action.')
  }

  auditWaitingPermissionRunTrace(run, completionTrace, errors)
  auditWaitingPendingActionStepAttribution(run, completionTrace, errors)
  auditWaitingContinuationPrompt(run, completionTrace, errors)
  auditWaitingEvidenceRepairTrace(run, completionTrace, synthesisTrace, errors)
  auditElevatedAllowedToolTraces(run, errors)
  auditSkippedWorkflowTraceRecovery(traces, errors)
  auditCancelledRunTrace(run, errors)
  auditFailureRunTrace(run, completionTrace, synthesisTrace, errors)
  auditWorkArtifactRunTrace(run, errors)
  auditRagEvidenceRunTrace(run, errors)
  auditSensitiveRunPayload(run, errors)

  return {
    ok: errors.length === 0,
    errors,
  }
}

export function redactSensitiveText(input: string): string {
  return redactTraceSensitiveText(input)
}

export function clampAgentOutput(input: string, limit: number): string {
  const max = Math.max(0, limit)
  if (input.length <= max) return input
  return `${input.slice(0, Math.max(0, max - 32)).trimEnd()}\n[output truncated]`
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return sanitizeTraceMetadata(metadata)
}

function isVisibleTrace(trace: ProcessTrace): boolean {
  return trace.metadata?.hiddenSignature !== true && Boolean(trace.title || trace.content)
}

function findCompletionTrace(run: AgentWorkflowRun): ProcessTrace | undefined {
  return run.traces.find((trace) => trace.id === `${run.id}-complete`)
}

function findSynthesisTrace(run: AgentWorkflowRun): ProcessTrace | undefined {
  return run.traces.find((trace) => trace.id === `${run.id}-synthesis`)
}

function auditCompletionTrace(run: AgentWorkflowRun, trace: ProcessTrace, errors: string[]): void {
  const metadata = trace.metadata ?? {}
  if (trace.title !== 'Agent workflow') errors.push('Agent workflow completion trace must use the Agent workflow title.')
  if (!isVisibleTrace(trace)) errors.push('Agent workflow completion trace must remain visible.')
  const completionIndex = run.traces.findIndex((candidate) => candidate === trace || candidate.id === trace.id)
  const tracesAfterCompletion = completionIndex >= 0 ? run.traces.slice(completionIndex + 1) : []
  if (tracesAfterCompletion.some((candidate) => !isSkippedWorkflowRecoveryTrace(candidate))) {
    errors.push('Agent workflow completion trace may only be followed by skipped workflow recovery traces.')
  }
  if (trace.status !== expectedCompletionTraceStatus(run.status)) errors.push('Agent workflow completion trace status must match the run status.')
  if (metadata.status !== run.status) errors.push('Agent workflow completion metadata status must match the run status.')
  if (metadata.failureCode !== run.failureCode) errors.push('Agent workflow completion metadata failureCode must match the run failureCode.')
  if (metadata.stepCount !== run.steps.length) errors.push('Agent workflow completion metadata stepCount must match executed steps.')
  auditStepStatusCounts(run, metadata, errors)

  auditBoundedNumber(metadata.maxStepCount, 'maxStepCount', 1, 8, errors)
  auditBoundedNumber(metadata.maxToolCallsPerStep, 'maxToolCallsPerStep', 1, 3, errors)
  auditBoundedNumber(metadata.outputCharLimit, 'outputCharLimit', 512, 12000, errors)

  if (typeof metadata.readOnlyToolsAllowed !== 'boolean') errors.push('Agent workflow completion metadata must record readOnlyToolsAllowed.')
  if (metadata.readWriteToolPolicy !== 'visible' && metadata.readWriteToolPolicy !== false) {
    errors.push('Agent workflow read-write policy must be visible or false.')
  }
  if (metadata.destructiveToolPolicy !== 'confirm' && metadata.destructiveToolPolicy !== false) {
    errors.push('Agent workflow destructive policy must be confirm or false.')
  }
  if (metadata.backgroundContinuationAllowed !== false) {
    errors.push('Agent workflow background continuation must remain disabled.')
  }
  if (metadata.traceRequired !== true) {
    errors.push('Agent workflow trace requirement must remain enabled.')
  }
}

function auditSynthesisTrace(
  run: AgentWorkflowRun,
  trace: ProcessTrace | undefined,
  completionTrace: ProcessTrace | undefined,
  errors: string[]
): void {
  if (!trace) {
    errors.push('Agent workflow run must record a final synthesis trace.')
    return
  }
  const metadata = trace.metadata ?? {}
  if (trace.title !== 'Agent synthesis') errors.push('Agent workflow final synthesis trace must use the Agent synthesis title.')
  if (!isVisibleTrace(trace)) errors.push('Agent workflow final synthesis trace must remain visible.')
  if (trace.status !== 'done') errors.push('Agent workflow final synthesis trace must be marked done.')
  if (metadata.status !== run.status) errors.push('Agent workflow final synthesis metadata status must match the run status.')
  if (metadata.failureCode !== run.failureCode) errors.push('Agent workflow final synthesis metadata failureCode must match the run failureCode.')
  if (typeof metadata.outputCharCount !== 'number' || metadata.outputCharCount < 0) {
    errors.push('Agent workflow final synthesis metadata must record outputCharCount.')
  }
  auditStepStatusCounts(run, metadata, errors, 'final synthesis')
  if (run.pendingAction && metadata.pendingActionReason !== run.pendingAction.reason) {
    errors.push('Agent workflow final synthesis metadata pendingActionReason must match the run pendingAction.')
  }
  if (completionTrace) {
    const synthesisIndex = run.traces.findIndex((candidate) => candidate === trace || candidate.id === trace.id)
    const completionIndex = run.traces.findIndex((candidate) => candidate === completionTrace || candidate.id === completionTrace.id)
    if (synthesisIndex >= 0 && completionIndex >= 0 && synthesisIndex > completionIndex) {
      errors.push('Agent workflow final synthesis trace must be recorded before the completion trace.')
    }
  }
  auditFinalOutputBudget(run, trace, completionTrace, errors)
}

function auditFinalOutputBudget(
  run: AgentWorkflowRun,
  synthesisTrace: ProcessTrace,
  completionTrace: ProcessTrace | undefined,
  errors: string[]
): void {
  const finalOutput = run.finalOutput ?? ''
  const outputCharCount = synthesisTrace.metadata?.outputCharCount
  if (typeof outputCharCount === 'number' && outputCharCount !== finalOutput.length) {
    errors.push('Agent workflow final synthesis metadata outputCharCount must match finalOutput length.')
  }
  const outputCharLimit = completionTrace?.metadata?.outputCharLimit
  if (typeof outputCharLimit === 'number' && finalOutput.length > outputCharLimit) {
    errors.push('Agent workflow finalOutput must not exceed outputCharLimit.')
  }
  if (
    completionTrace?.content !== undefined &&
    !isCompletionTraceContentCompatible(completionTrace.content, run.finalOutput || run.status)
  ) {
    errors.push('Agent workflow completion trace content must match finalOutput or status.')
  }
}

function isCompletionTraceContentCompatible(content: string, expected: string): boolean {
  if (content === expected) return true
  if (expected.length <= VISIBLE_TRACE_CONTENT_LIMIT || !content.endsWith('\n[output truncated]')) return false
  const prefix = content.replace(/\n\[output truncated\]$/, '').trimEnd()
  return Boolean(prefix && expected.startsWith(prefix))
}

function auditStepStatusCounts(
  run: AgentWorkflowRun,
  metadata: Record<string, unknown>,
  errors: string[],
  label = 'completion'
): void {
  const expected = {
    pendingStepCount: run.steps.filter((step) => step.status === 'pending').length,
    runningStepCount: run.steps.filter((step) => step.status === 'running').length,
    doneStepCount: run.steps.filter((step) => step.status === 'done').length,
    errorStepCount: run.steps.filter((step) => step.status === 'error').length,
    cancelledStepCount: run.steps.filter((step) => step.status === 'cancelled').length,
    skippedStepCount: run.steps.filter((step) => step.status === 'skipped').length,
  }
  for (const [key, count] of Object.entries(expected)) {
    if (metadata[key] !== count) {
      errors.push(`Agent workflow ${label} metadata ${key} must match executed steps.`)
    }
  }
}

function auditSavedWorkflowPlanTrace(traces: ProcessTrace[], errors: string[]): void {
  const savedWorkflowPlanTraces = traces.filter((trace) => (
    trace.title === 'Agent plan' &&
    trace.metadata?.source === 'agent-workflow-skill'
  ))
  for (const trace of savedWorkflowPlanTraces) {
    const metadata = trace.metadata ?? {}
    if (typeof metadata.workflowExpectedOutput !== 'string' || !metadata.workflowExpectedOutput.trim()) {
      errors.push('Saved workflow plan trace must record workflowExpectedOutput.')
    }
    if (typeof metadata.workflowPermissionCeiling !== 'string' || !metadata.workflowPermissionCeiling.trim()) {
      errors.push('Saved workflow plan trace must record workflowPermissionCeiling.')
    }
    if (!isNonNegativeInteger(metadata.workflowRequiredToolCount)) {
      errors.push('Saved workflow plan trace must record workflowRequiredToolCount.')
    }
    if (
      isNonNegativeInteger(metadata.workflowRequiredToolCount) &&
      metadata.workflowRequiredToolCount > 0 &&
      !hasStringArrayWithLength(
        metadata.workflowRequiredTools,
        Math.min(metadata.workflowRequiredToolCount, SAVED_WORKFLOW_PLAN_TRACE_TOOL_MAX_ITEMS)
      )
    ) {
      errors.push('Saved workflow plan trace must record workflowRequiredTools when required tools are present.')
    }
    if (!isNonNegativeInteger(metadata.acceptanceCheckCount)) {
      errors.push('Saved workflow plan trace must record acceptanceCheckCount.')
    }
    if (
      isNonNegativeInteger(metadata.acceptanceCheckCount) &&
      metadata.acceptanceCheckCount > 0 &&
      !hasStringArrayWithLength(
        metadata.workflowAcceptanceChecks,
        Math.min(metadata.acceptanceCheckCount, SAVED_WORKFLOW_PLAN_TRACE_ACCEPTANCE_MAX_ITEMS)
      )
    ) {
      errors.push('Saved workflow plan trace must record workflowAcceptanceChecks when acceptance checks are present.')
    }
    if (!isNonNegativeInteger(metadata.workflowRagProfileRequirementCount)) {
      errors.push('Saved workflow plan trace must record workflowRagProfileRequirementCount.')
    }
    if (!isNonNegativeInteger(metadata.runtimeArgumentBindingCount)) {
      errors.push('Saved workflow plan trace must record runtimeArgumentBindingCount.')
    }
    if (
      isNonNegativeInteger(metadata.workflowRagProfileRequirementCount) &&
      metadata.workflowRagProfileRequirementCount > 0 &&
      !hasStringArrayWithLength(metadata.workflowRagProfileRequirements, metadata.workflowRagProfileRequirementCount)
    ) {
      errors.push('Saved workflow plan trace must record workflowRagProfileRequirements when profile requirements are present.')
    }
    if (
      isNonNegativeInteger(metadata.runtimeArgumentBindingCount) &&
      metadata.runtimeArgumentBindingCount > 0 &&
      !hasStringArrayWithLength(metadata.runtimeArgumentBindings, metadata.runtimeArgumentBindingCount)
    ) {
      errors.push('Saved workflow plan trace must record runtimeArgumentBindings when runtime bindings are present.')
    }
  }
}

function auditObservationStepAttribution(step: AgentStep, errors: string[]): void {
  const metadata = step.observation?.trace.metadata ?? {}
  if (metadata.stepId !== step.id) {
    errors.push(`Agent workflow observation trace for step ${step.id} must record matching stepId.`)
  }
  if (!isNonEmptyString(metadata.stepTitle)) {
    errors.push(`Agent workflow observation trace for step ${step.id} must record stepTitle.`)
  }
  if (!isNonNegativeInteger(metadata.stepNumber)) {
    errors.push(`Agent workflow observation trace for step ${step.id} must record stepNumber.`)
  }
  if (!isNonNegativeInteger(metadata.planStepCount)) {
    errors.push(`Agent workflow observation trace for step ${step.id} must record planStepCount.`)
  }
}

function auditFailureRunTrace(
  run: AgentWorkflowRun,
  completionTrace: ProcessTrace | undefined,
  synthesisTrace: ProcessTrace | undefined,
  errors: string[]
): void {
  if (run.status !== 'error') return
  if (!run.failureCode) {
    errors.push('Failed agent workflow runs must record failureCode.')
  }
  if (!isNonEmptyString(run.finalOutput) || !/Next step:/i.test(run.finalOutput)) {
    errors.push('Failed agent workflow runs must include a visible next step in finalOutput.')
  }
  if (!isNonEmptyString(completionTrace?.metadata?.failureNextStep)) {
    errors.push('Failed agent workflow completion trace must record failureNextStep.')
  }
  if (!isNonEmptyString(synthesisTrace?.metadata?.failureNextStep)) {
    errors.push('Failed agent workflow synthesis trace must record failureNextStep.')
  }
  const failedStep = run.steps.find((step) => step.observation?.errorCode && step.observation.errorCode !== 'permission_required')
    ?? run.steps.find((step) => step.status === 'error')
  if (!failedStep) return
  auditFailureStepAttribution(failedStep, completionTrace?.metadata, 'completion', errors)
  auditFailureStepAttribution(failedStep, synthesisTrace?.metadata, 'synthesis', errors)
  auditFailureToolAttribution(failedStep, completionTrace?.metadata, 'completion', errors)
  auditFailureToolAttribution(failedStep, synthesisTrace?.metadata, 'synthesis', errors)
}

function auditFailureStepAttribution(
  step: AgentStep,
  metadata: Record<string, unknown> | undefined,
  traceName: 'completion' | 'synthesis',
  errors: string[]
): void {
  if (!metadata) {
    errors.push(`Failed agent workflow ${traceName} trace must record failed step metadata.`)
    return
  }
  if (metadata.failedStepId !== step.id) {
    errors.push(`Failed agent workflow ${traceName} trace failedStepId must match the failed step.`)
  }
  if (metadata.failedStepTitle !== safeStepTitle(step.title)) {
    errors.push(`Failed agent workflow ${traceName} trace failedStepTitle must match the failed step.`)
  }
  const stepMetadata = step.observation?.trace.metadata ?? {}
  const expectedStepNumber = isPositiveInteger(stepMetadata.stepNumber) ? stepMetadata.stepNumber : undefined
  const expectedPlanStepCount = isPositiveInteger(stepMetadata.planStepCount) ? stepMetadata.planStepCount : undefined
  if (expectedStepNumber !== undefined && metadata.failedStepNumber !== expectedStepNumber) {
    errors.push(`Failed agent workflow ${traceName} trace failedStepNumber must match the failed step.`)
  }
  if (expectedPlanStepCount !== undefined && metadata.failedPlanStepCount !== expectedPlanStepCount) {
    errors.push(`Failed agent workflow ${traceName} trace failedPlanStepCount must match the failed step.`)
  }
}

function auditFailureToolAttribution(
  step: AgentStep,
  metadata: Record<string, unknown> | undefined,
  traceName: 'completion' | 'synthesis',
  errors: string[]
): void {
  const expected = buildExpectedFailureToolAttribution(step)
  if (!expected.required) return
  if (!metadata) {
    errors.push(`Failed agent workflow ${traceName} trace must record failed tool metadata.`)
    return
  }
  if (expected.failedToolName !== undefined && metadata.failedToolName !== expected.failedToolName) {
    errors.push(`Failed agent workflow ${traceName} trace failedToolName must match the failed tool.`)
  }
  if (expected.failedToolId !== undefined && metadata.failedToolId !== expected.failedToolId) {
    errors.push(`Failed agent workflow ${traceName} trace failedToolId must match the failed tool.`)
  }
  if (expected.failedToolSource !== undefined && metadata.failedToolSource !== expected.failedToolSource) {
    errors.push(`Failed agent workflow ${traceName} trace failedToolSource must match the failed tool.`)
  }
  if (expected.failedToolErrorCode !== undefined && metadata.failedToolErrorCode !== expected.failedToolErrorCode) {
    errors.push(`Failed agent workflow ${traceName} trace failedToolErrorCode must match the failed tool.`)
  }
}

function buildExpectedFailureToolAttribution(step: AgentStep): {
  required: boolean
  failedToolName?: string
  failedToolId?: string
  failedToolSource?: string
  failedToolErrorCode?: string
} {
  const observation = step.observation
  const traceMetadata = observation?.trace.metadata ?? {}
  const failedToolName = safeFailureToolText(
    step.toolRequest?.name ??
    step.toolRequest?.toolId ??
    readNonEmptyText(traceMetadata.toolName) ??
    readNonEmptyText(traceMetadata.toolId)
  )
  const failedToolId = safeFailureToolText(
    step.toolRequest?.toolId ??
    readNonEmptyText(traceMetadata.toolId)
  )
  const failedToolSource = parseKnownAgentToolSource(step.toolRequest?.source ?? traceMetadata.toolSource ?? traceMetadata.source)
  const failedToolErrorCode = parseKnownAgentFailureCode(observation?.errorCode ?? traceMetadata.errorCode)
  return {
    required: Boolean(step.toolRequest || observation?.errorCode || failedToolName || failedToolId || failedToolSource || failedToolErrorCode),
    ...(failedToolName ? { failedToolName } : {}),
    ...(failedToolId ? { failedToolId } : {}),
    ...(failedToolSource ? { failedToolSource } : {}),
    ...(failedToolErrorCode ? { failedToolErrorCode } : {}),
  }
}

function auditSkippedWorkflowTraceRecovery(traces: ProcessTrace[], errors: string[]): void {
  const recoverableReasons = new Set([
    'workflow-disabled',
    'workflow-review-required',
    'workflow-invalid',
    'workflow-selection-ambiguous',
  ])
  for (const trace of traces) {
    if (trace.status !== 'skipped' || !recoverableReasons.has(String(trace.metadata?.reason ?? ''))) continue
    if (!isVisibleTrace(trace)) {
      errors.push(`Skipped workflow trace ${trace.id || trace.title || 'unknown'} must remain visible.`)
    }
    if (trace.metadata?.reason === 'workflow-selection-ambiguous') {
      if (typeof trace.metadata.workflowCount !== 'number' || trace.metadata.workflowCount < 2) {
        errors.push(`Skipped workflow trace ${trace.id || trace.title || 'unknown'} must record ambiguous workflow count.`)
      }
      const workflowNameLimit = Math.min(typeof trace.metadata.workflowCount === 'number' ? trace.metadata.workflowCount : 0, 6)
      if (
        !Array.isArray(trace.metadata.workflowNames) ||
        trace.metadata.workflowNames.length < 1 ||
        trace.metadata.workflowNames.length > workflowNameLimit ||
        !trace.metadata.workflowNames.every((name) => isNonEmptyString(name))
      ) {
        errors.push(`Skipped workflow trace ${trace.id || trace.title || 'unknown'} must record visible ambiguous workflow names within the display limit.`)
      }
    } else if (!isNonEmptyString(trace.metadata?.workflowId) && !isNonEmptyString(trace.metadata?.workflowName)) {
      errors.push(`Skipped workflow trace ${trace.id || trace.title || 'unknown'} must record workflow identity.`)
    }
    if (!isNonEmptyString(trace.metadata?.failureNextStep)) {
      errors.push(`Skipped workflow trace ${trace.id || trace.title || 'unknown'} must record failureNextStep.`)
    }
  }
}

function isSkippedWorkflowRecoveryTrace(trace: ProcessTrace): boolean {
  return (
    trace.status === 'skipped' &&
    (
      trace.metadata?.reason === 'workflow-disabled' ||
      trace.metadata?.reason === 'workflow-review-required' ||
      trace.metadata?.reason === 'workflow-invalid' ||
      trace.metadata?.reason === 'workflow-selection-ambiguous'
    )
  )
}

function auditWaitingEvidenceRepairTrace(
  run: AgentWorkflowRun,
  completionTrace: ProcessTrace | undefined,
  synthesisTrace: ProcessTrace | undefined,
  errors: string[]
): void {
  if (run.status !== 'waiting' || run.failureCode !== 'evidence_insufficient') return
  const pendingAction = run.pendingAction
  if (!pendingAction || pendingAction.reason !== 'evidence_insufficient') return
  if (!isNonEmptyString(pendingAction.blockedReason)) {
    errors.push('Evidence repair pending action must record blockedReason.')
  }
  const expected = pendingAction.blockedReason
  auditEvidenceRepairNextStep(completionTrace?.metadata, expected, 'completion', errors)
  auditEvidenceRepairNextStep(synthesisTrace?.metadata, expected, 'synthesis', errors)
}

function auditEvidenceRepairNextStep(
  metadata: Record<string, unknown> | undefined,
  expected: string | undefined,
  traceName: 'completion' | 'synthesis',
  errors: string[]
): void {
  if (!metadata) {
    errors.push(`Evidence repair ${traceName} trace must record repairNextStep.`)
    return
  }
  if (!isNonEmptyString(metadata.repairNextStep)) {
    errors.push(`Evidence repair ${traceName} trace must record repairNextStep.`)
    return
  }
  if (isNonEmptyString(expected) && metadata.repairNextStep !== expected) {
    errors.push(`Evidence repair ${traceName} trace repairNextStep must match pendingAction.blockedReason.`)
  }
}

function auditCancelledRunTrace(run: AgentWorkflowRun, errors: string[]): void {
  if (run.status !== 'cancelled') return
  if (run.failureCode !== 'cancelled') {
    errors.push('Cancelled agent workflow runs must record failureCode=cancelled.')
  }
  if (run.pendingAction) {
    errors.push('Cancelled agent workflow runs must not retain pending actions.')
  }
  const cancellationTrace = run.traces.find((trace) => (
    isVisibleTrace(trace) &&
    (
      trace.metadata?.status === 'cancelled' ||
      trace.metadata?.failureCode === 'cancelled' ||
      trace.metadata?.errorCode === 'cancelled'
    )
  ))
  if (!cancellationTrace) {
    errors.push('Cancelled agent workflow runs must expose a visible cancellation trace.')
  }
  const completionTrace = findCompletionTrace(run)
  if (!completionTrace || !isVisibleTrace(completionTrace)) {
    errors.push('Cancelled agent workflow runs must expose a visible cancellation completion trace.')
    return
  }
  auditCancelledProgressMetadata(run, completionTrace, errors)
}

function auditCancelledProgressMetadata(run: AgentWorkflowRun, trace: ProcessTrace, errors: string[]): void {
  const metadata = trace.metadata ?? {}
  const planStepCount = metadata.planStepCount
  const completedStepCount = metadata.completedStepCount
  const remainingStepCount = metadata.remainingStepCount

  if (!isNonNegativeInteger(planStepCount)) {
    errors.push('Cancelled agent workflow completion metadata must record planStepCount.')
  }
  if (!isNonNegativeInteger(completedStepCount)) {
    errors.push('Cancelled agent workflow completion metadata must record completedStepCount.')
  }
  if (!isNonNegativeInteger(remainingStepCount)) {
    errors.push('Cancelled agent workflow completion metadata must record remainingStepCount.')
  }

  if (
    isNonNegativeInteger(planStepCount) &&
    isNonNegativeInteger(completedStepCount) &&
    isNonNegativeInteger(remainingStepCount)
  ) {
    const actualCompletedStepCount = run.steps.filter((step) => step.status === 'done').length
    if (completedStepCount !== actualCompletedStepCount) {
      errors.push('Cancelled agent workflow completion metadata completedStepCount must match completed steps.')
    }
    if (remainingStepCount !== Math.max(0, planStepCount - completedStepCount)) {
      errors.push('Cancelled agent workflow completion metadata remainingStepCount must match the unfinished plan.')
    }
    if (remainingStepCount > 0) {
      const expectedStepNumber = completedStepCount + 1
      if (!isNonEmptyString(metadata.cancelledAtStepTitle)) {
        errors.push('Cancelled agent workflow completion metadata must record cancelledAtStepTitle when remaining steps exist.')
      }
      if (!isPositiveInteger(metadata.cancelledAtStepNumber)) {
        errors.push('Cancelled agent workflow completion metadata must record cancelledAtStepNumber when remaining steps exist.')
      } else if (metadata.cancelledAtStepNumber !== expectedStepNumber) {
        errors.push('Cancelled agent workflow completion metadata cancelledAtStepNumber must match the next unresolved step.')
      }
      if (!isNonEmptyString(metadata.nextStepTitle)) {
        errors.push('Cancelled agent workflow completion metadata must record nextStepTitle when remaining steps exist.')
      }
      if (!isPositiveInteger(metadata.nextStepNumber)) {
        errors.push('Cancelled agent workflow completion metadata must record nextStepNumber when remaining steps exist.')
      } else if (metadata.nextStepNumber !== expectedStepNumber) {
        errors.push('Cancelled agent workflow completion metadata nextStepNumber must match the next unresolved step.')
      }
    }
  }

  if (typeof metadata.cancelledContinuationPrompt !== 'string' || !metadata.cancelledContinuationPrompt.trim()) {
    errors.push('Cancelled agent workflow completion metadata must record cancelledContinuationPrompt.')
  }
}

function auditWaitingPermissionRunTrace(
  run: AgentWorkflowRun,
  completionTrace: ProcessTrace | undefined,
  errors: string[]
): void {
  if (run.status !== 'waiting' || run.failureCode !== 'permission_required') return
  const action = run.pendingAction
  if (!action) return

  if (!action.toolName && !action.toolId) {
    errors.push('Permission-required pending actions must identify the requested tool.')
  }
  if (!isKnownToolPermission(action.permission)) {
    errors.push('Permission-required pending actions must record the requested permission.')
  }
  if (!action.source) {
    errors.push('Permission-required pending actions must record the requested tool source.')
  }
  if (action.confirmable && !action.resumeToolRequest) {
    errors.push('Confirmable permission-required pending actions must include a resume tool request.')
  }
  if (!action.confirmable && !action.blockedReason) {
    errors.push('Non-confirmable permission-required pending actions must record blockedReason.')
  }
  if (!action.confirmable && !isNonEmptyString(action.suggestedUserPrompt)) {
    errors.push('Non-confirmable permission-required pending actions must include suggestedUserPrompt.')
  }
  auditConfirmablePermissionPendingActionResumeIdentity(action, 'Permission-required pending actions', errors)

  const tracePendingAction = completionTrace?.metadata?.pendingAction
  if (!completionTrace || !isVisibleTrace(completionTrace) || !isPendingActionMetadata(tracePendingAction)) {
    errors.push('Permission-required waiting runs must expose pendingAction in the visible completion trace.')
  } else {
    if (tracePendingAction.id !== action.id) {
      errors.push('Permission-required completion trace pendingAction id must match the run pendingAction.')
    }
    if (tracePendingAction.reason !== action.reason) {
      errors.push('Permission-required completion trace pendingAction reason must match the run pendingAction.')
    }
    if (tracePendingAction.confirmable !== action.confirmable) {
      errors.push('Permission-required completion trace pendingAction confirmable flag must match the run pendingAction.')
    }
    if (tracePendingAction.permission !== action.permission) {
      errors.push('Permission-required completion trace pendingAction permission must match the run pendingAction.')
    }
    auditCompletionTracePendingActionToolIdentity(action, tracePendingAction as Record<string, unknown>, errors)
    auditConfirmablePermissionPendingActionResumeIdentity(tracePendingAction, 'Permission-required completion trace pendingAction', errors)
    if (!action.confirmable && (tracePendingAction as Record<string, unknown>).suggestedUserPrompt !== action.suggestedUserPrompt) {
      errors.push('Non-confirmable permission-required completion trace pendingAction suggestedUserPrompt must match the run pendingAction.')
    }
  }

  const policyTrace = run.traces.find((trace) => (
    isVisibleTrace(trace) &&
    trace.metadata?.code === 'permission_required' &&
    trace.metadata?.decision !== 'allow' &&
    (!action.permission || trace.metadata?.permission === action.permission)
  ))
  if (!policyTrace) {
    errors.push('Permission-required waiting runs must expose the permission policy trace.')
  }
}

function auditConfirmablePermissionPendingActionResumeIdentity(
  action: {
    confirmable: boolean
    permission?: unknown
    toolName?: unknown
    toolId?: unknown
    serverId?: unknown
    source?: unknown
    resumeToolRequest?: unknown
  },
  label: string,
  errors: string[]
): void {
  if (!action.confirmable) return
  if (action.permission !== 'read-write' && action.permission !== 'destructive') {
    errors.push(`${label} must use read-write or destructive permission before one-tap confirmation.`)
  }
  const request = action.resumeToolRequest
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    errors.push(`${label} must include a resume tool request object before one-tap confirmation.`)
    return
  }
  const record = request as Record<string, unknown>
  if (record.source !== undefined && record.source !== action.source) {
    errors.push(`${label} resume request source must match the visible tool source.`)
  }
  if ((record.serverId !== undefined || action.serverId !== undefined) && record.serverId !== action.serverId) {
    errors.push(`${label} resume request serverId must match the visible server identity.`)
  }
  if (record.name !== undefined && record.name !== action.toolName) {
    errors.push(`${label} resume request name must match the visible tool name.`)
  }
  if (record.toolId !== undefined && record.toolId !== action.toolId) {
    errors.push(`${label} resume request toolId must match the visible tool id.`)
  }
  if (record.name === undefined && record.toolId === undefined) {
    errors.push(`${label} resume request must identify the visible tool by name or id.`)
  }
}

function auditCompletionTracePendingActionToolIdentity(
  action: NonNullable<AgentWorkflowRun['pendingAction']>,
  tracePendingAction: Record<string, unknown>,
  errors: string[]
): void {
  if (tracePendingAction.toolName !== action.toolName) {
    errors.push('Permission-required completion trace pendingAction toolName must match the run pendingAction.')
  }
  if (tracePendingAction.toolId !== action.toolId) {
    errors.push('Permission-required completion trace pendingAction toolId must match the run pendingAction.')
  }
  if (tracePendingAction.serverId !== action.serverId) {
    errors.push('Permission-required completion trace pendingAction serverId must match the run pendingAction.')
  }
  if (tracePendingAction.source !== action.source) {
    errors.push('Permission-required completion trace pendingAction source must match the run pendingAction.')
  }
}

function auditWaitingPendingActionStepAttribution(
  run: AgentWorkflowRun,
  completionTrace: ProcessTrace | undefined,
  errors: string[]
): void {
  if (run.status !== 'waiting') return
  const action = run.pendingAction
  if (!action) return
  const tracePendingAction = completionTrace?.metadata?.pendingAction
  if (!isPendingActionMetadata(tracePendingAction)) return
  const expectedStep = action.reason === 'step_limit_reached'
    ? undefined
    : run.steps.find((step) => step.id === action.stepId) ?? run.steps[run.steps.length - 1]

  if (!isNonEmptyString(action.stepId)) {
    errors.push('Waiting agent workflow pending action must record stepId.')
  }
  if (!isNonEmptyString(action.stepTitle)) {
    errors.push('Waiting agent workflow pending action must record stepTitle.')
  }
  if (!isNonNegativeInteger(action.stepNumber) || action.stepNumber < 1) {
    errors.push('Waiting agent workflow pending action must record stepNumber.')
  }
  const stepNumber = isNonNegativeInteger(action.stepNumber) ? action.stepNumber : undefined
  if (!isNonNegativeInteger(action.planStepCount) || stepNumber === undefined || action.planStepCount < stepNumber) {
    errors.push('Waiting agent workflow pending action must record planStepCount for the attributed step.')
  }
  if (expectedStep && action.stepId !== expectedStep.id) {
    errors.push('Waiting agent workflow pending action stepId must match the paused step.')
  }
  if (expectedStep && action.stepTitle !== safeStepTitle(expectedStep.title)) {
    errors.push('Waiting agent workflow pending action stepTitle must match the paused step.')
  }
  if (action.reason === 'step_limit_reached' && isNonNegativeInteger(action.completedStepCount)) {
    if (stepNumber !== action.completedStepCount + 1) {
      errors.push('Step-limit pending action stepNumber must identify the next unexecuted step.')
    }
  }
  if (isNonEmptyString(action.suggestedUserPrompt)) {
    auditPendingActionPromptStepContext(action, errors)
  }
  auditStepLimitWorkflowPendingActionContext(action, completionTrace, tracePendingAction, errors)

  for (const key of ['stepId', 'stepTitle', 'stepNumber', 'planStepCount']) {
    if ((tracePendingAction as Record<string, unknown>)[key] !== (action as unknown as Record<string, unknown>)[key]) {
      errors.push(`Waiting agent workflow completion trace pendingAction ${key} must match the run pendingAction.`)
    }
  }
}

function auditStepLimitWorkflowPendingActionContext(
  action: NonNullable<AgentWorkflowRun['pendingAction']>,
  completionTrace: ProcessTrace | undefined,
  tracePendingAction: unknown,
  errors: string[]
): void {
  if (action.reason !== 'step_limit_reached') return
  const metadata = completionTrace?.metadata ?? {}
  const expectedWorkflowId = readNonEmptyText(metadata.workflowId)
  const expectedWorkflowName = readNonEmptyText(metadata.workflowName)
  const expectedWorkflowExpectedOutput = readNonEmptyText(metadata.workflowExpectedOutput)
  if (!expectedWorkflowId && !expectedWorkflowName && !expectedWorkflowExpectedOutput) return
  const traceAction = tracePendingAction && typeof tracePendingAction === 'object'
    ? tracePendingAction as Record<string, unknown>
    : {}

  auditMatchingWorkflowPendingActionText(action.workflowId, expectedWorkflowId, 'workflowId', errors)
  auditMatchingWorkflowPendingActionText(action.workflowName, expectedWorkflowName, 'workflowName', errors)
  auditMatchingWorkflowPendingActionText(action.workflowExpectedOutput, expectedWorkflowExpectedOutput, 'workflowExpectedOutput', errors)

  for (const [key, expected] of Object.entries({
    workflowId: expectedWorkflowId,
    workflowName: expectedWorkflowName,
    workflowExpectedOutput: expectedWorkflowExpectedOutput,
  })) {
    if (expected && traceAction[key] !== (action as unknown as Record<string, unknown>)[key]) {
      errors.push(`Step-limit completion trace pendingAction ${key} must match the run pendingAction.`)
    }
  }

  const prompt = action.suggestedUserPrompt
  if (!prompt) return
  if (expectedWorkflowName && !prompt.includes(`Workflow: ${expectedWorkflowName}`)) {
    errors.push('Step-limit pending action suggestedUserPrompt must include workflow name context.')
  }
  if (expectedWorkflowId && !prompt.includes(`Workflow id: ${expectedWorkflowId}`)) {
    errors.push('Step-limit pending action suggestedUserPrompt must include workflow id context.')
  }
  if (expectedWorkflowExpectedOutput && !prompt.includes(`Expected output: ${expectedWorkflowExpectedOutput}`)) {
    errors.push('Step-limit pending action suggestedUserPrompt must include workflow expected output context.')
  }
}

function auditMatchingWorkflowPendingActionText(
  actual: unknown,
  expected: string | undefined,
  key: string,
  errors: string[]
): void {
  if (!expected) return
  if (actual !== expected) {
    errors.push(`Step-limit pending action must record ${key} for the saved workflow.`)
  }
}

function auditPendingActionPromptStepContext(
  action: NonNullable<AgentWorkflowRun['pendingAction']>,
  errors: string[]
): void {
  const prompt = action.suggestedUserPrompt
  if (!prompt) return
  const stepNumber = isPositiveInteger(action.stepNumber) ? action.stepNumber : undefined
  const planStepCount = stepNumber !== undefined && isPositiveInteger(action.planStepCount) && action.planStepCount >= stepNumber
    ? action.planStepCount
    : undefined
  const expectedStepProgress = stepNumber
    ? planStepCount
      ? `Step: ${stepNumber}/${planStepCount}`
      : `Step: ${stepNumber}`
    : undefined
  if (expectedStepProgress && !prompt.includes(expectedStepProgress)) {
    errors.push('Waiting agent workflow pending action suggestedUserPrompt must include step progress context.')
  }
  if (isNonEmptyString(action.stepTitle) && !prompt.includes(`Step title: ${action.stepTitle}`)) {
    errors.push('Waiting agent workflow pending action suggestedUserPrompt must include step title context.')
  }
}

function auditWaitingContinuationPrompt(
  run: AgentWorkflowRun,
  completionTrace: ProcessTrace | undefined,
  errors: string[]
): void {
  if (run.status !== 'waiting') return
  const action = run.pendingAction
  if (!action || action.reason === 'permission_required') return
  if (typeof action.suggestedUserPrompt !== 'string' || !action.suggestedUserPrompt.trim()) {
    errors.push('Non-confirmable waiting agent workflow actions must include a suggested user prompt.')
  }
  if (action.reason === 'evidence_insufficient' && !isNonEmptyString(action.repairStrategy)) {
    errors.push('Evidence-insufficient pending actions must record repairStrategy.')
  }
  const tracePendingAction = completionTrace?.metadata?.pendingAction
  if (isPendingActionMetadata(tracePendingAction)) {
    const prompt = (tracePendingAction as Record<string, unknown>).suggestedUserPrompt
    if (prompt !== action.suggestedUserPrompt) {
      errors.push('Waiting agent workflow completion trace pendingAction suggestedUserPrompt must match the run pendingAction.')
    }
    if (action.reason === 'evidence_insufficient' && (tracePendingAction as Record<string, unknown>).repairStrategy !== action.repairStrategy) {
      errors.push('Evidence-insufficient completion trace pendingAction repairStrategy must match the run pendingAction.')
    }
  }
}

function auditElevatedAllowedToolTraces(run: AgentWorkflowRun, errors: string[]): void {
  for (const step of run.steps) {
    const trace = step.observation?.trace
    if (!trace || trace.status !== 'done') continue
    const metadata = trace.metadata ?? {}
    if (metadata.permission !== 'read-write' && metadata.permission !== 'destructive') continue
    if (metadata.decision !== 'allow') {
      errors.push('Elevated allowed tool traces must record decision=allow.')
    }
    if (typeof metadata.allowReason !== 'string' || !metadata.allowReason.trim()) {
      errors.push('Elevated allowed tool traces must record allowReason.')
    }
    if (metadata.permission === 'read-write' && metadata.readWriteToolPolicy === 'visible') {
      if (metadata.allowReason !== 'visible-action' || metadata.intentVisible !== true) {
        errors.push('Read-write tool traces allowed by visible policy must record visible-action intent evidence.')
      }
    }
    if (metadata.permission === 'destructive' && metadata.destructiveToolPolicy === 'confirm') {
      if (metadata.allowReason !== 'user-confirmed' || metadata.userConfirmed !== true) {
        errors.push('Destructive tool traces allowed by confirm policy must record user-confirmed evidence.')
      }
    }
  }
}

function auditWorkArtifactRunTrace(run: AgentWorkflowRun, errors: string[]): void {
  if (run.status !== 'done') return

  const workArtifactSteps = run.steps.filter((step) => (
    step.toolRequest?.toolId === 'work-artifact:summarize' ||
    step.toolRequest?.name === 'work_artifact.summarize' ||
    step.observation?.trace.metadata?.source === 'work-artifact'
  ))
  if (!workArtifactSteps.length) {
    if (run.intent === 'work_artifact') {
      errors.push('Work artifact workflow runs must execute the work-artifact summarizer.')
    }
    return
  }
  const requiresCompleteWorkArtifact = run.intent === 'work_artifact'

  const outputQuality = workArtifactSteps
    .map((step) => parseWorkArtifactQualityEvidence(step.observation?.trace.metadata?.workArtifactOutput, step.observation?.output))
    .find((audit) => audit.found)
  if (!outputQuality?.found) {
    errors.push('Work artifact workflow observations must include qualityAudit, evidenceCount, primaryNextStep, qualitySummary, and followUpPrompt fields.')
  } else if (requiresCompleteWorkArtifact && outputQuality.ok !== true) {
    errors.push('Work artifact workflow qualityAudit must pass before the run can be marked done.')
  } else {
    if (outputQuality.contract !== WORK_ARTIFACT_WORKFLOW_CONTRACT) {
      errors.push('Work artifact workflow observations must record the v1 output contract.')
    }
    if (!outputQuality.hasArtifactFields) {
      errors.push('Work artifact workflow observations must expose first-class artifact fields.')
    }
    if (!Array.isArray(outputQuality.qualityGaps)) {
      errors.push('Work artifact workflow observations must include qualityGaps.')
    } else if (outputQuality.ok === false && outputQuality.qualityGaps.length < 1) {
      errors.push('Incomplete handoff or diagnostic work artifact observations must expose quality gaps.')
    }
    if (!Array.isArray(outputQuality.sourceEvidence)) {
      errors.push('Work artifact workflow observations must include sourceEvidence.')
    }
    if (!isNonNegativeInteger(outputQuality.evidenceCount)) {
      errors.push('Work artifact workflow evidenceCount must be a non-negative integer.')
    } else if (requiresCompleteWorkArtifact && outputQuality.evidenceCount < 1) {
      errors.push('Work artifact workflow must include source evidence before the run can be marked done.')
    }
    if (requiresCompleteWorkArtifact && !isNonEmptyString(outputQuality.primaryNextStep)) {
      errors.push('Work artifact workflow must expose a primaryNextStep before the run can be marked done.')
    }
    if (!isNonEmptyString(outputQuality.qualitySummary)) {
      errors.push('Work artifact workflow must include a qualitySummary before the run can be marked done.')
    }
    if (!isNonEmptyString(outputQuality.followUpPrompt)) {
      errors.push('Work artifact workflow must include a followUpPrompt before the run can be marked done.')
    }
  }

  const missingOutputFields = outputQuality?.missingFields ?? []
  for (const field of missingOutputFields) {
    if (!requiresCompleteWorkArtifact && field === 'primaryNextStep') continue
    errors.push(`Work artifact workflow observations must include ${field}.`)
  }

  const legacyOutputAudit = workArtifactSteps
    .map((step) => parseWorkArtifactQualityAudit(step.observation?.trace.metadata?.workArtifactOutput, step.observation?.output))
    .find((audit) => audit.found)
  if (requiresCompleteWorkArtifact && legacyOutputAudit?.found && legacyOutputAudit.ok !== true) {
    errors.push('Work artifact workflow qualityAudit must pass before the run can be marked done.')
  } else if (!legacyOutputAudit?.found && !outputQuality?.found) {
    errors.push('Work artifact workflow observations must include a qualityAudit result.')
  }

  const toolTrace = run.traces.find((trace) => (
    trace.type === 'tool' &&
    (trace.metadata?.source === 'work-artifact' || trace.title.includes('work_artifact.summarize'))
  ))
  if (!toolTrace) {
    errors.push('Work artifact workflow runs must expose the work-artifact tool trace.')
    return
  }
  const toolMetadata = toolTrace.metadata ?? {}
  if (typeof toolMetadata.qualityAuditOk !== 'boolean') {
    errors.push('Work artifact tool trace must record qualityAuditOk metadata.')
  } else if (requiresCompleteWorkArtifact && toolMetadata.qualityAuditOk !== true) {
    errors.push('Work artifact tool trace qualityAuditOk must be true for a done run.')
  }
  if (!isNonNegativeInteger(toolMetadata.evidenceCount)) {
    errors.push('Work artifact tool trace must record evidenceCount metadata.')
  } else if (requiresCompleteWorkArtifact && toolMetadata.evidenceCount < 1) {
    errors.push('Work artifact tool trace evidenceCount must be at least one for a done run.')
  }
  if (requiresCompleteWorkArtifact && !isNonEmptyString(toolMetadata.primaryNextStep)) {
    errors.push('Work artifact tool trace must record primaryNextStep metadata.')
  }
  if (!isNonEmptyString(toolMetadata.qualitySummary)) {
    errors.push('Work artifact tool trace must record qualitySummary metadata.')
  }
  if (!isNonEmptyString(toolMetadata.followUpPrompt)) {
    errors.push('Work artifact tool trace must record followUpPrompt metadata.')
  }
  if (toolMetadata.contract !== WORK_ARTIFACT_WORKFLOW_CONTRACT) {
    errors.push('Work artifact tool trace must record the work artifact workflow contract.')
  }
  if (!isNonNegativeInteger(toolMetadata.sourceEvidenceCount)) {
    errors.push('Work artifact tool trace must record sourceEvidenceCount metadata.')
  }
  if (!isNonNegativeInteger(toolMetadata.qualityGapCount)) {
    errors.push('Work artifact tool trace must record qualityGapCount metadata.')
  } else if (toolMetadata.qualityAuditOk === false && toolMetadata.qualityGapCount < 1) {
    errors.push('Incomplete handoff or diagnostic work artifact tool traces must expose quality gaps.')
  }
  if (!Array.isArray(toolMetadata.qualityGapCodes)) {
    errors.push('Work artifact tool trace must record qualityGapCodes metadata.')
  } else if (toolMetadata.qualityAuditOk === false && toolMetadata.qualityGapCodes.length < 1) {
    errors.push('Incomplete handoff or diagnostic work artifact tool traces must expose quality gap codes.')
  }
  if (!Array.isArray(toolMetadata.missingKinds)) {
    errors.push('Work artifact tool trace must record missingKinds metadata.')
  }
}

function parseWorkArtifactQualityAudit(value: unknown, legacyOutput?: string): { found: boolean; ok?: boolean } {
  const parsed = parseWorkArtifactOutputValue(value, legacyOutput)
  if (!parsed) return { found: false }
  const ok = parsed.qualityAudit?.ok
  return typeof ok === 'boolean' ? { found: true, ok } : { found: false }
}

function parseWorkArtifactOutputValue(value: unknown, legacyOutput?: string): {
  qualityAudit?: { ok?: unknown }
  evidenceCount?: unknown
  primaryNextStep?: unknown
  qualitySummary?: unknown
  followUpPrompt?: unknown
  contract?: unknown
  artifact?: Record<string, unknown>
  qualityGaps?: unknown
  sourceEvidence?: unknown
} | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as ReturnType<typeof parseWorkArtifactOutputValue>
  }
  if (!legacyOutput?.trim()) return undefined
  try {
    return JSON.parse(legacyOutput) as ReturnType<typeof parseWorkArtifactOutputValue>
  } catch {
    return undefined
  }
}

function parseWorkArtifactQualityEvidence(value: unknown, legacyOutput?: string): {
  found: boolean
  ok?: boolean
  evidenceCount?: unknown
  primaryNextStep?: unknown
  qualitySummary?: unknown
  followUpPrompt?: unknown
  contract?: unknown
  qualityGaps?: unknown
  sourceEvidence?: unknown
  hasArtifactFields?: boolean
  missingFields?: string[]
} {
  const parsed = parseWorkArtifactOutputValue(value, legacyOutput)
  if (!parsed) return { found: false }
  const ok = parsed.qualityAudit?.ok
  const missingFields: string[] = []
  if (typeof ok !== 'boolean') missingFields.push('qualityAudit')
  if (typeof parsed.evidenceCount === 'undefined') missingFields.push('evidenceCount')
  if (typeof parsed.primaryNextStep === 'undefined') missingFields.push('primaryNextStep')
  if (typeof parsed.qualitySummary === 'undefined') missingFields.push('qualitySummary')
  if (typeof parsed.followUpPrompt === 'undefined') missingFields.push('followUpPrompt')
  if (typeof parsed.contract === 'undefined') missingFields.push('contract')
  if (typeof parsed.artifact === 'undefined') missingFields.push('artifact')
  if (typeof parsed.qualityGaps === 'undefined') missingFields.push('qualityGaps')
  if (typeof parsed.sourceEvidence === 'undefined') missingFields.push('sourceEvidence')
  return (
    typeof parsed.qualityAudit?.ok !== 'undefined' ||
    typeof parsed.evidenceCount !== 'undefined' ||
    typeof parsed.primaryNextStep !== 'undefined' ||
    typeof parsed.qualitySummary !== 'undefined' ||
    typeof parsed.followUpPrompt !== 'undefined' ||
    typeof parsed.contract !== 'undefined' ||
    typeof parsed.artifact !== 'undefined' ||
    typeof parsed.qualityGaps !== 'undefined' ||
    typeof parsed.sourceEvidence !== 'undefined'
  )
    ? {
        found: true,
        ok: typeof ok === 'boolean' ? ok : undefined,
        evidenceCount: parsed.evidenceCount,
        primaryNextStep: parsed.primaryNextStep,
        qualitySummary: parsed.qualitySummary,
        followUpPrompt: parsed.followUpPrompt,
        contract: parsed.contract,
        qualityGaps: parsed.qualityGaps,
        sourceEvidence: parsed.sourceEvidence,
        hasArtifactFields: hasWorkArtifactWorkflowFields(parsed.artifact),
        missingFields,
      }
    : { found: false }
}

function hasWorkArtifactWorkflowFields(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const artifact = value as Record<string, unknown>
  return (
    Array.isArray(artifact.summary) &&
    Array.isArray(artifact.actionItems) &&
    Array.isArray(artifact.decisions) &&
    Array.isArray(artifact.risks) &&
    Array.isArray(artifact.openQuestions) &&
    Array.isArray(artifact.sourceEvidence) &&
    typeof artifact.handoffText === 'string' &&
    typeof artifact.qualitySummary === 'string' &&
    typeof artifact.followUpPrompt === 'string'
  )
}

function auditRagEvidenceRunTrace(run: AgentWorkflowRun, errors: string[]): void {
  if (run.intent !== 'rag_evidence' || run.status !== 'done') return

  const ragSteps = run.steps.filter((step) => (
    step.toolRequest?.toolId === 'rag:context_pack' ||
    step.toolRequest?.name === 'rag.context_pack' ||
    step.observation?.trace.metadata?.source === 'rag'
  ))
  if (!ragSteps.length) {
    errors.push('RAG evidence workflow runs must execute the RAG context pack tool.')
    return
  }

  const outputMetrics = ragSteps
    .map((step) => parseRagEvidenceMetrics(step.observation?.output))
    .find((metrics) => metrics.found)
  if (!outputMetrics?.found) {
    errors.push('RAG evidence workflow observations must include profile, fallbackReasons, sourceCount, citationCount, confidence, and missingEvidence metrics.')
  } else {
    if (!isNonEmptyString(outputMetrics.profile)) {
      errors.push('RAG evidence workflow observations must record the retrieval profile.')
    }
    if (!isStringArray(outputMetrics.fallbackReasons)) {
      errors.push('RAG evidence workflow observations must record fallbackReasons as an array.')
    }
    if (!isNonNegativeInteger(outputMetrics.sourceCount)) {
      errors.push('RAG evidence workflow sourceCount must be a non-negative integer.')
    } else if (outputMetrics.sourceCount < 1) {
      errors.push('RAG evidence workflow must include at least one source before the run can be marked done.')
    }
    if (!isNonNegativeInteger(outputMetrics.citationCount)) {
      errors.push('RAG evidence workflow citationCount must be a non-negative integer.')
    } else if (outputMetrics.citationCount < 1) {
      errors.push('RAG evidence workflow must include at least one citation before the run can be marked done.')
    }
    if (!isUnitConfidence(outputMetrics.confidence)) {
      errors.push('RAG evidence workflow confidence must be a number between 0 and 1.')
    } else if (outputMetrics.confidence < RAG_EVIDENCE_MIN_CONFIDENCE) {
      errors.push('RAG evidence workflow confidence must meet the evidence threshold before the run can be marked done.')
    }
    if (outputMetrics.missingEvidence !== false) {
      errors.push('RAG evidence workflow missingEvidence must be false before the run can be marked done.')
    }
  }

  const retrievalTrace = run.traces.find((trace) => (
    (trace.type === 'retrieval' || trace.type === 'knowledge' || trace.type === 'memory') &&
    (trace.metadata?.source === 'rag' || trace.title.includes('rag.context_pack'))
  ))
  if (!retrievalTrace) {
    errors.push('RAG evidence workflow runs must expose the RAG retrieval trace.')
    return
  }
  const retrievalMetadata = retrievalTrace.metadata ?? {}
  if (!isNonEmptyString(retrievalMetadata.profile)) {
    errors.push('RAG retrieval trace must record profile metadata.')
  }
  if (!isStringArray(retrievalMetadata.fallbackReasons)) {
    errors.push('RAG retrieval trace must record fallbackReasons metadata as an array.')
  }
  if (!isNonNegativeInteger(retrievalMetadata.sourceCount)) {
    errors.push('RAG retrieval trace must record sourceCount metadata.')
  } else if (retrievalMetadata.sourceCount < 1) {
    errors.push('RAG retrieval trace sourceCount must be at least one for a done evidence run.')
  }
  if (!isNonNegativeInteger(retrievalMetadata.citationCount)) {
    errors.push('RAG retrieval trace must record citationCount metadata.')
  } else if (retrievalMetadata.citationCount < 1) {
    errors.push('RAG retrieval trace citationCount must be at least one for a done evidence run.')
  }
  if (!isUnitConfidence(retrievalMetadata.confidence)) {
    errors.push('RAG retrieval trace must record confidence metadata between 0 and 1.')
  } else if (retrievalMetadata.confidence < RAG_EVIDENCE_MIN_CONFIDENCE) {
    errors.push('RAG retrieval trace confidence must meet the evidence threshold for a done evidence run.')
  }
  if (retrievalMetadata.missingEvidence !== false) {
    errors.push('RAG retrieval trace missingEvidence must be false for a done evidence run.')
  }
}

function parseRagEvidenceMetrics(output: string | undefined): {
  found: boolean
  sourceCount?: unknown
  citationCount?: unknown
  confidence?: unknown
  missingEvidence?: unknown
  profile?: unknown
  fallbackReasons?: unknown
} {
  if (!output?.trim()) return { found: false }
  try {
    const parsed = JSON.parse(output) as {
      sourceCount?: unknown
      citationCount?: unknown
      confidence?: unknown
      missingEvidence?: unknown
      profile?: unknown
      fallbackReasons?: unknown
    }
    return (
      typeof parsed.sourceCount !== 'undefined' ||
      typeof parsed.citationCount !== 'undefined' ||
      typeof parsed.confidence !== 'undefined' ||
      typeof parsed.missingEvidence !== 'undefined' ||
      typeof parsed.profile !== 'undefined' ||
      typeof parsed.fallbackReasons !== 'undefined'
    )
      ? {
          found: true,
          sourceCount: parsed.sourceCount,
          citationCount: parsed.citationCount,
          confidence: parsed.confidence,
          missingEvidence: parsed.missingEvidence,
          profile: parsed.profile,
          fallbackReasons: parsed.fallbackReasons,
        }
      : { found: false }
  } catch {
    return { found: false }
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isUnitConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasStringArrayWithLength(value: unknown, expectedLength: number): value is string[] {
  return isStringArray(value) && value.length === expectedLength
}

function isKnownToolPermission(value: unknown): boolean {
  return value === 'read-only' || value === 'read-write' || value === 'destructive'
}

function parseKnownAgentToolSource(value: unknown): string | undefined {
  return value === 'mcp' || value === 'builtin' || value === 'app-action' || value === 'rag' || value === 'search' || value === 'work-artifact' || value === 'android'
    ? value
    : undefined
}

function parseKnownAgentFailureCode(value: unknown): string | undefined {
  return value === 'provider_unavailable' ||
    value === 'tool_unavailable' ||
    value === 'permission_required' ||
    value === 'schema_invalid' ||
    value === 'rag_unavailable' ||
    value === 'evidence_insufficient' ||
    value === 'cancelled' ||
    value === 'step_limit_reached' ||
    value === 'policy_denied' ||
    value === 'execution_failed'
    ? value
    : undefined
}

function readNonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function safeFailureToolText(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  return clampAgentOutput(redactSensitiveText(value.trim()), 160).replace(/\n\[output truncated\]$/, '')
}

function safeStepTitle(value: string): string {
  return clampAgentOutput(redactSensitiveText(value.trim()), 160).replace(/\n\[output truncated\]$/, '')
}

function isPendingActionMetadata(value: unknown): value is {
  id: string
  reason: string
  confirmable: boolean
  permission?: unknown
} {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' &&
    typeof record.reason === 'string' &&
    typeof record.confirmable === 'boolean'
}

function auditBoundedNumber(value: unknown, key: string, min: number, max: number, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`Agent workflow completion metadata must record ${key}.`)
    return
  }
  if (value < min || value > max) {
    errors.push(`Agent workflow completion metadata ${key} must be between ${min} and ${max}.`)
  }
}

function expectedCompletionTraceStatus(status: AgentWorkflowRun['status']): ProcessTrace['status'] {
  if (status === 'done') return 'done'
  if (status === 'error') return 'error'
  if (status === 'cancelled') return 'cancelled'
  return 'skipped'
}

function isSettledRunStatus(status: AgentWorkflowRun['status']): boolean {
  return status === 'done' || status === 'error' || status === 'waiting' || status === 'cancelled'
}

function auditSensitiveRunPayload(run: AgentWorkflowRun, errors: string[]): void {
  auditSensitiveValue(run.finalOutput, 'finalOutput', errors)
  auditSensitiveValue(run.pendingAction, 'pendingAction', errors)
  for (const trace of run.traces) {
    auditSensitiveValue(trace.title, `trace:${trace.id}:title`, errors)
    auditSensitiveValue(trace.content, `trace:${trace.id}:content`, errors)
    auditSensitiveValue(trace.metadata, `trace:${trace.id}:metadata`, errors)
  }
  for (const step of run.steps) {
    auditSensitiveValue(step.observation?.output, `step:${step.id}:output`, errors)
    auditSensitiveValue(step.observation?.blocks, `step:${step.id}:blocks`, errors)
    auditSensitiveValue(step.observation?.metadata, `step:${step.id}:metadata`, errors)
    auditSensitiveValue(step.observation?.trace.title, `step:${step.id}:trace.title`, errors)
    auditSensitiveValue(step.observation?.trace.content, `step:${step.id}:trace.content`, errors)
    auditSensitiveValue(step.observation?.trace.metadata, `step:${step.id}:trace.metadata`, errors)
  }
}

function auditSensitiveValue(value: unknown, path: string, errors: string[]): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string') {
    if (value !== '[redacted]' && containsSensitiveText(value)) {
      errors.push(`Agent workflow payload must redact sensitive text at ${path}.`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => auditSensitiveValue(item, `${path}[${index}]`, errors))
    return
  }
  if (typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveMetadataKey(key) && child !== undefined && child !== null && child !== '[redacted]') {
      errors.push(`Agent workflow payload must redact sensitive metadata key at ${path}.${key}.`)
      continue
    }
    auditSensitiveValue(child, `${path}.${key}`, errors)
  }
}

function containsSensitiveText(value: string): boolean {
  return traceContainsSensitiveText(value)
}

function isSensitiveMetadataKey(key: string): boolean {
  return isSensitiveTraceMetadataKey(key)
}
