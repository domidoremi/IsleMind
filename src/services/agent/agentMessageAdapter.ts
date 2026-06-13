import type { ChatErrorCode, Message, MessageUsage, ProcessTrace, SkillDefinition } from '@/types'
import type { AgenticChatEntryInput, AgenticChatWorkflowReply } from '@/services/agent/agentChatEntry'
import type { AgentPendingAction, AgentToolPermission, AgentToolRequest, AgentToolSource, AgentWorkflowDefinition, AgentWorkflowDefinitionValidation } from '@/services/agent/agentToolTypes'
import { buildAgentWorkflowApprovalSummary, type AgentWorkflowSkillSuggestion } from '@/services/agent/agentWorkflowSkills'
import { runAgenticChatWorkflow } from '@/services/agent/agentChatEntry'
import { clampAgentOutput, redactSensitiveText } from '@/services/agent/agentTrace'
import { createAgentWorkflowDefinition, exportAgentWorkflowDefinition, sanitizeAgentWorkflowDefinition } from '@/services/agent/agentWorkflowDefinitions'
import { WORK_ARTIFACT_WORKFLOW_CONTRACT } from '@/services/agent/workArtifactWorkflow'

const PENDING_ACTION_TITLE_LIMIT = 160
const PENDING_ACTION_SUMMARY_LIMIT = 900
const PENDING_ACTION_PROMPT_LIMIT = 900
const PENDING_ACTION_ARGUMENTS_PREVIEW_LIMIT = 360
const PENDING_ACTION_DETAIL_LIMIT = 240
const AGENT_ACTION_PROMPT_LIMIT = 900
const AGENT_ACTION_NAME_LIMIT = 160
const WORKFLOW_SUGGESTION_TEXT_LIMIT = 2000
const WORKFLOW_SUGGESTION_PAYLOAD_LIMIT = 24000
const WORKFLOW_SUGGESTION_TOOL_IDENTITY_LIMIT = 240
const WORKFLOW_SUGGESTION_MAX_STEPS = 20
const WORKFLOW_SUGGESTION_MAX_LIST_ITEMS = 12
const WORKFLOW_SUGGESTION_MAX_STEP_ACCEPTANCE = 8
const PENDING_ACTION_RESUME_REQUEST_LIMIT = 1200
const PENDING_ACTION_RESUME_FIELD_LIMIT = 160
const PENDING_ACTION_RESUME_SENSITIVE_PATTERN = /(api[_-]?key|authorization|bearer|password|secret|token)|\b(sk|tp)-[A-Za-z0-9_-]{8,}\b/i
const BLOCKED_WORKFLOW_ARGUMENT_EXECUTION_RISK = '[blocked: arbitrary execution risk]'

export interface AgentAssistantMessagePatch {
  content: string
  responseText: string
  status: Message['status']
  reasoning?: ProcessTrace[]
  retrievalTrace?: ProcessTrace[]
  toolCalls?: ProcessTrace[]
  usage: MessageUsage
  tokenCount: number
  errorCode?: ChatErrorCode
  durationMs?: number
  completedAt: number
}

export interface AgentAssistantMessageResolution {
  handled: boolean
  reply: AgenticChatWorkflowReply
  patch?: AgentAssistantMessagePatch
}

export type AgentWorkflowRecoveryReason =
  | 'workflow-disabled'
  | 'workflow-review-required'
  | 'workflow-invalid'
  | 'workflow-selection-ambiguous'

export interface AgentWorkflowRecoveryAction {
  reason: AgentWorkflowRecoveryReason
  failureNextStep: string
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
}

export type AgentWorkflowContinuationReason =
  | 'workflow-selection-ambiguous'
  | 'failed'
  | 'cancelled'
  | 'work-artifact-follow-up'

export interface AgentWorkflowContinuationAction {
  reason: AgentWorkflowContinuationReason
  suggestedUserPrompt: string
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
}

export interface AgentEvidenceRepairAction {
  reason: 'evidence_insufficient'
  suggestedUserPrompt: string
  repairNextStep?: string
  repairStrategy?: string
  workflowId?: string
  workflowName?: string
  workflowExpectedOutput?: string
  stepTitle?: string
  stepNumber?: number
  planStepCount?: number
}

export async function resolveAgentAssistantMessagePatch(input: AgenticChatEntryInput & { startedAt?: number }): Promise<AgentAssistantMessageResolution> {
  const reply = await runAgenticChatWorkflow(input)
  return {
    handled: reply.handled,
    reply,
    patch: reply.handled ? buildAgentAssistantMessagePatch(reply, input.startedAt) : undefined,
  }
}

export function buildAgentAssistantMessagePatch(reply: AgenticChatWorkflowReply, startedAt = Date.now()): AgentAssistantMessagePatch {
  const traces = splitAgentTracesForMessage(reply.traces)
  const completedAt = Date.now()
  const content = reply.content.trim()
  const status = resolveAgentMessageStatus(reply)
  return {
    content,
    responseText: content,
    status,
    reasoning: traces.reasoning,
    retrievalTrace: traces.retrievalTrace,
    toolCalls: traces.toolCalls,
    usage: buildAgentEstimatedUsage(content),
    tokenCount: estimateAgentTokens(content),
    errorCode: status === 'error' ? agentFailureToChatError(reply.failureCode) : undefined,
    durationMs: Math.max(0, completedAt - startedAt),
    completedAt,
  }
}

export function splitAgentTracesForMessage(traces: ProcessTrace[]): Pick<AgentAssistantMessagePatch, 'reasoning' | 'retrievalTrace' | 'toolCalls'> {
  const reasoning: ProcessTrace[] = []
  const retrievalTrace: ProcessTrace[] = []
  const toolCalls: ProcessTrace[] = []

  for (const trace of traces.map(settleTraceForMessage)) {
    if (trace.type === 'retrieval' || trace.type === 'search' || trace.type === 'knowledge' || trace.type === 'memory') {
      retrievalTrace.push(trace)
    } else if (trace.type === 'tool') {
      toolCalls.push(trace)
    } else {
      reasoning.push(trace)
    }
  }

  return {
    reasoning: reasoning.length ? reasoning : undefined,
    retrievalTrace: retrievalTrace.length ? retrievalTrace : undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
  }
}

