import type { AgentPendingAction, AgentRagRuntime, AgentRequestedOutput, AgentRunLimits, AgentRuntimeLogOptions, AgentStep, AgentToolPermission, AgentToolSource, AgentWorkflowDefinition, AgentWorkflowRun } from '@/services/agent/agentToolTypes'
import type { AgentToolManifest, AgentToolRequest, AgentToolResult } from '@/services/agent/agentToolTypes'
import type { ProcessTrace } from '@/types'
import { clampAgentOutput, createAgentTrace, redactSensitiveText } from '@/services/agent/agentTrace'
import { executeAgentStep } from '@/services/agent/agentExecutor'
import type { AgentPlannedStep } from '@/services/agent/agentPlanner'
import { createAgentPlan } from '@/services/agent/agentPlanner'
import { resolveAgentRunLimits } from '@/services/agent/agentPolicy'
import { validateAgentWorkflowDefinition } from '@/services/agent/agentWorkflowDefinitions'
import { formatAgentToolRequestIdentity } from '@/services/agent/agentToolIdentityUtils'
import { st } from '@/i18n/service'

const RAG_EVIDENCE_MIN_CONFIDENCE = 0.5

export interface RunAgenticWorkflowInput {
  goal: string
  content?: string
  toolRequest?: AgentToolRequest
  requestedOutput?: AgentRequestedOutput
  workflowDefinition?: AgentWorkflowDefinition
  manifests?: AgentToolManifest[]
  ragRuntime?: AgentRagRuntime
  runtimeLog?: AgentRuntimeLogOptions
  limits?: Partial<AgentRunLimits>
  intentVisible?: boolean
  userConfirmed?: boolean
  signal?: AbortSignal
  now?: number
}

export async function runAgenticWorkflow(input: RunAgenticWorkflowInput): Promise<AgentWorkflowRun> {
  const startedAt = input.now ?? Date.now()
  const limits = resolveAgentRunLimits(input.limits)
  const run: AgentWorkflowRun = {
    id: `agent-run-${hashString(`${input.goal}:${startedAt}`).toString(36)}`,
    goal: input.goal,
    status: 'planning',
    steps: [],
    traces: [],
    startedAt,
  }

  if (input.signal?.aborted) {
    const progress = buildCancelledProgressMetadata(input.goal, 0, 0)
    return completeRun(run, 'cancelled', 'cancelled', formatCancelledOutput('Agent workflow execution was cancelled before planning.', progress), undefined, limits, progress)
  }

  const workflowDefinition = resolveExecutableWorkflowDefinition(input.workflowDefinition, input.manifests)
  if (input.workflowDefinition && !workflowDefinition) {
    return completeRun(run, 'error', 'schema_invalid', 'Agent workflow definition failed validation.', undefined, limits)
  }

  const plan = createAgentPlan({
    goal: input.goal,
    content: input.content,
    toolRequest: input.toolRequest,
    requestedOutput: input.requestedOutput,
    workflowDefinition,
    now: startedAt,
  })
  run.intent = plan.intent
  run.traces.push(plan.classification.trace)
  run.traces.push(plan.trace)
  if (!plan.shouldRunWorkflow) {
    return completeRun(run, 'done', undefined, 'Direct chat path selected by intent classification.', undefined, limits)
  }
  run.status = 'running'
  const runtimeState: WorkflowRuntimeState = {}

  for (let index = 0; index < Math.min(plan.steps.length, limits.maxSteps); index += 1) {
    if (input.signal?.aborted) {
      const progress = buildCancelledProgressMetadata(input.goal, plan.steps.length, countCompletedSteps(run.steps), plan.steps)
      return completeRun(run, 'cancelled', 'cancelled', formatCancelledOutput('Agent workflow execution was cancelled.', progress), undefined, limits, progress)
    }

    const planned = plan.steps[index]
    const bound = bindWorkflowRuntimeState(planned.toolRequest, runtimeState)
    const step = await executeAgentStep({
      id: planned.id,
      title: planned.title,
      toolRequest: bound.toolRequest,
      intentVisible: input.intentVisible,
      userConfirmed: input.userConfirmed,
      stepIndex: index,
      planStepCount: plan.steps.length,
      toolCallIndex: 0,
      limits,
      signal: input.signal,
      options: {
        manifests: input.manifests,
        ragRuntime: input.ragRuntime,
        runtimeLog: input.runtimeLog,
      },
    })
    run.steps.push(step)
    run.traces.push(...step.trace)

    if (step.status === 'cancelled') {
      const progress = buildCancelledProgressMetadata(input.goal, plan.steps.length, countCompletedSteps(run.steps), plan.steps)
      return completeRun(run, 'cancelled', 'cancelled', formatCancelledOutput(step.observation?.output, progress), undefined, limits, progress)
    }
    if (step.observation?.errorCode === 'permission_required') {
      const pendingAction = buildPendingAction(run.id, input.goal, step)
      return completeRun(run, 'waiting', 'permission_required', formatPendingActionOutput(pendingAction, step.observation.output), pendingAction, limits)
    }
    if (step.observation?.errorCode) {
      return completeRun(
        run,
        'error',
        step.observation.errorCode,
        formatToolFailureDetails(step),
        undefined,
        limits,
        undefined,
        buildFailureTraceMetadata(step)
      )
    }
    mergeWorkflowRuntimeState(runtimeState, extractWorkflowRuntimeState(step.observation))
  }

  if (plan.steps.length > limits.maxSteps) {
    const pendingAction = buildStepLimitPendingAction(run.id, input.goal, plan.steps, run.steps.length, buildWorkflowTraceMetadata(run.traces))
    return completeRun(run, 'waiting', 'step_limit_reached', formatStepLimitOutput(pendingAction), pendingAction, limits)
  }

  const finalOutput = run.steps.map((step) => step.observation?.output).filter(Boolean).join('\n\n')
  const ragEvidenceIssue = findRagEvidenceQualityIssue(run)
  if (ragEvidenceIssue) {
    const pendingAction = buildRagEvidencePendingAction(run.id, input.goal, ragEvidenceIssue)
    return completeRun(
      run,
      'waiting',
      'evidence_insufficient',
      formatRagEvidenceRepairOutput(pendingAction, ragEvidenceIssue, finalOutput),
      pendingAction,
      limits,
      undefined,
      {
        ...(ragEvidenceIssue.stepAttribution ?? {}),
        repairNextStep: pendingAction.blockedReason,
      }
    )
  }
  return completeRun(run, 'done', undefined, finalOutput || 'Agent workflow completed.', undefined, limits)
}

interface RagEvidenceQualityIssue {
  sourceCount?: unknown
  citationCount?: unknown
  confidence?: unknown
  missingEvidence?: unknown
  profile?: unknown
  profileSource?: unknown
  profileReason?: unknown
  warnings?: unknown
  reasons: string[]
  rawOutput?: string
  stepAttribution?: PendingActionStepAttribution
}

