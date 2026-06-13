import type { ProcessTrace } from '@/types'
import type {
  AgentPermissionContext,
  AgentStep,
  AgentToolRequest,
  AgentToolResult,
} from '@/services/agent/agentToolTypes'
import { executeAgentTool, type ExecuteAgentToolOptions } from '@/services/agent/agentToolRegistry'
import { clampAgentOutput, createAgentTrace, redactSensitiveText } from '@/services/agent/agentTrace'

const TOOL_INPUT_SUMMARY_LIMIT = 360

export interface ExecuteAgentStepInput extends AgentPermissionContext {
  id: string
  title: string
  toolRequest?: AgentToolRequest
  planStepCount?: number
  options?: ExecuteAgentToolOptions
  signal?: AbortSignal
}

export async function executeAgentStep(input: ExecuteAgentStepInput): Promise<AgentStep> {
  const startedAt = Date.now()
  const toolInputMetadata = createToolInputTraceMetadata(input.toolRequest, input)
  const traces: ProcessTrace[] = [
    createAgentTrace({
      id: `${input.id}-start`,
      type: 'reasoning',
      title: input.title,
      content: input.toolRequest ? `Starting tool step ${input.toolRequest.name ?? input.toolRequest.toolId}.` : 'No tool call was required.',
      status: input.toolRequest ? 'running' : 'done',
      startedAt,
      ...(toolInputMetadata ? { metadata: toolInputMetadata } : {}),
    }),
  ]

  if (input.signal?.aborted) {
    const cancelled = withStepObservationTraceMetadata(input, createCancelledToolResult(input.id, startedAt))
    return completeStep(input, traces, cancelled, 'cancelled', startedAt)
  }

  if (!input.toolRequest) {
    return {
      id: input.id,
      title: input.title,
      status: 'done',
      trace: traces,
      startedAt,
      completedAt: Date.now(),
    }
  }

  const observation = await executeAgentTool(input.toolRequest, {
    ...input.options,
    intentVisible: input.intentVisible ?? input.options?.intentVisible,
    userConfirmed: input.userConfirmed ?? input.options?.userConfirmed,
    stepIndex: input.stepIndex ?? input.options?.stepIndex,
    toolCallIndex: input.toolCallIndex ?? input.options?.toolCallIndex,
    limits: input.limits ?? input.options?.limits,
    signal: input.signal ?? input.options?.signal,
  })
  const attributedObservation = withStepObservationTraceMetadata(input, observation)
  traces.push(attributedObservation.trace)

  if (input.signal?.aborted) {
    const cancelled = withStepObservationTraceMetadata(input, createCancelledToolResult(input.id, startedAt))
    traces.push(cancelled.trace)
    return completeStep(input, traces, cancelled, 'cancelled', startedAt)
  }

  return completeStep(input, traces, attributedObservation, attributedObservation.status === 'done' ? 'done' : attributedObservation.status, startedAt)
}

function createToolInputTraceMetadata(toolRequest: AgentToolRequest | undefined, input: ExecuteAgentStepInput): Record<string, unknown> | undefined {
  const stepProgress = createStepProgressMetadata(input)
  if (!toolRequest) return stepProgress
  const metadata: Record<string, unknown> = {}
  if (toolRequest.name) metadata.toolName = toolRequest.name
  if (toolRequest.toolId) metadata.toolId = toolRequest.toolId
  if (toolRequest.source) metadata.toolSource = toolRequest.source

  const inputSummary = summarizeToolInputArguments(toolRequest.arguments)
  if (inputSummary.summary) {
    metadata.inputSummary = inputSummary.summary
    metadata.inputSummaryRedacted = inputSummary.redacted
  }
  return Object.keys(metadata).length || stepProgress
    ? { ...stepProgress, ...metadata }
    : undefined
}

function createStepProgressMetadata(input: ExecuteAgentStepInput): Record<string, unknown> | undefined {
  if (!Number.isInteger(input.stepIndex) || input.stepIndex === undefined || input.stepIndex < 0) return undefined
  const metadata: Record<string, unknown> = {
    stepIndex: input.stepIndex,
    stepNumber: input.stepIndex + 1,
  }
  if (Number.isInteger(input.planStepCount) && input.planStepCount !== undefined && input.planStepCount >= input.stepIndex + 1) {
    metadata.planStepCount = input.planStepCount
  }
  return metadata
}

function withStepObservationTraceMetadata(input: ExecuteAgentStepInput, observation: AgentToolResult): AgentToolResult {
  return {
    ...observation,
    trace: createAgentTrace({
      ...observation.trace,
      metadata: {
        ...observation.trace.metadata,
        ...createStepObservationTraceMetadata(input),
      },
    }),
  }
}

function createStepObservationTraceMetadata(input: ExecuteAgentStepInput): Record<string, unknown> {
  return {
    ...(createStepProgressMetadata(input) ?? {}),
    stepId: input.id,
    stepTitle: clampAgentOutput(redactSensitiveText(input.title.trim()), 160).replace(/\n\[output truncated\]$/, ''),
  }
}

function summarizeToolInputArguments(args: Record<string, unknown> | undefined): { summary: string; redacted: boolean } {
  if (!args || Object.keys(args).length === 0) return { summary: '', redacted: false }
  let serialized = ''
  try {
    serialized = JSON.stringify(args)
  } catch {
    serialized = '[unserializable tool arguments]'
  }
  const redacted = redactSensitiveText(serialized)
  return {
    summary: clampAgentOutput(redacted, TOOL_INPUT_SUMMARY_LIMIT),
    redacted: redacted !== serialized,
  }
}

function completeStep(
  input: ExecuteAgentStepInput,
  traces: ProcessTrace[],
  observation: AgentToolResult,
  status: AgentStep['status'],
  startedAt: number
): AgentStep {
  return {
    id: input.id,
    title: input.title,
    status,
    toolRequest: input.toolRequest,
    observation,
    trace: traces,
    startedAt,
    completedAt: Date.now(),
  }
}

function createCancelledToolResult(stepId: string, startedAt: number): AgentToolResult {
  const message = 'Agent workflow execution was cancelled.'
  return {
    ok: false,
    status: 'skipped',
    output: message,
    blocks: [{ type: 'text', text: message }],
    trace: createAgentTrace({
      id: `${stepId}-cancelled`,
      type: 'system',
      title: 'Agent cancelled',
      content: message,
      status: 'skipped',
      startedAt,
      metadata: { errorCode: 'cancelled' },
    }),
    errorCode: 'cancelled',
  }
}