export function getAgentPendingActionFromMessage(message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>): AgentPendingAction | undefined {
  const traces = collectAgentMessageTraces(message)
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (!isWorkflowContinuationTrace(trace)) continue
    const pendingAction = trace.metadata?.pendingAction
    if (isAgentPendingAction(pendingAction)) return sanitizeAgentPendingActionForUi(pendingAction)
  }
  return undefined
}

export function getAgentEvidenceRepairActionFromMessage(
  message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>
): AgentEvidenceRepairAction | undefined {
  const traces = collectAgentMessageTraces(message)
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (!isWorkflowContinuationTrace(trace)) continue
    const metadata = trace.metadata ?? {}
    const pendingAction = metadata.pendingAction
    if (isAgentPendingAction(pendingAction)) {
      const action = sanitizeAgentPendingActionForUi(pendingAction)
      if (action.reason !== 'evidence_insufficient') continue
      const repairNextStep = sanitizeOptionalPendingActionText(metadata.repairNextStep, PENDING_ACTION_DETAIL_LIMIT) ?? action.blockedReason
      const suggestedUserPrompt = action.suggestedUserPrompt ?? buildEvidenceRepairPromptFromMetadata(metadata, repairNextStep)
      if (!suggestedUserPrompt) continue
      return {
        reason: 'evidence_insufficient',
        suggestedUserPrompt,
        ...(repairNextStep ? { repairNextStep } : {}),
        ...(action.repairStrategy ? { repairStrategy: action.repairStrategy } : {}),
        ...readEvidenceRepairWorkflowAndStepContext(metadata, action),
      }
    }
    const action = buildEvidenceRepairActionFromMetadata(metadata)
    if (action) return action
  }
  return undefined
}

export function getAgentWorkflowRecoveryActionFromMessage(
  message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>
): AgentWorkflowRecoveryAction | undefined {
  const traces = collectAgentMessageTraces(message)
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (!isWorkflowContinuationTrace(trace)) continue
    const metadata = trace.metadata ?? {}
    if (!isAgentWorkflowRecoveryReason(metadata.reason)) continue
    if (typeof metadata.failureNextStep !== 'string' || !metadata.failureNextStep.trim()) continue
    const workflowContext = readWorkflowContinuationContext(metadata)
    return {
      reason: metadata.reason,
      failureNextStep: safeAgentActionText(metadata.failureNextStep, AGENT_ACTION_PROMPT_LIMIT),
      ...workflowContext,
    }
  }
  return undefined
}

export function getAgentWorkflowContinuationActionFromMessage(
  message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>
): AgentWorkflowContinuationAction | undefined {
  const traces = collectAgentMessageTraces(message)
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    const metadata = trace.metadata ?? {}
    if (isWorkflowContinuationTrace(trace) && metadata.reason === 'workflow-selection-ambiguous' && typeof metadata.failureNextStep === 'string' && metadata.failureNextStep.trim()) {
      const workflowName = typeof metadata.workflowName === 'string' && metadata.workflowName.trim()
        ? safeAgentActionText(metadata.workflowName, AGENT_ACTION_NAME_LIMIT)
        : undefined
      return {
        reason: 'workflow-selection-ambiguous',
        suggestedUserPrompt: safeAgentActionText(metadata.failureNextStep, AGENT_ACTION_PROMPT_LIMIT),
        workflowName,
      }
    }
    if (isCancelledWorkflowTrace(trace)) {
      if (typeof metadata.cancelledContinuationPrompt !== 'string' || !metadata.cancelledContinuationPrompt.trim()) continue
      const prompt = safeAgentActionText(metadata.cancelledContinuationPrompt, AGENT_ACTION_PROMPT_LIMIT)
      const workflowContext = readWorkflowContinuationContext(metadata)
      return {
        reason: 'cancelled',
        suggestedUserPrompt: buildCancelledContinuationPromptWithStepContext(prompt, metadata),
        ...workflowContext,
      }
    }
    if (isFailedWorkflowTrace(trace) && typeof metadata.failureNextStep === 'string' && metadata.failureNextStep.trim()) {
      const prompt = safeAgentActionText(metadata.failureNextStep, AGENT_ACTION_PROMPT_LIMIT)
      const workflowContext = readWorkflowContinuationContext(metadata)
      return {
        reason: 'failed',
        suggestedUserPrompt: buildFailedContinuationPromptWithStepContext(prompt, metadata),
        ...workflowContext,
      }
    }
    if (isCompletedWorkArtifactFollowUpTrace(trace)) {
      const prompt = safeAgentActionText(String(metadata.followUpPrompt), AGENT_ACTION_PROMPT_LIMIT)
      if (!prompt) continue
      const workflowContext = {
        ...readLatestWorkflowContinuationContext(traces, index),
        ...readWorkflowContinuationContext(metadata),
      }
      return {
        reason: 'work-artifact-follow-up',
        suggestedUserPrompt: buildCompletedWorkArtifactFollowUpPromptWithStepContext(prompt, metadata, workflowContext),
        ...workflowContext,
      }
    }
  }
  return undefined
}

export function getAgentWorkflowSkillSuggestionFromMessage(message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>): AgentWorkflowSkillSuggestion | undefined {
  const traces = collectAgentMessageTraces(message)
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (!isWorkflowSkillSuggestionTrace(trace)) continue
    const suggestion = trace.metadata?.workflowSkillSuggestion
    if (isAgentWorkflowSkillSuggestion(suggestion)) return sanitizeAgentWorkflowSkillSuggestionForUi(suggestion)
  }
  return undefined
}

export function agentFailureToChatError(code: AgenticChatWorkflowReply['failureCode']): ChatErrorCode {
  switch (code) {
    case 'provider_unavailable':
      return 'disabled_provider'
    case 'tool_unavailable':
    case 'permission_required':
    case 'schema_invalid':
    case 'rag_unavailable':
    case 'evidence_insufficient':
    case 'step_limit_reached':
    case 'policy_denied':
    case 'execution_failed':
    case 'cancelled':
    case undefined:
      return 'unknown'
  }
}