interface AgentRunProgressTraceMetadata {
  planStepCount: number
  completedStepCount: number
  remainingStepCount: number
  cancelledAtStepTitle?: string
  cancelledAtStepNumber?: number
  nextStepTitle?: string
  nextStepNumber?: number
  cancelledContinuationPrompt?: string
}

interface AgentFailureTraceMetadata extends PendingActionStepAttribution {
  failedStepId?: string
  failedStepTitle?: string
  failedStepNumber?: number
  failedPlanStepCount?: number
  failedToolName?: string
  failedToolId?: string
  failedToolSource?: AgentToolSource
  failedToolErrorCode?: AgentToolResult['errorCode']
  repairNextStep?: string
}

interface PendingActionStepAttribution {
  stepId?: string
  stepTitle?: string
  stepNumber?: number
  planStepCount?: number
}

interface WorkflowTraceMetadata {
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
}

interface WorkflowRuntimeState {
  directoryUri?: string
  operations?: unknown[]
  undoOperations?: unknown[]
}

interface AndroidUndoFollowUp {
  count: number
  toolName: 'android.files.undo_operations'
  summary: string
}

function bindWorkflowRuntimeState(
  request: AgentToolRequest | undefined,
  state: WorkflowRuntimeState
): { toolRequest?: AgentToolRequest } {
  if (!request) return { toolRequest: request }
  const ref = formatToolRequestRef(request)
  const args = { ...(request.arguments ?? {}) }
  let changed = false

  if (isAndroidSafDirectoryRef(ref) && !hasTextArgument(args.directoryUri) && state.directoryUri) {
    args.directoryUri = state.directoryUri
    changed = true
  }
  if (isAndroidApplyOperationsRef(ref) && !hasArrayItems(args.operations) && state.operations?.length) {
    args.operations = state.operations
    changed = true
  }
  if (isAndroidUndoOperationsRef(ref) && !hasArrayItems(args.undoOperations) && state.undoOperations?.length) {
    args.undoOperations = state.undoOperations
    changed = true
  }

  return changed
    ? { toolRequest: { ...request, arguments: args } }
    : { toolRequest: request }
}

function extractWorkflowRuntimeState(result: AgentToolResult | undefined): WorkflowRuntimeState {
  if (!result?.ok) return {}
  const output = parseJsonObject(result.output)
  if (!output) return {}
  const directoryUri = readString(output.directoryUri)
  const operations = readArray(output.operations) ?? readArray(output.operationPreview)
  const undoOperations = readArray(output.undoOperations)
  return {
    ...(directoryUri ? { directoryUri } : {}),
    ...(operations?.length ? { operations } : {}),
    ...(undoOperations?.length ? { undoOperations } : {}),
  }
}