function collectAgentMessageTraces(message: Pick<Message, 'reasoning' | 'retrievalTrace' | 'toolCalls'>): ProcessTrace[] {
  return [
    ...(message.reasoning ?? []),
    ...(message.retrievalTrace ?? []),
    ...(message.toolCalls ?? []),
  ]
    .filter((trace) => !trace.metadata?.hiddenSignature)
    .map((trace, index) => ({ trace, index, order: resolveAgentTraceOrder(trace, index) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.trace)
}

function resolveAgentTraceOrder(trace: ProcessTrace, fallback: number): number {
  const timestamp = trace.completedAt ?? trace.startedAt
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : fallback
}

function isAgentPendingAction(value: unknown): value is AgentPendingAction {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.summary === 'string' &&
    (record.reason === 'permission_required' || record.reason === 'step_limit_reached' || record.reason === 'evidence_insufficient') &&
    typeof record.confirmable === 'boolean' &&
    (record.suggestedUserPrompt === undefined || typeof record.suggestedUserPrompt === 'string')
  )
}

function sanitizeAgentPendingActionForUi(action: AgentPendingAction): AgentPendingAction {
  const record = action as unknown as Record<string, unknown>
  const toolName = sanitizeOptionalPendingActionText(record.toolName, PENDING_ACTION_DETAIL_LIMIT)
  const toolId = sanitizeOptionalPendingActionText(record.toolId, PENDING_ACTION_DETAIL_LIMIT)
  const serverId = sanitizeResumeRequestField(record.serverId)
  const argumentsPreview = sanitizeOptionalPendingActionText(record.argumentsPreview, PENDING_ACTION_ARGUMENTS_PREVIEW_LIMIT)
  const baseSuggestedUserPrompt = sanitizeOptionalPendingActionText(record.suggestedUserPrompt, PENDING_ACTION_PROMPT_LIMIT)
  const blockedReason = sanitizeOptionalPendingActionText(record.blockedReason, PENDING_ACTION_DETAIL_LIMIT)
  const repairStrategy = sanitizeOptionalPendingActionText(record.repairStrategy, PENDING_ACTION_DETAIL_LIMIT)
  const workflowId = sanitizeOptionalPendingActionText(record.workflowId, PENDING_ACTION_DETAIL_LIMIT)
  const workflowName = sanitizeOptionalPendingActionText(record.workflowName, AGENT_ACTION_NAME_LIMIT)
  const workflowExpectedOutput = sanitizeOptionalPendingActionText(record.workflowExpectedOutput, PENDING_ACTION_DETAIL_LIMIT)
  const stepId = sanitizeOptionalPendingActionText(record.stepId, PENDING_ACTION_DETAIL_LIMIT)
  const stepTitle = sanitizeOptionalPendingActionText(record.stepTitle, PENDING_ACTION_TITLE_LIMIT)
  const resumeToolRequest = sanitizePendingActionResumeToolRequest(record.resumeToolRequest)
  const visibleSource = isAgentToolSource(record.source) ? record.source : undefined
  const visiblePermission = isAgentToolPermission(record.permission) ? record.permission : undefined
  const resumeMatchesVisibleAction = resumeToolRequest
    ? resumeToolRequestMatchesVisibleAction(resumeToolRequest, {
        toolName,
        toolId,
        serverId,
        source: visibleSource,
        permission: visiblePermission,
      })
    : false
  const confirmable = action.reason === 'permission_required' && action.confirmable && Boolean(resumeToolRequest) && resumeMatchesVisibleAction
  const stepNumber = sanitizeOptionalPendingActionCount(record.stepNumber)
  const planStepCount = sanitizeOptionalPendingActionCount(record.planStepCount)
  const completedStepCount = sanitizeOptionalPendingActionCount(record.completedStepCount)
  const remainingStepCount = sanitizeOptionalPendingActionCount(record.remainingStepCount)
  const suggestedUserPrompt = buildPendingActionPromptWithStepContext(
    baseSuggestedUserPrompt,
    stepTitle,
    stepNumber,
    planStepCount,
    workflowName,
    workflowExpectedOutput,
    workflowId
  )
  return {
    id: action.id,
    reason: action.reason,
    title: sanitizeRequiredPendingActionText(record.title, PENDING_ACTION_TITLE_LIMIT, 'Agent workflow action'),
    summary: sanitizeRequiredPendingActionText(record.summary, PENDING_ACTION_SUMMARY_LIMIT, 'Agent workflow is waiting for a visible action.'),
    ...(toolName ? { toolName } : {}),
    ...(toolId ? { toolId } : {}),
    ...(serverId ? { serverId } : {}),
    ...(visibleSource ? { source: visibleSource } : {}),
    ...(visiblePermission ? { permission: visiblePermission } : {}),
    ...(argumentsPreview ? { argumentsPreview } : {}),
    confirmable,
    ...(confirmable && resumeToolRequest ? { resumeToolRequest } : {}),
    ...(suggestedUserPrompt ? { suggestedUserPrompt } : {}),
    ...(blockedReason ? { blockedReason } : !confirmable && action.confirmable ? { blockedReason: 'Tool request is not safe to restore from trace metadata.' } : {}),
    ...(repairStrategy ? { repairStrategy } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
    ...(stepId ? { stepId } : {}),
    ...(stepTitle ? { stepTitle } : {}),
    ...(stepNumber !== undefined ? { stepNumber } : {}),
    ...(planStepCount !== undefined ? { planStepCount } : {}),
    ...(completedStepCount !== undefined ? { completedStepCount } : {}),
    ...(remainingStepCount !== undefined ? { remainingStepCount } : {}),
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
  }
}

function buildEvidenceRepairActionFromMetadata(metadata: Record<string, unknown>): AgentEvidenceRepairAction | undefined {
  if (metadata.failureCode !== 'evidence_insufficient') return undefined
  const repairNextStep = sanitizeOptionalPendingActionText(metadata.repairNextStep, PENDING_ACTION_DETAIL_LIMIT)
  if (!repairNextStep) return undefined
  const suggestedUserPrompt = buildEvidenceRepairPromptFromMetadata(metadata, repairNextStep)
  if (!suggestedUserPrompt) return undefined
  const repairStrategy = sanitizeOptionalPendingActionText(metadata.repairStrategy, PENDING_ACTION_DETAIL_LIMIT)
  return {
    reason: 'evidence_insufficient',
    suggestedUserPrompt,
    repairNextStep,
    ...(repairStrategy ? { repairStrategy } : {}),
    ...readEvidenceRepairWorkflowAndStepContext(metadata),
  }
}

function buildEvidenceRepairPromptFromMetadata(
  metadata: Record<string, unknown>,
  repairNextStep: string | undefined
): string | undefined {
  if (!repairNextStep) return undefined
  const repairStrategy = sanitizeOptionalPendingActionText(metadata.repairStrategy, PENDING_ACTION_DETAIL_LIMIT)
  const context = readEvidenceRepairWorkflowAndStepContext(metadata)
  const prompt = safeAgentActionText([
    'Repair the paused RAG evidence workflow.',
    `Repair next step: ${repairNextStep}`,
    repairStrategy ? `Repair strategy: ${repairStrategy}` : '',
    'Keep every retrieval action visible and stop again if evidence remains insufficient.',
  ].filter(Boolean).join('\n'), PENDING_ACTION_PROMPT_LIMIT)
  return buildPendingActionPromptWithStepContext(
    prompt,
    context.stepTitle,
    context.stepNumber,
    context.planStepCount,
    context.workflowName,
    context.workflowExpectedOutput,
    context.workflowId
  )
}

function readEvidenceRepairWorkflowAndStepContext(
  metadata: Record<string, unknown>,
  action?: AgentPendingAction
): Pick<AgentEvidenceRepairAction, 'workflowId' | 'workflowName' | 'workflowExpectedOutput' | 'stepTitle' | 'stepNumber' | 'planStepCount'> {
  return {
    ...readWorkflowContinuationContext(metadata),
    stepTitle: sanitizeOptionalPendingActionText(action?.stepTitle ?? metadata.stepTitle, PENDING_ACTION_TITLE_LIMIT),
    stepNumber: sanitizePositiveActionCount(action?.stepNumber ?? metadata.stepNumber),
    planStepCount: sanitizePositiveActionCount(action?.planStepCount ?? metadata.planStepCount),
  }
}

function sanitizeRequiredPendingActionText(value: unknown, limit: number, fallback: string): string {
  return sanitizeOptionalPendingActionText(value, limit) || fallback
}

function sanitizeOptionalPendingActionText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const safe = safeAgentActionText(value, limit)
  return safe || undefined
}

function safeAgentActionText(value: string, limit: number): string {
  return clampAgentOutput(redactSensitiveText(value).trim(), limit).trim()
}

function appendAgentActionPromptSuffix(prompt: string, suffix: string, limit: number): string {
  const safeSuffix = redactSensitiveText(suffix).trim()
  if (!safeSuffix) return safeAgentActionText(prompt, limit)
  const suffixBlock = `\n${safeSuffix}`
  if (suffixBlock.length >= limit) return safeAgentActionText(safeSuffix, limit)
  const body = clampAgentOutputWithExactLimit(redactSensitiveText(prompt).trim(), limit - suffixBlock.length).trim()
  return `${body}${suffixBlock}`.trim()
}

function clampAgentOutputWithExactLimit(value: string, limit: number): string {
  const max = Math.max(0, limit)
  if (value.length <= max) return value
  const marker = '\n[output truncated]'
  if (max <= marker.length) return value.slice(0, max)
  return `${value.slice(0, Math.max(0, max - marker.length))}${marker}`
}

function buildPendingActionPromptWithStepContext(
  prompt: string | undefined,
  stepTitle: string | undefined,
  stepNumber: number | undefined,
  planStepCount: number | undefined,
  workflowName?: string,
  workflowExpectedOutput?: string,
  workflowId?: string
): string | undefined {
  if (!prompt) return undefined
  const stepContext = formatPendingActionStepContext(stepTitle, stepNumber, planStepCount)
  const workflowContext = formatPendingActionWorkflowContext(workflowName, workflowExpectedOutput, workflowId)
  const missingContext = [
    workflowContext && !prompt.includes(workflowContext) ? workflowContext : '',
    stepContext && !prompt.includes(stepContext) ? stepContext : '',
  ].filter(Boolean).join('\n')
  if (!missingContext) return prompt
  return appendAgentActionPromptSuffix(prompt, missingContext, PENDING_ACTION_PROMPT_LIMIT)
}

function formatPendingActionWorkflowContext(
  workflowName: string | undefined,
  workflowExpectedOutput: string | undefined,
  workflowId: string | undefined
): string {
  return [
    workflowName ? `Workflow: ${workflowName}` : '',
    workflowId ? `Workflow id: ${workflowId}` : '',
    workflowExpectedOutput ? `Expected output: ${workflowExpectedOutput}` : '',
  ].filter(Boolean).join('\n')
}

function buildCancelledContinuationPromptWithStepContext(
  prompt: string,
  metadata: Record<string, unknown>
): string {
  const workflowContext = readWorkflowContinuationContext(metadata)
  const stepTitle = sanitizeOptionalPendingActionText(metadata.nextStepTitle ?? metadata.cancelledAtStepTitle, PENDING_ACTION_DETAIL_LIMIT)
  const stepNumber = sanitizePositiveActionCount(metadata.nextStepNumber ?? metadata.cancelledAtStepNumber)
  const planStepCount = sanitizePositiveActionCount(metadata.planStepCount)
  const stepContext = formatPendingActionStepContext(stepTitle, stepNumber, planStepCount)
  const context = [
    formatPendingActionWorkflowContext(workflowContext.workflowName, workflowContext.workflowExpectedOutput, workflowContext.workflowId),
    stepContext,
  ].filter(Boolean).join('\n')
  if (!context || prompt.includes(context)) return prompt
  return appendAgentActionPromptSuffix(prompt, context, AGENT_ACTION_PROMPT_LIMIT)
}

function buildFailedContinuationPromptWithStepContext(
  prompt: string,
  metadata: Record<string, unknown>
): string {
  const workflowContext = readWorkflowContinuationContext(metadata)
  const stepTitle = sanitizeOptionalPendingActionText(metadata.failedStepTitle ?? metadata.stepTitle, PENDING_ACTION_DETAIL_LIMIT)
  const stepNumber = sanitizePositiveActionCount(metadata.failedStepNumber ?? metadata.stepNumber)
  const planStepCount = sanitizePositiveActionCount(metadata.failedPlanStepCount ?? metadata.planStepCount)
  const failedToolName = sanitizeOptionalPendingActionText(metadata.failedToolName, PENDING_ACTION_DETAIL_LIMIT)
  const failedToolId = sanitizeOptionalPendingActionText(metadata.failedToolId, PENDING_ACTION_DETAIL_LIMIT)
  const failedToolSource = sanitizeOptionalPendingActionText(metadata.failedToolSource, PENDING_ACTION_DETAIL_LIMIT)
  const failedToolErrorCode = sanitizeOptionalPendingActionText(metadata.failedToolErrorCode, PENDING_ACTION_DETAIL_LIMIT)
  const recoveryContext = formatFailedWorkflowContinuationContext(
    workflowContext,
    stepTitle,
    stepNumber,
    planStepCount,
    { failedToolName, failedToolId, failedToolSource, failedToolErrorCode }
  )
  if (!recoveryContext || prompt.includes(recoveryContext)) return prompt
  return appendAgentActionPromptSuffix(prompt, recoveryContext, AGENT_ACTION_PROMPT_LIMIT)
}

function formatFailedWorkflowContinuationContext(
  workflowContext: Pick<AgentWorkflowContinuationAction, 'workflowId' | 'workflowName' | 'workflowExpectedOutput'>,
  stepTitle: string | undefined,
  stepNumber: number | undefined,
  planStepCount: number | undefined,
  failedToolContext?: {
    failedToolName?: string
    failedToolId?: string
    failedToolSource?: string
    failedToolErrorCode?: string
  }
): string {
  const workflowSummary = formatPendingActionWorkflowContext(
    workflowContext.workflowName,
    workflowContext.workflowExpectedOutput,
    workflowContext.workflowId
  )
  const stepContext = formatPendingActionStepContext(stepTitle, stepNumber, planStepCount)
  const toolContext = formatFailedToolContinuationContext(failedToolContext)
  return [workflowSummary, stepContext, toolContext].filter(Boolean).join('\n')
}

function readWorkflowContinuationContext(
  metadata: Record<string, unknown>
): Pick<AgentWorkflowContinuationAction, 'workflowId' | 'workflowName' | 'workflowExpectedOutput'> {
  const workflowId = sanitizeOptionalPendingActionText(metadata.workflowId, PENDING_ACTION_DETAIL_LIMIT)
  const workflowName = sanitizeOptionalPendingActionText(metadata.workflowName, AGENT_ACTION_NAME_LIMIT)
  const workflowExpectedOutput = sanitizeOptionalPendingActionText(metadata.workflowExpectedOutput, PENDING_ACTION_DETAIL_LIMIT)
  return {
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

function readLatestWorkflowContinuationContext(
  traces: ProcessTrace[],
  endIndex = traces.length - 1
): Pick<AgentWorkflowContinuationAction, 'workflowId' | 'workflowName' | 'workflowExpectedOutput'> {
  for (let index = Math.min(endIndex, traces.length - 1); index >= 0; index -= 1) {
    const context = readWorkflowContinuationContext(traces[index].metadata ?? {})
    if (context.workflowId || context.workflowName || context.workflowExpectedOutput) return context
  }
  return {}
}

function buildCompletedWorkArtifactFollowUpPromptWithStepContext(
  prompt: string,
  metadata: Record<string, unknown>,
  workflowContext: Pick<AgentWorkflowContinuationAction, 'workflowId' | 'workflowName' | 'workflowExpectedOutput'>
): string {
  const stepTitle = sanitizeOptionalPendingActionText(metadata.stepTitle, PENDING_ACTION_DETAIL_LIMIT)
  const stepNumber = sanitizePositiveActionCount(metadata.stepNumber)
  const planStepCount = sanitizePositiveActionCount(metadata.planStepCount)
  const context = [
    formatPendingActionWorkflowContext(workflowContext.workflowName, workflowContext.workflowExpectedOutput, workflowContext.workflowId),
    formatPendingActionStepContext(stepTitle, stepNumber, planStepCount),
  ].filter(Boolean).join('\n')
  if (!context || prompt.includes(context)) return prompt
  return appendAgentActionPromptSuffix(prompt, context, AGENT_ACTION_PROMPT_LIMIT)
}

function formatFailedToolContinuationContext(context: {
  failedToolName?: string
  failedToolId?: string
  failedToolSource?: string
  failedToolErrorCode?: string
} | undefined): string {
  if (!context) return ''
  return [
    context.failedToolName ? `Failed tool: ${context.failedToolName}` : '',
    context.failedToolId ? `Tool id: ${context.failedToolId}` : '',
    context.failedToolSource ? `Source: ${context.failedToolSource}` : '',
    context.failedToolErrorCode ? `Error: ${context.failedToolErrorCode}` : '',
  ].filter(Boolean).join('\n')
}

function formatPendingActionStepContext(
  stepTitle: string | undefined,
  stepNumber: number | undefined,
  planStepCount: number | undefined
): string {
  const safeStepNumber = typeof stepNumber === 'number' && Number.isInteger(stepNumber) && stepNumber > 0
    ? stepNumber
    : undefined
  const safePlanStepCount = typeof planStepCount === 'number' &&
    Number.isInteger(planStepCount) &&
    safeStepNumber !== undefined &&
    planStepCount >= safeStepNumber
    ? planStepCount
    : undefined
  const progress = safeStepNumber
    ? safePlanStepCount
      ? `Step: ${safeStepNumber}/${safePlanStepCount}`
      : `Step: ${safeStepNumber}`
    : ''
  const title = stepTitle ? `Step title: ${stepTitle}` : ''
  return [progress, title].filter(Boolean).join('\n')
}

function sanitizeOptionalPendingActionCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}

function sanitizePositiveActionCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

function isAgentToolSource(value: unknown): value is AgentToolSource {
  return value === 'mcp' || value === 'builtin' || value === 'app-action' || value === 'rag' || value === 'search' || value === 'work-artifact' || value === 'android'
}

function isAgentToolPermission(value: unknown): value is AgentToolPermission {
  return value === 'read-only' || value === 'read-write' || value === 'destructive'
}

function sanitizePendingActionResumeToolRequest(value: unknown): AgentToolRequest | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const toolId = sanitizeResumeRequestField(record.toolId)
  const name = sanitizeResumeRequestField(record.name)
  const serverId = sanitizeResumeRequestField(record.serverId)
  if (record.toolId !== undefined && !toolId) return undefined
  if (record.name !== undefined && !name) return undefined
  if (!toolId && !name) return undefined
  if (record.source !== undefined && !isAgentToolSource(record.source)) return undefined
  if (record.serverId !== undefined && !serverId) return undefined
  if (record.arguments !== undefined && (!record.arguments || typeof record.arguments !== 'object' || Array.isArray(record.arguments))) return undefined
  const serialized = safePendingActionStringify(record.arguments ?? {})
  if (!serialized || serialized.length > PENDING_ACTION_RESUME_REQUEST_LIMIT) return undefined
  if (PENDING_ACTION_RESUME_SENSITIVE_PATTERN.test(serialized)) return undefined
  const parsedArguments = record.arguments === undefined
    ? undefined
    : JSON.parse(serialized) as Record<string, unknown>
  return {
    ...(toolId ? { toolId } : {}),
    ...(name ? { name } : {}),
    ...(isAgentToolSource(record.source) ? { source: record.source } : {}),
    ...(serverId ? { serverId } : {}),
    ...(parsedArguments ? { arguments: parsedArguments } : {}),
  }
}

function resumeToolRequestMatchesVisibleAction(
  request: AgentToolRequest,
  visible: {
    toolName?: string
    toolId?: string
    serverId?: string
    source?: AgentToolSource
    permission?: AgentToolPermission
  }
): boolean {
  if (!isConfirmablePendingActionPermission(visible.permission)) return false
  if (request.source && request.source !== visible.source) return false
  if ((request.serverId || visible.serverId) && request.serverId !== visible.serverId) return false
  if (request.name && request.name !== visible.toolName) return false
  if (request.toolId && request.toolId !== visible.toolId) return false
  return Boolean((request.name && visible.toolName) || (request.toolId && visible.toolId))
}

function isConfirmablePendingActionPermission(value: AgentToolPermission | undefined): boolean {
  return value === 'read-write' || value === 'destructive'
}

function sanitizeResumeRequestField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > PENDING_ACTION_RESUME_FIELD_LIMIT) return undefined
  if (PENDING_ACTION_RESUME_SENSITIVE_PATTERN.test(normalized)) return undefined
  return normalized
}

function safePendingActionStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function sanitizeAgentWorkflowSkillSuggestionForUi(suggestion: AgentWorkflowSkillSuggestion): AgentWorkflowSkillSuggestion {
  const record = suggestion as unknown as Record<string, unknown>
  const workflow = sanitizeWorkflowSuggestionDefinition(record.workflow)
  const validation = sanitizeWorkflowSuggestionValidation(record.validation, workflow)
  const matchingSkill = isMatchingWorkflowSuggestionSkill(record.skill, workflow)
  const unsafeReason = workflowSuggestionUnsafeReason(workflow)
  const safeValidation = unsafeReason
    ? appendWorkflowSuggestionValidationError(validation, unsafeReason)
    : validation
  const canExposeSkill = record.ok === true && safeValidation.ok && matchingSkill
  const skill = canExposeSkill ? buildSanitizedWorkflowSuggestionSkill(workflow, record.skill) : undefined
  const actionable = Boolean(skill)
  const visibleValidation = actionable ? safeValidation : { ...safeValidation, ok: false }
  return {
    ok: actionable,
    requiresUserApproval: true,
    workflow,
    validation: visibleValidation,
    ...(skill ? { skill } : {}),
    approvalSummary: clampAgentOutput(redactSensitiveText(buildAgentWorkflowApprovalSummary(workflow, visibleValidation)), WORKFLOW_SUGGESTION_TEXT_LIMIT),
  }
}