function mergeWorkflowRuntimeState(target: WorkflowRuntimeState, source: WorkflowRuntimeState): void {
  if (source.directoryUri) target.directoryUri = source.directoryUri
  if (source.operations?.length) target.operations = source.operations
  if (source.undoOperations?.length) target.undoOperations = source.undoOperations
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function hasTextArgument(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasArrayItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function formatToolRequestRef(request: AgentToolRequest): string {
  return formatAgentToolRequestIdentity(request)
}

function isAndroidPreviewOperationsRef(ref: string): boolean {
  return ref.includes('android:files.preview_operations') || ref.includes('android.files.preview_operations')
}

function isAndroidSafDirectoryRef(ref: string): boolean {
  return ref.includes('android:files.scan') ||
    ref.includes('android.files.scan') ||
    ref.includes('android:files.propose_structure') ||
    ref.includes('android.files.propose_structure') ||
    isAndroidPreviewOperationsRef(ref)
}

function isAndroidApplyOperationsRef(ref: string): boolean {
  return ref.includes('android:files.apply_operations') || ref.includes('android.files.apply_operations')
}

function isAndroidUndoOperationsRef(ref: string): boolean {
  return ref.includes('android:files.undo_operations') || ref.includes('android.files.undo_operations')
}

function resolveExecutableWorkflowDefinition(
  workflow: AgentWorkflowDefinition | undefined,
  manifests: AgentToolManifest[] | undefined
): AgentWorkflowDefinition | undefined {
  if (!workflow) return undefined
  if (!manifests) return workflow.enabled ? workflow : undefined
  const validation = validateAgentWorkflowDefinition(workflow, manifests)
  if (!validation.ok || !validation.sanitized?.enabled) return undefined
  return validation.sanitized
}

function completeRun(
  run: AgentWorkflowRun,
  status: AgentWorkflowRun['status'],
  failureCode?: AgentWorkflowRun['failureCode'],
  finalOutput?: string,
  pendingAction?: AgentPendingAction,
  limits?: AgentRunLimits,
  progressMetadata?: AgentRunProgressTraceMetadata,
  failureMetadata?: AgentFailureTraceMetadata
): AgentWorkflowRun {
  const completedAt = Date.now()
  const failureNextStep = status === 'error' ? resolveFailureNextStep(failureCode, finalOutput) : undefined
  const undoFollowUp = status === 'done' || status === 'error' ? buildAndroidUndoFollowUp(run) : undefined
  const stepStatusMetadata = buildStepStatusMetadata(run.steps)
  const workflowTraceMetadata = buildWorkflowTraceMetadata(run.traces)
  const rawOutput = status === 'error'
    ? formatFailureOutput(failureCode, finalOutput)
    : appendAndroidUndoFollowUp(finalOutput?.trim(), undoFollowUp)
  const output = finalizeAgentRunOutput(rawOutput, limits, failureNextStep)
  run.status = status
  run.completedAt = completedAt
  run.failureCode = failureCode
  run.finalOutput = output
  run.pendingAction = pendingAction
  run.traces.push(createAgentTrace({
    id: `${run.id}-synthesis`,
    type: 'reasoning',
    title: 'Agent synthesis',
    content: formatAgentSynthesisTraceContent(status, failureCode, output, pendingAction),
    status: 'done',
    startedAt: run.startedAt,
    completedAt,
    metadata: {
      status,
      failureCode,
      outputSummary: output ? clampAgentOutput(redactSensitiveText(output), 420) : status,
      outputCharCount: output?.length ?? 0,
      ...stepStatusMetadata,
      ...workflowTraceMetadata,
      pendingActionReason: pendingAction?.reason,
      ...(failureNextStep ? { failureNextStep } : {}),
      ...failureMetadata,
      ...androidUndoFollowUpMetadata(undoFollowUp),
      ...progressMetadata,
    },
  }))
  run.traces.push(createAgentTrace({
    id: `${run.id}-complete`,
    type: 'system',
    title: 'Agent workflow',
    content: output || status,
    status: status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' : status === 'waiting' ? 'skipped' : 'error',
    startedAt: run.startedAt,
    completedAt,
    metadata: {
      status,
      failureCode,
      stepCount: run.steps.length,
      ...stepStatusMetadata,
      ...workflowTraceMetadata,
      ...agentRunLimitMetadata(limits),
      ...(failureNextStep ? { failureNextStep } : {}),
      ...failureMetadata,
      ...androidUndoFollowUpMetadata(undoFollowUp),
      ...progressMetadata,
      pendingAction,
    },
  }))
  return run
}

function buildStepStatusMetadata(steps: AgentStep[]): Record<string, number> {
  const counts = steps.reduce((acc, step) => {
    acc[step.status] = (acc[step.status] ?? 0) + 1
    return acc
  }, {} as Record<AgentStep['status'], number>)
  return {
    pendingStepCount: counts.pending ?? 0,
    runningStepCount: counts.running ?? 0,
    doneStepCount: counts.done ?? 0,
    errorStepCount: counts.error ?? 0,
    cancelledStepCount: counts.cancelled ?? 0,
    skippedStepCount: counts.skipped ?? 0,
  }
}

function buildWorkflowTraceMetadata(traces: ProcessTrace[]): WorkflowTraceMetadata {
  const planTrace = traces.find((trace) => trace.title === 'Agent plan' && trace.metadata?.source === 'agent-workflow-skill')
  if (!planTrace?.metadata) return {}
  const workflowId = formatWorkflowTraceText(planTrace.metadata.workflowId)
  const workflowName = formatWorkflowTraceText(planTrace.metadata.workflowName)
  const workflowExpectedOutput = formatWorkflowTraceText(planTrace.metadata.workflowExpectedOutput)
  return {
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

function formatWorkflowTraceText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return clampAgentOutput(redactSensitiveText(value.trim()), 160).replace(/\n\[output truncated\]$/, '')
}

function buildAndroidUndoFollowUp(run: AgentWorkflowRun): AndroidUndoFollowUp | undefined {
  const undoOperations = run.steps
    .map((step) => parseJsonObject(step.observation?.output))
    .map((output) => readArray(output?.undoOperations))
    .find((items) => items?.length)
  if (!undoOperations?.length) return undefined
  return {
    count: undoOperations.length,
    toolName: 'android.files.undo_operations',
    summary: `Undo available for ${undoOperations.length} reversible Android SAF move operation(s). Reversal must use android.files.undo_operations from a visible user confirmation; delete-based undo remains unsupported.`,
  }
}

function appendAndroidUndoFollowUp(output: string | undefined, followUp: AndroidUndoFollowUp | undefined): string | undefined {
  if (!followUp) return output
  return [
    output,
    [
      'Android undo available.',
      `Undo operations: ${followUp.count}`,
      'Requires visible confirmation through android.files.undo_operations.',
      'Delete-based undo remains unsupported.',
    ].join('\n'),
  ].filter(Boolean).join('\n\n')
}

function androidUndoFollowUpMetadata(followUp: AndroidUndoFollowUp | undefined): Record<string, unknown> {
  if (!followUp) return {}
  return {
    androidUndoOperationCount: followUp.count,
    androidUndoToolName: followUp.toolName,
    androidUndoRequiresVisibleConfirmation: true,
    androidUndoSummary: followUp.summary,
  }
}

function finalizeAgentRunOutput(
  output: string | undefined,
  limits: AgentRunLimits | undefined,
  requiredNextStep?: string
): string | undefined {
  const redacted = redactSensitiveText(output?.trim() ?? '')
  if (!redacted) return undefined
  const limit = limits?.outputCharLimit
  if (typeof limit !== 'number' || !Number.isFinite(limit) || redacted.length <= limit) return redacted
  const androidUndoSuffix = extractAndroidUndoFollowUpSuffix(redacted)
  if (androidUndoSuffix) {
    const suffix = `\n\n${androidUndoSuffix}`
    if (suffix.length >= limit) return clampAgentOutput(androidUndoSuffix, limit)
    const body = redacted.slice(0, redacted.lastIndexOf(androidUndoSuffix)).trimEnd()
    return `${clampAgentOutputWithExactLimit(body, limit - suffix.length)}${suffix}`
  }
  const nextStepLine = requiredNextStep?.trim()
    ? `Next step: ${clampAgentOutput(redactSensitiveText(requiredNextStep.trim()), 240).replace(/\n\[output truncated\]$/, '')}`
    : ''
  if (!nextStepLine) {
    return clampAgentOutput(redacted, limit)
  }
  const existingNextStepPattern = new RegExp(`^${escapeRegExp(nextStepLine)}$`, 'm')
  const suffix = `\n\n${nextStepLine}`
  if (suffix.length >= limit) return clampAgentOutput(nextStepLine, limit)
  const bodySource = existingNextStepPattern.test(redacted)
    ? redacted.replace(existingNextStepPattern, '').replace(/\n{3,}/g, '\n\n').trim()
    : redacted
  const body = clampAgentOutputWithExactLimit(bodySource, limit - suffix.length)
  return `${body}${suffix}`
}

function extractAndroidUndoFollowUpSuffix(output: string): string | undefined {
  const marker = 'Android undo available.'
  const start = output.lastIndexOf(marker)
  return start >= 0 ? output.slice(start).trim() : undefined
}

function clampAgentOutputWithExactLimit(value: string, limit: number): string {
  if (value.length <= limit) return value
  const marker = '\n[output truncated]'
  if (limit <= marker.length) return value.slice(0, Math.max(0, limit))
  return `${value.slice(0, Math.max(0, limit - marker.length))}${marker}`
}

function formatAgentSynthesisTraceContent(
  status: AgentWorkflowRun['status'],
  failureCode: AgentWorkflowRun['failureCode'] | undefined,
  output: string | undefined,
  pendingAction: AgentPendingAction | undefined
): string {
  const statusLine = failureCode ? `${status}:${failureCode}` : status
  const pendingLine = pendingAction ? `Pending action: ${pendingAction.reason}.` : ''
  const outputLine = output ? clampAgentOutput(redactSensitiveText(output), 700) : 'No final output body was produced.'
  return [
    `Final response synthesis prepared for ${statusLine}.`,
    pendingLine,
    outputLine,
  ].filter(Boolean).join('\n')
}

function formatFailureOutput(
  failureCode: AgentWorkflowRun['failureCode'] | undefined,
  finalOutput: string | undefined
): string {
  const body = redactSensitiveText(finalOutput?.trim() || 'No failure details were returned.')
  if (/^Agentic workflow failed\./m.test(body) && /Next step:/i.test(body)) return body
  const reason = failureCode ?? 'execution_failed'
  const nextStep = extractVisibleNextStep(body) ?? buildFailureNextStep(reason)
  return [
    'Agentic workflow failed.',
    `Reason: ${reason}`,
    '',
    body,
    '',
    extractVisibleNextStep(body) ? '' : `Next step: ${nextStep}`,
  ].filter(Boolean).join('\n')
}

function formatToolFailureDetails(step: AgentStep): string {
  const observation = step.observation
  const toolName = step.toolRequest?.name ?? step.toolRequest?.toolId ?? observation?.trace.metadata?.toolId
  const toolSource = step.toolRequest?.source ?? observation?.trace.metadata?.source
  const detail = observation?.output?.trim() || 'Tool execution returned no detail.'
  const androidRecovery = formatAndroidPartialFailureRecovery(detail)
  return [
    toolName ? `Tool: ${toolName}` : '',
    toolSource ? `Source: ${toolSource}` : '',
    ...androidRecovery,
    `${androidRecovery.length ? 'Raw detail' : 'Detail'}: ${clampAgentOutput(redactSensitiveText(detail), androidRecovery.length ? 700 : 900)}`,
  ].filter(Boolean).join('\n')
}

function resolveFailureNextStep(
  failureCode: AgentWorkflowRun['failureCode'] | undefined,
  finalOutput: string | undefined
): string {
  return extractVisibleNextStep(finalOutput) ?? buildFailureNextStep(failureCode)
}

function extractVisibleNextStep(value: string | undefined): string | undefined {
  const match = value?.match(/^Next step:\s*(.+)$/im)
  return match?.[1]?.trim()
    ? clampAgentOutput(redactSensitiveText(match[1].trim()), 240)
    : undefined
}

function formatAndroidPartialFailureRecovery(detail: string): string[] {
  const parsed = parseJsonObject(detail)
  if (parsed?.partialFailure !== true) return []
  const failedOperationId = readString(parsed.failedOperationId)
  const applied = readNumber(parsed.applied)
  const skipped = readNumber(parsed.skipped)
  const failureCount = readNumber(parsed.failureCount)
  const undoCount = readArray(parsed.undoOperations)?.length ?? 0
  const nextStep = readString(parsed.nextStep)
  return [
    'Android partial file operation failure.',
    applied !== undefined ? `Applied before failure: ${applied}` : '',
    skipped !== undefined ? `Skipped operations: ${skipped}` : '',
    failureCount !== undefined ? `Failed operations: ${failureCount}` : '',
    failedOperationId ? `Failed operation: ${clampAgentOutput(redactSensitiveText(failedOperationId), 160)}` : '',
    undoCount ? `Undo operations available: ${undoCount}` : '',
    undoCount ? 'Undo requires visible confirmation through android.files.undo_operations.' : '',
    parsed.deleteSupported === false ? 'Delete-based rollback remains unsupported.' : '',
    `Next step: ${clampAgentOutput(redactSensitiveText(nextStep || buildFailureNextStep('execution_failed')), 240)}`,
  ].filter(Boolean)
}

function buildFailureNextStep(failureCode: AgentWorkflowRun['failureCode'] | undefined): string {
  switch (failureCode) {
    case 'provider_unavailable':
      return 'Configure an available provider, then retry the workflow.'
    case 'tool_unavailable':
      return 'Enable the tool or choose another available tool, then rerun the workflow.'
    case 'schema_invalid':
      return 'Fix the workflow definition or tool arguments, then rerun within the same permission limits.'
    case 'rag_unavailable':
      return 'Enable the RAG runtime or use a workflow that does not require retrieval.'
    case 'policy_denied':
      return 'Adjust the visible permission policy or choose a safer tool path.'
    case 'execution_failed':
    default:
      return 'Review the failed tool output, keep user state intact, and retry only the failed workflow path.'
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function agentRunLimitMetadata(limits: AgentRunLimits | undefined): Record<string, unknown> {
  if (!limits) return {}
  return {
    maxStepCount: limits.maxSteps,
    maxToolCallsPerStep: limits.maxToolCallsPerStep,
    outputCharLimit: limits.outputCharLimit,
    readOnlyToolsAllowed: limits.allowReadOnlyTools,
    readWriteToolPolicy: limits.allowReadWriteTools,
    destructiveToolPolicy: limits.allowDestructiveTools,
    backgroundContinuationAllowed: limits.allowBackgroundContinuation,
    traceRequired: limits.requireTrace,
  }
}

function buildPendingAction(runId: string, goal: string, step: AgentStep): AgentPendingAction | undefined {
  const request = step.toolRequest
  if (!request) return undefined
  const metadata = step.observation?.trace.metadata ?? {}
  const permission = parsePermission(metadata.permission)
  const source = parseToolSource(metadata.source ?? request.source)
  const toolName = typeof request.name === 'string' ? request.name : undefined
  const toolId = typeof request.toolId === 'string' ? request.toolId : typeof metadata.toolId === 'string' ? metadata.toolId : undefined
  const serverId = typeof request.serverId === 'string' ? request.serverId : typeof metadata.serverId === 'string' ? metadata.serverId : undefined
  const argumentsPreview = source === 'android'
    ? summarizeAndroidArgumentsPreview(toolName, request.arguments)
    : summarizeArgumentsPreview(request.arguments)
  const resumeToolRequest = canPersistResumeRequest(request) ? sanitizeResumeToolRequest(request) : undefined
  const actionLabel = toolName ?? toolId ?? 'agent tool'
  const androidCopy = source === 'android' ? buildAndroidPendingActionCopy(toolName, request.arguments) : undefined
  const blockedReason = resumeToolRequest ? undefined : 'Tool arguments are not safe to persist for one-tap confirmation.'
  const fallbackSummary = step.observation?.output || `The workflow needs confirmation before ${actionLabel} can run.`
  const stepAttribution = buildStepAttributionFromStep(step)
  const suggestedUserPrompt = resumeToolRequest ? undefined : buildPendingActionPromptWithStepContext(
    buildPermissionRequiredSuggestedPrompt(goal, actionLabel, permission, source, argumentsPreview, blockedReason, fallbackSummary),
    stepAttribution
  )
  return {
    id: `agent-pending-${hashString(`${runId}:${step.id}:${actionLabel}`)}`,
    reason: 'permission_required',
    title: androidCopy?.title ?? `Confirm ${actionLabel}`,
    summary: clampAgentOutput(redactSensitiveText(androidCopy?.summary ? `${androidCopy.summary}\n\n${fallbackSummary}` : fallbackSummary), 900),
    toolName,
    toolId,
    serverId,
    source,
    permission,
    argumentsPreview,
    confirmable: Boolean(resumeToolRequest),
    resumeToolRequest,
    blockedReason,
    ...stepAttribution,
    suggestedUserPrompt,
    createdAt: Date.now(),
  }
}

function buildPermissionRequiredSuggestedPrompt(
  goal: string,
  actionLabel: string,
  permission: AgentToolPermission | undefined,
  source: AgentToolSource | undefined,
  argumentsPreview: string | undefined,
  blockedReason: string | undefined,
  fallbackSummary: string
): string {
  return clampAgentOutput(redactSensitiveText([
    'Review the paused permission-required agentic workflow.',
    `Original goal: ${goal}`,
    `Tool: ${actionLabel}`,
    permission ? `Permission: ${permission}` : '',
    source ? `Source: ${source}` : '',
    argumentsPreview ? `Arguments: ${argumentsPreview}` : '',
    blockedReason ? `Blocked confirmation: ${blockedReason}` : '',
    'Restart only the visible permission step, keep tool arguments inspectable, and ask for explicit confirmation before any write or destructive action.',
    fallbackSummary ? `Previous result: ${fallbackSummary}` : '',
  ].filter(Boolean).join('\n')), 900)
}

function buildAndroidPendingActionCopy(toolName: string | undefined, args: Record<string, unknown> | undefined): {
  title: string
  summary: string
} | undefined {
  switch (toolName) {
    case 'android.files.request_directory_access':
      return {
        title: st('messageBubble.androidPendingDirectoryAccessTitle', undefined, 'Grant Android directory access'),
        summary: st('messageBubble.androidPendingDirectoryAccessSummary', undefined, 'IsleMind must open the Android directory picker. Access is limited to the folder you select, such as Download; raw storage paths and full-phone storage permission are not used.'),
      }
    case 'android.files.apply_operations':
      return {
        title: st('messageBubble.androidPendingApplyFilesTitle', undefined, 'Review and apply Android file changes'),
        summary: st('messageBubble.androidPendingApplyFilesSummary', { count: countArrayItems(args?.operations) }, 'Applies {{count}} user-authorized SAF file operation(s). Delete operations are refused, raw filesystem paths are blocked, and successful move operations can return undo operations.'),
      }
    case 'android.files.undo_operations':
      return {
        title: st('messageBubble.androidPendingUndoFilesTitle', undefined, 'Confirm Android file undo'),
        summary: st('messageBubble.androidPendingUndoFilesSummary', { count: countArrayItems(args?.undoOperations) }, 'Applies {{count}} saved undo operation(s) inside the user-authorized SAF tree. Delete operations remain unsupported.'),
      }
    case 'android.apk.open_installer':
      return {
        title: st('messageBubble.androidPendingApkInstallerTitle', undefined, 'Open Android APK installer'),
        summary: st('messageBubble.androidPendingApkInstallerSummary', undefined, 'IsleMind can only hand the APK to the Android system installer. The system installer requires your confirmation; silent install is unsupported.'),
      }
    case 'android.storage.clear_app_cache':
      return {
        title: st('messageBubble.androidPendingClearCacheTitle', undefined, 'Clear IsleMind app cache'),
        summary: st('messageBubble.androidPendingClearCacheSummary', undefined, 'Only IsleMind app-cache entries are eligible. User files, arbitrary shared storage cleanup, and full-phone cleaning are unsupported.'),
      }
    case 'android.alarm.open_create_intent':
      return {
        title: st('messageBubble.androidPendingAlarmTitle', undefined, 'Open Android alarm editor'),
        summary: st('messageBubble.androidPendingAlarmSummary', undefined, 'IsleMind opens the Android clock UI with the requested alarm fields. The alarm is created only after you confirm it in the system app.'),
      }
    case 'android.notifications.open_settings':
      return {
        title: st('messageBubble.androidPendingNotificationSettingsTitle', undefined, 'Open Android notification settings'),
        summary: st('messageBubble.androidPendingNotificationSettingsSummary', undefined, 'IsleMind opens Android notification-related system settings for this app. Final notification permission or promoted-notification changes still happen in the system UI.'),
      }
    case 'android.calendar.open_create_event':
    case 'android.reminder.open_create_todo':
      return {
        title: st('messageBubble.androidPendingCalendarTitle', undefined, 'Open Android calendar editor'),
        summary: st('messageBubble.androidPendingCalendarSummary', undefined, 'IsleMind opens the Android calendar UI with the requested entry fields. The reminder or event is created only after you confirm it in the system app.'),
      }
    default:
      return undefined
  }
}

function countArrayItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function formatPendingActionOutput(pendingAction: AgentPendingAction | undefined, fallback: string): string {
  if (!pendingAction) return fallback
  return [
    st('messageBubble.agentPendingOutputTitle', undefined, 'Action needs confirmation.'),
    pendingAction.title,
    pendingAction.stepTitle ? st('messageBubble.agentPendingOutputStep', { step: pendingAction.stepTitle }, 'Step: {{step}}') : '',
    pendingAction.argumentsPreview ? st('messageBubble.agentPendingOutputDetails', { details: pendingAction.argumentsPreview }, 'Details: {{details}}') : '',
    pendingAction.confirmable
      ? st('messageBubble.agentPendingOutputConfirmable', undefined, 'Use the visible confirmation action to continue.')
      : st('messageBubble.agentPendingOutputUnavailable', { reason: pendingAction.blockedReason }, 'Confirmation unavailable: {{reason}}'),
    '',
    pendingAction.summary,
  ].filter(Boolean).join('\n')
}

function buildStepAttributionFromStep(step: AgentStep): PendingActionStepAttribution {
  const metadata = step.observation?.trace.metadata ?? {}
  const stepNumber = readPositiveInteger(metadata.stepNumber)
  const planStepCount = readPositiveInteger(metadata.planStepCount)
  return {
    stepId: step.id,
    stepTitle: formatPendingActionStepTitle(step.title),
    ...(stepNumber ? { stepNumber } : {}),
    ...(planStepCount ? { planStepCount } : {}),
  }
}

function buildFailureTraceMetadata(step: AgentStep): AgentFailureTraceMetadata {
  const attribution = buildStepAttributionFromStep(step)
  const toolAttribution = buildFailureToolAttributionFromStep(step)
  return {
    ...attribution,
    ...(attribution.stepId ? { failedStepId: attribution.stepId } : {}),
    ...(attribution.stepTitle ? { failedStepTitle: attribution.stepTitle } : {}),
    ...(attribution.stepNumber ? { failedStepNumber: attribution.stepNumber } : {}),
    ...(attribution.planStepCount ? { failedPlanStepCount: attribution.planStepCount } : {}),
    ...toolAttribution,
  }
}

function buildFailureToolAttributionFromStep(step: AgentStep): Pick<AgentFailureTraceMetadata, 'failedToolName' | 'failedToolId' | 'failedToolSource' | 'failedToolErrorCode'> {
  const observation = step.observation
  const metadata = observation?.trace.metadata ?? {}
  const failedToolName = formatFailureToolTraceText(
    step.toolRequest?.name ??
    step.toolRequest?.toolId ??
    readTextMetric(metadata.toolName) ??
    readTextMetric(metadata.toolId)
  )
  const failedToolId = formatFailureToolTraceText(
    step.toolRequest?.toolId ??
    readTextMetric(metadata.toolId)
  )
  const failedToolSource = parseToolSource(step.toolRequest?.source ?? metadata.toolSource ?? metadata.source)
  const failedToolErrorCode = parseFailureErrorCode(observation?.errorCode ?? metadata.errorCode)
  return {
    ...(failedToolName ? { failedToolName } : {}),
    ...(failedToolId ? { failedToolId } : {}),
    ...(failedToolSource ? { failedToolSource } : {}),
    ...(failedToolErrorCode ? { failedToolErrorCode } : {}),
  }
}

function buildStepAttributionFromPlannedStep(
  step: { id: string; title: string } | undefined,
  stepIndex: number,
  planStepCount: number
): PendingActionStepAttribution {
  if (!step) return {}
  return {
    stepId: step.id,
    stepTitle: formatPendingActionStepTitle(step.title),
    stepNumber: Math.max(0, stepIndex) + 1,
    planStepCount,
  }
}

function formatPendingActionStepTitle(value: string): string {
  return clampAgentOutput(redactSensitiveText(value.trim()), 160).replace(/\n\[output truncated\]$/, '')
}

function formatFailureToolTraceText(value: string | undefined, limit = 160): string | undefined {
  if (!value?.trim()) return undefined
  return clampAgentOutput(redactSensitiveText(value.trim()), limit).replace(/\n\[output truncated\]$/, '')
}

function buildPendingActionPromptWithStepContext(
  prompt: string | undefined,
  stepAttribution: PendingActionStepAttribution,
  workflowMetadata: WorkflowTraceMetadata = {}
): string | undefined {
  if (!prompt) return undefined
  const stepContext = formatPendingActionStepContext(
    stepAttribution.stepTitle,
    stepAttribution.stepNumber,
    stepAttribution.planStepCount
  )
  const workflowContext = formatPendingActionWorkflowContext(workflowMetadata)
  const suffix = [
    workflowContext && !prompt.includes(workflowContext) ? workflowContext : '',
    stepContext && !prompt.includes(stepContext) ? stepContext : '',
  ].filter(Boolean).join('\n')
  if (!suffix) return prompt
  const suffixBlock = `\n${suffix}`
  if (suffixBlock.length >= 900) return clampAgentOutput(redactSensitiveText(suffix).trim(), 900)
  const body = clampAgentOutputWithExactLimit(redactSensitiveText(prompt).trim(), 900 - suffixBlock.length).trim()
  return `${body}${suffixBlock}`.trim()
}

function formatPendingActionWorkflowContext(workflowMetadata: WorkflowTraceMetadata): string {
  return [
    workflowMetadata.workflowName ? `Workflow: ${workflowMetadata.workflowName}` : '',
    workflowMetadata.workflowId ? `Workflow id: ${workflowMetadata.workflowId}` : '',
    workflowMetadata.workflowExpectedOutput ? `Expected output: ${workflowMetadata.workflowExpectedOutput}` : '',
  ].filter(Boolean).join('\n')
}

function formatPendingActionStepContext(
  stepTitle: string | undefined,
  stepNumber: number | undefined,
  planStepCount: number | undefined
): string {
  const safeStepNumber = readPositiveInteger(stepNumber)
  const parsedPlanStepCount = readPositiveInteger(planStepCount)
  const safePlanStepCount = safeStepNumber && parsedPlanStepCount && parsedPlanStepCount >= safeStepNumber
    ? parsedPlanStepCount
    : undefined
  const progress = safeStepNumber
    ? safePlanStepCount
      ? `Step: ${safeStepNumber}/${safePlanStepCount}`
      : `Step: ${safeStepNumber}`
    : ''
  const title = stepTitle ? `Step title: ${stepTitle}` : ''
  return [progress, title].filter(Boolean).join('\n')
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function buildStepLimitPendingAction(
  runId: string,
  goal: string,
  planSteps: Array<{ id: string; title: string }>,
  completedStepCount: number,
  workflowMetadata: WorkflowTraceMetadata = {}
): AgentPendingAction {
  const planStepCount = planSteps.length
  const remainingStepCount = Math.max(0, planStepCount - completedStepCount)
  const nextStep = planSteps[completedStepCount]
  const stepAttribution = buildStepAttributionFromPlannedStep(nextStep, completedStepCount, planStepCount)
  const suggestedUserPrompt = buildPendingActionPromptWithStepContext(
    buildStepLimitSuggestedPrompt(goal, planStepCount, completedStepCount, remainingStepCount, workflowMetadata),
    stepAttribution,
    workflowMetadata
  )
  return {
    id: `agent-pending-step-limit-${hashString(`${runId}:${planStepCount}:${completedStepCount}`)}`,
    reason: 'step_limit_reached',
    title: 'Workflow step limit reached',
    summary: clampAgentOutput(redactSensitiveText([
      `Goal: ${goal}`,
      workflowMetadata.workflowName ? `Workflow: ${workflowMetadata.workflowName}` : '',
      workflowMetadata.workflowExpectedOutput ? `Expected output: ${workflowMetadata.workflowExpectedOutput}` : '',
      `Completed steps: ${completedStepCount}/${planStepCount}`,
      `Remaining steps: ${remainingStepCount}`,
    ].filter(Boolean).join('\n')), 900),
    confirmable: false,
    blockedReason: 'Continuation requires a visible continue action before additional workflow steps can run.',
    suggestedUserPrompt,
    ...workflowMetadata,
    ...stepAttribution,
    planStepCount,
    completedStepCount,
    remainingStepCount,
    createdAt: Date.now(),
  }
}

function buildCancelledProgressMetadata(
  goal: string,
  planStepCount: number,
  completedStepCount: number,
  planSteps?: AgentPlannedStep[]
): AgentRunProgressTraceMetadata {
  const safePlanStepCount = Math.max(0, planStepCount)
  const safeCompletedStepCount = Math.min(safePlanStepCount, Math.max(0, completedStepCount))
  const remainingStepCount = Math.max(0, safePlanStepCount - safeCompletedStepCount)
  const nextStep = buildStepAttributionFromPlannedStep(planSteps?.[safeCompletedStepCount], safeCompletedStepCount, safePlanStepCount)
  return {
    planStepCount: safePlanStepCount,
    completedStepCount: safeCompletedStepCount,
    remainingStepCount,
    ...(nextStep.stepTitle ? { cancelledAtStepTitle: nextStep.stepTitle } : {}),
    ...(nextStep.stepNumber ? { cancelledAtStepNumber: nextStep.stepNumber } : {}),
    ...(nextStep.stepTitle ? { nextStepTitle: nextStep.stepTitle } : {}),
    ...(nextStep.stepNumber ? { nextStepNumber: nextStep.stepNumber } : {}),
    cancelledContinuationPrompt: buildCancelledContinuationPrompt(goal, safePlanStepCount, safeCompletedStepCount, remainingStepCount),
  }
}

function countCompletedSteps(steps: AgentStep[]): number {
  return steps.filter((step) => step.status === 'done').length
}

function formatCancelledOutput(output: string | undefined, progress: AgentRunProgressTraceMetadata): string {
  const base = output?.trim() || 'Agent workflow execution was cancelled.'
  return [
    base,
    `Completed steps: ${progress.completedStepCount}/${progress.planStepCount}`,
    `Remaining steps: ${progress.remainingStepCount}`,
    'Continuation requires a visible user action before additional workflow steps can run.',
  ].join('\n')
}

function formatStepLimitOutput(pendingAction: AgentPendingAction): string {
  return [
    'Agentic workflow paused at the configured step limit.',
    pendingAction.stepTitle ? `Next step: ${pendingAction.stepTitle}` : '',
    `Completed steps: ${pendingAction.completedStepCount ?? 0}/${pendingAction.planStepCount ?? 0}`,
    `Remaining steps: ${pendingAction.remainingStepCount ?? 0}`,
    `Continuation unavailable: ${pendingAction.blockedReason}`,
    '',
    pendingAction.summary,
  ].filter(Boolean).join('\n')
}

function findRagEvidenceQualityIssue(run: AgentWorkflowRun): RagEvidenceQualityIssue | undefined {
  if (run.intent !== 'rag_evidence') return undefined
  const ragStep = run.steps.find(isRagEvidenceStep)
  if (!ragStep) return undefined

  const outputMetrics = parseRagEvidenceQualityMetrics(ragStep.observation?.output)
  const traceMetadata = ragStep.observation?.trace.metadata ?? {}
  const issue: RagEvidenceQualityIssue = {
    sourceCount: outputMetrics.sourceCount ?? traceMetadata.sourceCount,
    citationCount: outputMetrics.citationCount ?? traceMetadata.citationCount,
    confidence: outputMetrics.confidence ?? traceMetadata.confidence,
    missingEvidence: outputMetrics.missingEvidence ?? traceMetadata.missingEvidence,
    profile: outputMetrics.profile ?? traceMetadata.profile,
    profileSource: outputMetrics.profileSource ?? traceMetadata.profileSource,
    profileReason: outputMetrics.profileReason ?? traceMetadata.profileReason,
    warnings: outputMetrics.warnings ?? traceMetadata.warnings,
    reasons: [],
    rawOutput: ragStep.observation?.output,
    stepAttribution: buildStepAttributionFromStep(ragStep),
  }

  if (!isNonNegativeInteger(issue.sourceCount)) {
    issue.reasons.push('sourceCount missing')
  } else if (issue.sourceCount < 1) {
    issue.reasons.push('no sources')
  }
  if (!isNonNegativeInteger(issue.citationCount)) {
    issue.reasons.push('citationCount missing')
  } else if (issue.citationCount < 1) {
    issue.reasons.push('no citations')
  }
  if (!isUnitConfidence(issue.confidence)) {
    issue.reasons.push('confidence missing')
  } else if (issue.confidence < RAG_EVIDENCE_MIN_CONFIDENCE) {
    issue.reasons.push('low confidence')
  }
  if (issue.missingEvidence !== false) {
    issue.reasons.push('missing evidence')
  }

  return issue.reasons.length ? issue : undefined
}

function isRagEvidenceStep(step: AgentStep): boolean {
  return step.toolRequest?.toolId === 'rag:context_pack' ||
    step.toolRequest?.name === 'rag.context_pack' ||
    step.observation?.trace.metadata?.source === 'rag'
}

function buildRagEvidencePendingAction(runId: string, goal: string, issue: RagEvidenceQualityIssue): AgentPendingAction {
  const repairStrategy = buildRagEvidenceRepairStrategy(issue)
  const summary = [
    `Goal: ${goal}`,
    `Evidence issue: ${issue.reasons.join(', ')}`,
    `Sources: ${formatMetric(issue.sourceCount)}`,
    `Citations: ${formatMetric(issue.citationCount)}`,
    `Confidence: ${formatMetric(issue.confidence)}`,
    `Missing evidence: ${formatMetric(issue.missingEvidence)}`,
    `RAG profile: ${formatMetric(issue.profile)}`,
    `RAG profile source: ${formatMetric(issue.profileSource)}`,
    `RAG profile reason: ${formatMetric(issue.profileReason)}`,
    `Repair guidance: ${ragEvidenceRepairGuidance(issue)}`,
    formatWarnings(issue.warnings),
  ].filter(Boolean).join('\n')
  return {
    id: `agent-pending-rag-evidence-${hashString(`${runId}:${summary}`)}`,
    reason: 'evidence_insufficient',
    title: 'RAG evidence repair required',
    summary: clampAgentOutput(redactSensitiveText(summary), 900),
    toolName: 'rag.context_pack',
    toolId: 'rag:context_pack',
    source: 'rag',
    permission: 'read-only',
    confirmable: false,
    blockedReason: ragEvidenceRepairBlockedReason(issue),
    repairStrategy,
    suggestedUserPrompt: buildPendingActionPromptWithStepContext(buildRagEvidenceSuggestedPrompt(goal, issue), issue.stepAttribution ?? {}),
    ...issue.stepAttribution,
    createdAt: Date.now(),
  }
}

function buildCancelledContinuationPrompt(
  goal: string,
  planStepCount: number,
  completedStepCount: number,
  remainingStepCount: number
): string {
  return clampAgentOutput(redactSensitiveText([
    'Review the cancelled agentic workflow from the visible trace.',
    `Original goal: ${goal}`,
    `Completed steps: ${completedStepCount}/${planStepCount}.`,
    `Remaining steps: ${remainingStepCount}.`,
    'Continue only unresolved safe steps, keep every tool action visible, and pause again for permissions, evidence gaps, or step limits.',
  ].join('\n')), 900)
}

function buildStepLimitSuggestedPrompt(
  goal: string,
  planStepCount: number,
  completedStepCount: number,
  remainingStepCount: number,
  workflowMetadata: WorkflowTraceMetadata = {}
): string {
  return clampAgentOutput(redactSensitiveText([
    'Continue the paused agentic workflow from the visible trace.',
    `Original goal: ${goal}`,
    workflowMetadata.workflowName ? `Workflow: ${workflowMetadata.workflowName}` : '',
    workflowMetadata.workflowId ? `Workflow id: ${workflowMetadata.workflowId}` : '',
    workflowMetadata.workflowExpectedOutput ? `Expected output: ${workflowMetadata.workflowExpectedOutput}` : '',
    `Completed steps: ${completedStepCount}/${planStepCount}.`,
    `Remaining steps: ${remainingStepCount}.`,
    'Run only the remaining safe steps, keep every tool action visible, and pause again if permission, evidence, or step limits require user action.',
  ].join('\n')), 900)
}

function buildRagEvidenceSuggestedPrompt(goal: string, issue: RagEvidenceQualityIssue): string {
  return clampAgentOutput(redactSensitiveText([
    'Repair the paused RAG evidence workflow.',
    `Original goal: ${goal}`,
    `Evidence issue: ${issue.reasons.join(', ') || 'insufficient evidence'}.`,
    `Current sources: ${formatMetric(issue.sourceCount)}.`,
    `Current citations: ${formatMetric(issue.citationCount)}.`,
    `Current confidence: ${formatMetric(issue.confidence)}.`,
    `Current RAG profile: ${formatMetric(issue.profile)} (${formatMetric(issue.profileSource)}).`,
    `Profile reason: ${formatMetric(issue.profileReason)}.`,
    ragEvidenceRepairGuidance(issue),
    'Produce citation-backed evidence and stop with visible trace if evidence remains insufficient.',
  ].join('\n')), 900)
}

function formatRagEvidenceRepairOutput(
  pendingAction: AgentPendingAction,
  issue: RagEvidenceQualityIssue,
  rawOutput: string
): string {
  return [
    'Agentic workflow paused for evidence repair.',
    'Reason: evidence_insufficient',
    `Evidence issue: ${issue.reasons.join(', ')}`,
    `Sources: ${formatMetric(issue.sourceCount)}`,
    `Citations: ${formatMetric(issue.citationCount)}`,
    `Confidence: ${formatMetric(issue.confidence)}`,
    `Missing evidence: ${formatMetric(issue.missingEvidence)}`,
    `RAG profile: ${formatMetric(issue.profile)}`,
    `RAG profile source: ${formatMetric(issue.profileSource)}`,
    `RAG profile reason: ${formatMetric(issue.profileReason)}`,
    `Repair guidance: ${ragEvidenceRepairGuidance(issue)}`,
    formatWarnings(issue.warnings),
    `Continuation unavailable: ${pendingAction.blockedReason}`,
    '',
    pendingAction.summary,
    rawOutput ? ['', 'Raw evidence output:', rawOutput].join('\n') : '',
  ].filter(Boolean).join('\n')
}

function parseRagEvidenceQualityMetrics(output: string | undefined): Omit<RagEvidenceQualityIssue, 'reasons' | 'rawOutput'> {
  if (!output?.trim()) return {}
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    return {
      sourceCount: parsed.sourceCount,
      citationCount: parsed.citationCount,
      confidence: parsed.confidence,
      missingEvidence: parsed.missingEvidence,
      profile: parsed.profile,
      profileSource: parsed.profileSource,
      profileReason: parsed.profileReason,
      warnings: parsed.warnings,
    }
  } catch {
    return {}
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isUnitConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function formatMetric(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return 'missing'
}

function formatWarnings(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return ''
  return `Warnings: ${value.map(String).join(', ')}`
}

function ragEvidenceRepairBlockedReason(issue: RagEvidenceQualityIssue): string {
  return isRagModeOffIssue(issue)
    ? 'RAG mode is off; enable RAG mode or add cited local evidence before rerunning the evidence workflow.'
    : 'Add stronger sources or widen the RAG profile, then run the evidence workflow again.'
}

function ragEvidenceRepairGuidance(issue: RagEvidenceQualityIssue): string {
  if (isRagModeOffIssue(issue)) {
    return 'RAG mode is off; do not override it with a wider profile request. Enable RAG mode or import citation-ready local evidence before retrying.'
  }
  const profile = readTextMetric(issue.profile)
  const target = profile === 'fast'
    ? 'balanced'
    : profile === 'balanced' || !profile
      ? 'deep'
      : undefined
  return target
    ? `Widen retrieval profile to ${target} for the repair run, then cite the stronger evidence.`
    : 'Keep the deep profile and strengthen retrieval inputs, source coverage, or citations before rerunning.'
}

function buildRagEvidenceRepairStrategy(issue: RagEvidenceQualityIssue): string {
  if (isRagModeOffIssue(issue)) return 'enable-rag-or-add-cited-local-evidence'
  const profile = readTextMetric(issue.profile)
  if (profile === 'fast') return 'widen-rag-profile-balanced'
  if (profile === 'balanced' || !profile) return 'widen-rag-profile-deep'
  return 'strengthen-deep-rag-evidence'
}

function isRagModeOffIssue(issue: RagEvidenceQualityIssue): boolean {
  return readTextMetric(issue.profile) === 'offline' ||
    readTextMetric(issue.profileSource) === 'rag-mode' ||
    readTextMetric(issue.profileReason) === 'ragMode=off'
}

function readTextMetric(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parsePermission(value: unknown): AgentToolPermission | undefined {
  return value === 'read-only' || value === 'read-write' || value === 'destructive' ? value : undefined
}

function parseToolSource(value: unknown): AgentToolSource | undefined {
  return value === 'mcp' || value === 'builtin' || value === 'app-action' || value === 'rag' || value === 'search' || value === 'work-artifact' || value === 'android'
    ? value
    : undefined
}

function parseFailureErrorCode(value: unknown): AgentToolResult['errorCode'] | undefined {
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

function summarizeArgumentsPreview(args: Record<string, unknown> | undefined): string | undefined {
  if (!args || !Object.keys(args).length) return undefined
  try {
    return clampAgentOutput(redactSensitiveText(JSON.stringify(args)), 360)
  } catch {
    return '[unserializable arguments]'
  }
}

function summarizeAndroidArgumentsPreview(toolName: string | undefined, args: Record<string, unknown> | undefined): string | undefined {
  if (!args || !Object.keys(args).length) return undefined
  switch (toolName) {
    case 'android.alarm.open_create_intent': {
      const hour = readIntegerArgument(args.hour, 0, 23)
      const minutes = readIntegerArgument(args.minutes, 0, 59)
      if (hour === undefined || minutes === undefined) return undefined
      const label = readShortArgumentText(args.message, 80)
      return label
        ? st('messageBubble.androidPendingAlarmDetailsWithLabel', { time: formatClockTime(hour, minutes), label }, 'Time {{time}} · label {{label}}')
        : st('messageBubble.androidPendingAlarmDetails', { time: formatClockTime(hour, minutes) }, 'Time {{time}}')
    }
    case 'android.calendar.open_create_event': {
      const title = readShortArgumentText(args.title, 90)
      const time = formatAndroidPendingDateTime(args.beginTimeMs, args.beginTimeIso)
      return title && time
        ? st('messageBubble.androidPendingCalendarDetailsWithTime', { title, time }, '{{title}} · {{time}}')
        : title || time
    }
    case 'android.reminder.open_create_todo': {
      const title = readShortArgumentText(args.title, 90)
      const time = formatAndroidPendingDateTime(args.dueTimeMs, args.dueTimeIso)
      return title && time
        ? st('messageBubble.androidPendingReminderDetailsWithTime', { title, time }, '{{title}} · due {{time}}')
        : title || time
    }
    case 'android.notifications.open_settings': {
      const target = args.target === 'promoted' ? 'promoted' : 'notifications'
      return st('messageBubble.androidPendingNotificationDetails', { target }, 'Target: {{target}}')
    }
    default:
      return summarizeArgumentsPreview(args)
  }
}

function readIntegerArgument(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return undefined
  return value
}

function readShortArgumentText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return clampAgentOutput(redactSensitiveText(value.trim()), limit).replace(/\n\[output truncated\]$/, '')
}

function formatClockTime(hour: number, minutes: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function formatAndroidPendingDateTime(timestampMs: unknown, iso: unknown): string | undefined {
  if (typeof iso === 'string' && iso.trim()) return clampAgentOutput(redactSensitiveText(iso.trim()), 80).replace(/\n\[output truncated\]$/, '')
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) return undefined
  const date = new Date(timestampMs)
  if (!Number.isFinite(date.getTime())) return undefined
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

function canPersistResumeRequest(request: AgentToolRequest): boolean {
  const serialized = safeStringify(request.arguments ?? {})
  if (!serialized) return false
  if (serialized.length > 1200) return false
  return !/(api[_-]?key|authorization|bearer|password|secret|token)|\b(sk|tp)-[A-Za-z0-9_-]{8,}\b/i.test(serialized)
}

function sanitizeResumeToolRequest(request: AgentToolRequest): AgentToolRequest {
  const serializedArguments = request.arguments ? safeStringify(request.arguments) : undefined
  return {
    toolId: request.toolId,
    name: request.name,
    source: request.source,
    serverId: request.serverId,
    arguments: serializedArguments ? JSON.parse(serializedArguments) as Record<string, unknown> : undefined,
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return ''
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