function sanitizeWorkflowSuggestionDefinition(value: unknown): AgentWorkflowDefinition {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now()
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt
  const workflow = createAgentWorkflowDefinition({
    id: typeof record.id === 'string' && record.id.trim() ? record.id : 'agent-workflow',
    name: typeof record.name === 'string' && record.name.trim() ? record.name : 'Agent workflow',
    description: typeof record.description === 'string' ? record.description : undefined,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : false,
    triggerHints: sanitizeWorkflowSuggestionStringList(record.triggerHints, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS),
    steps: sanitizeWorkflowSuggestionSteps(record.steps),
    permissionCeiling: isAgentToolPermission(record.permissionCeiling) ? record.permissionCeiling : 'read-only',
    expectedOutput: isWorkflowSuggestionExpectedOutput(record.expectedOutput) ? record.expectedOutput : undefined,
    acceptanceChecks: sanitizeWorkflowSuggestionStringList(record.acceptanceChecks, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS),
    now: createdAt,
  })
  return sanitizeAgentWorkflowDefinition({ ...workflow, updatedAt })
}

function sanitizeWorkflowSuggestionSteps(value: unknown): AgentWorkflowDefinition['steps'] {
  if (!Array.isArray(value)) return []
  return value.slice(0, WORKFLOW_SUGGESTION_MAX_STEPS).map((step, index) => {
    const record = step && typeof step === 'object' ? step as Record<string, unknown> : {}
    return {
      id: typeof record.id === 'string' && record.id.trim() ? record.id : `step-${index + 1}`,
      title: typeof record.title === 'string' && record.title.trim() ? record.title : `Step ${index + 1}`,
      toolRequest: sanitizeWorkflowSuggestionToolRequest(record.toolRequest),
      acceptance: sanitizeWorkflowSuggestionStringList(record.acceptance, WORKFLOW_SUGGESTION_MAX_STEP_ACCEPTANCE),
    }
  })
}

function sanitizeWorkflowSuggestionToolRequest(value: unknown): AgentToolRequest | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const args = sanitizeWorkflowSuggestionArguments(record.arguments)
  const toolId = sanitizeWorkflowSuggestionToolIdentity(record.toolId)
  const name = sanitizeWorkflowSuggestionToolIdentity(record.name)
  const serverId = sanitizeWorkflowSuggestionToolIdentity(record.serverId)
  const request: AgentToolRequest = {
    ...(toolId ? { toolId } : {}),
    ...(name ? { name } : {}),
    ...(isAgentToolSource(record.source) ? { source: record.source } : {}),
    ...(serverId ? { serverId } : {}),
    ...(args ? { arguments: args } : {}),
  }
  return request.toolId || request.name ? request : undefined
}

function sanitizeWorkflowSuggestionToolIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const safe = clampAgentOutput(redactSensitiveText(value).trim(), WORKFLOW_SUGGESTION_TOOL_IDENTITY_LIMIT)
    .replace(/\s+/g, ' ')
    .trim()
  return safe || undefined
}

function sanitizeWorkflowSuggestionArguments(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const serialized = safePendingActionStringify(value)
  if (!serialized || serialized.length > 1200) return undefined
  try {
    return JSON.parse(serialized) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function sanitizeWorkflowSuggestionValidation(value: unknown, workflow: AgentWorkflowDefinition): AgentWorkflowDefinitionValidation {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      errors: ['workflow suggestion validation is missing.'],
      warnings: workflowSuggestionWarnings(workflow),
      sanitized: workflow,
    }
  }
  const record = value as Record<string, unknown>
  const errors = sanitizeWorkflowSuggestionStringList(record.errors, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS)
  const warnings = [...new Set([
    ...sanitizeWorkflowSuggestionStringList(record.warnings, WORKFLOW_SUGGESTION_MAX_LIST_ITEMS),
    ...workflowSuggestionWarnings(workflow),
  ])]
  return {
    ok: record.ok === true && errors.length === 0,
    errors,
    warnings,
    sanitized: workflow,
  }
}

function workflowSuggestionWarnings(workflow: AgentWorkflowDefinition): string[] {
  return JSON.stringify(workflow).includes('[redacted]') ? ['sensitive text was redacted.'] : []
}

function appendWorkflowSuggestionValidationError(
  validation: AgentWorkflowDefinitionValidation,
  error: string
): AgentWorkflowDefinitionValidation {
  return {
    ...validation,
    ok: false,
    errors: [...new Set([...validation.errors, error])],
  }
}

function isMatchingWorkflowSuggestionSkill(value: unknown, workflow: AgentWorkflowDefinition): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const tags = sanitizeWorkflowSuggestionStringList(record.tags, 50)
  return (
    record.schema === 'islemind.skill.v1' &&
    record.id === `skill-${workflow.id}` &&
    tags.includes('agent-workflow') &&
    tags.includes(`workflow:${workflow.id}`)
  )
}

function buildSanitizedWorkflowSuggestionSkill(workflow: AgentWorkflowDefinition, value: unknown): SkillDefinition | undefined {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : workflow.createdAt
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : workflow.updatedAt
  const skill: SkillDefinition = {
    schema: 'islemind.skill.v1',
    id: `skill-${workflow.id}`,
    name: workflow.name,
    layer: 'advanced',
    version: '1.0.0',
    description: workflow.description ?? `Agentic workflow: ${workflow.name}`,
    tags: buildWorkflowSuggestionSkillTags(workflow),
    priority: typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : 50,
    systemPrompt: buildWorkflowSuggestionSkillPrompt(workflow),
    enabledTools: collectWorkflowSuggestionToolRefs(workflow),
    expectedReplyFormat: workflow.expectedOutput ? `agent-workflow-output:${workflow.expectedOutput}` : 'agent-workflow-output:reply',
    stackPolicy: 'append',
    createdAt,
    updatedAt,
  }
  const serialized = safePendingActionStringify(skill)
  return serialized && serialized.length > WORKFLOW_SUGGESTION_PAYLOAD_LIMIT ? undefined : skill
}

function buildWorkflowSuggestionSkillTags(workflow: AgentWorkflowDefinition): string[] {
  return [
    'agent-workflow',
    `workflow:${workflow.id}`,
    workflow.enabled ? 'workflow-status:enabled' : 'workflow-status:disabled',
    `permission:${workflow.permissionCeiling}`,
    workflow.expectedOutput ? `output:${workflow.expectedOutput}` : 'output:reply',
    ...workflow.triggerHints.map((hint) => `trigger:${hint}`).slice(0, 5),
  ].map((tag) => tag.slice(0, 80))
}

function buildWorkflowSuggestionSkillPrompt(workflow: AgentWorkflowDefinition): string {
  const stepLines = workflow.steps.map((step, index) => {
    const tool = formatWorkflowSuggestionToolRequest(step.toolRequest)
    const acceptance = step.acceptance?.length ? ` Acceptance: ${step.acceptance.join('; ')}.` : ''
    return `${index + 1}. ${step.title}${tool ? ` Tool: ${tool}.` : ''}${acceptance}`
  })

  return [
    `Agentic workflow: ${workflow.name}`,
    workflow.description ? `Description: ${workflow.description}` : '',
    `Permission ceiling: ${workflow.permissionCeiling}.`,
    `Expected output: ${workflow.expectedOutput ?? 'reply'}.`,
    'Execution policy: run only when the user selects, enables, or explicitly asks for this workflow. Do not create, modify, enable, or save workflows silently. Respect visible permission gates and preserve trace evidence.',
    'Steps:',
    ...stepLines,
    workflow.acceptanceChecks.length ? `Acceptance checks: ${workflow.acceptanceChecks.join('; ')}` : '',
    'Workflow definition:',
    exportAgentWorkflowDefinition(workflow),
  ].filter(Boolean).join('\n')
}

function collectWorkflowSuggestionToolRefs(workflow: AgentWorkflowDefinition): string[] {
  const refs = workflow.steps
    .map((step) => formatWorkflowSuggestionToolRequest(step.toolRequest))
    .filter(Boolean)
  return [...new Set(refs)]
}

function formatWorkflowSuggestionToolRequest(request?: AgentToolRequest): string {
  if (!request) return ''
  if (request.toolId) return request.toolId
  if (request.serverId && request.name) return `${request.serverId}:${request.name}`
  return request.name ?? ''
}

function sanitizeWorkflowSuggestionStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? clampAgentOutput(redactSensitiveText(item).trim(), WORKFLOW_SUGGESTION_TEXT_LIMIT).trim() : '')
    .filter(Boolean)
    .slice(0, limit)
}

function workflowSuggestionUnsafeReason(workflow: AgentWorkflowDefinition): string | undefined {
  if (workflow.steps.some((step) => workflowToolIdentityNeedsReview(step.toolRequest))) {
    return 'workflow tool identity contains sensitive or truncated text.'
  }
  const text = [
    workflow.name,
    workflow.description ?? '',
    ...workflow.triggerHints,
    ...workflow.acceptanceChecks,
    ...workflow.steps.map((step) => step.title),
    ...workflow.steps.map((step) => formatWorkflowSuggestionToolRequest(step.toolRequest)),
    ...workflow.steps.map((step) => safePendingActionStringify(step.toolRequest?.arguments ?? {}) ?? ''),
  ].join(' ')
  return text.includes(BLOCKED_WORKFLOW_ARGUMENT_EXECUTION_RISK) ||
    /\b(shell|terminal|powershell|cmd\.exe|bash|exec|spawn|eval|adb shell)\b/i.test(text) ||
    /彻底删除|永久删除|执行代码|运行命令|系统控制/.test(text)
    ? 'workflow definition contains arbitrary execution risk.'
    : undefined
}

function workflowToolIdentityNeedsReview(request?: AgentToolRequest): boolean {
  if (!request) return false
  return [request.toolId, request.name, request.serverId].some((value) => (
    typeof value === 'string' && (value.includes('[redacted]') || value.includes('[output truncated]'))
  ))
}

function isWorkflowSuggestionExpectedOutput(value: unknown): value is AgentWorkflowDefinition['expectedOutput'] {
  return value === 'reply' || value === 'rag-evidence' || value === 'work-artifact' || value === 'handoff' || value === 'diagnostic'
}

function isAgentWorkflowRecoveryReason(value: unknown): value is AgentWorkflowRecoveryReason {
  return value === 'workflow-disabled' ||
    value === 'workflow-review-required' ||
    value === 'workflow-invalid' ||
    value === 'workflow-selection-ambiguous'
}

function isCancelledWorkflowTrace(trace: ProcessTrace): boolean {
  if (!isWorkflowContinuationTrace(trace)) return false
  const metadata = trace.metadata ?? {}
  return trace.status === 'cancelled' ||
    metadata.status === 'cancelled' ||
    metadata.failureCode === 'cancelled' ||
    metadata.errorCode === 'cancelled'
}

function isFailedWorkflowTrace(trace: ProcessTrace): boolean {
  if (!isWorkflowContinuationTrace(trace)) return false
  if (isCancelledWorkflowTrace(trace)) return false
  const metadata = trace.metadata ?? {}
  return trace.status === 'error' ||
    metadata.status === 'error' ||
    typeof metadata.failureCode === 'string'
}

function isWorkflowContinuationTrace(trace: ProcessTrace): boolean {
  if (trace.type !== 'reasoning' && trace.type !== 'system') return false
  return trace.title === 'Agent workflow' ||
    trace.title === 'Agent synthesis' ||
    trace.title === 'Agent workflow skill'
}

function isWorkflowSkillSuggestionTrace(trace: ProcessTrace): boolean {
  return isWorkflowContinuationTrace(trace)
}

function isCompletedWorkArtifactFollowUpTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata ?? {}
  return trace.type === 'tool' &&
    trace.status === 'done' &&
    metadata.source === 'work-artifact' &&
    metadata.contract === WORK_ARTIFACT_WORKFLOW_CONTRACT &&
    typeof metadata.followUpPrompt === 'string' &&
    Boolean(metadata.followUpPrompt.trim())
}

function isAgentWorkflowSkillSuggestion(value: unknown): value is AgentWorkflowSkillSuggestion {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const workflow = record.workflow as Record<string, unknown> | undefined
  return (
    typeof record.ok === 'boolean' &&
    record.requiresUserApproval === true &&
    typeof record.approvalSummary === 'string' &&
    !!workflow &&
    workflow.schema === 'islemind.agent.workflow.v1' &&
    typeof workflow.id === 'string' &&
    typeof workflow.name === 'string'
  )
}

function resolveAgentMessageStatus(reply: AgenticChatWorkflowReply): Message['status'] {
  if (!reply.handled) return 'done'
  if (reply.status === 'cancelled') return 'cancelled'
  if (reply.status === 'done' || reply.status === 'waiting' || reply.status === 'skipped') return 'done'
  return 'error'
}

function settleTraceForMessage(trace: ProcessTrace): ProcessTrace {
  if ((trace.status === 'pending' || trace.status === 'running') && trace.completedAt) {
    return { ...trace, status: 'done' }
  }
  if (trace.status === 'pending' || trace.status === 'running') {
    return {
      ...trace,
      status: trace.content ? 'done' : 'skipped',
      completedAt: trace.completedAt ?? Date.now(),
    }
  }
  return trace
}

function buildAgentEstimatedUsage(content: string): MessageUsage {
  const outputTokens = estimateAgentTokens(content)
  return {
    inputTokens: 0,
    outputTokens,
    totalTokens: outputTokens,
    source: 'estimated',
  }
}

function estimateAgentTokens(content: string): number {
  const trimmed = content.trim()
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0
}
