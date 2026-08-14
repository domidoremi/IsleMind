import type { AssistantRunId, Clock, ProcessTrace, ToolContentBlock } from '@/core'

const TOOL_INPUT_SUMMARY_LIMIT = 360
const STEP_TITLE_LIMIT = 160
const TOOL_ARGUMENT_SNAPSHOT_DEPTH_LIMIT = 12
const TOOL_ARGUMENT_SNAPSHOT_PROPERTY_LIMIT = 256

export type WorkflowStepToolSource =
  | 'mcp'
  | 'builtin'
  | 'app-action'
  | 'rag'
  | 'search'
  | 'work-artifact'
  | 'android'

export type WorkflowStepFailureCode =
  | 'provider_unavailable'
  | 'tool_unavailable'
  | 'permission_required'
  | 'schema_invalid'
  | 'rag_unavailable'
  | 'evidence_insufficient'
  | 'cancelled'
  | 'step_limit_reached'
  | 'policy_denied'
  | 'execution_failed'

export type WorkflowStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
export type WorkflowStepObservationStatus = 'done' | 'error' | 'skipped'

export interface WorkflowStepToolRequest {
  toolId?: string
  name?: string
  source?: WorkflowStepToolSource
  serverId?: string
  arguments?: Record<string, unknown>
}

export interface WorkflowStepObservation {
  ok: boolean
  status: WorkflowStepObservationStatus
  output: string
  blocks?: readonly ToolContentBlock[]
  diagnostic: ProcessTrace
  errorCode?: WorkflowStepFailureCode
  metadata?: Record<string, unknown>
}

export interface WorkflowStep<TRequest extends WorkflowStepToolRequest = WorkflowStepToolRequest> {
  id: string
  title: string
  status: WorkflowStepStatus
  toolRequest?: TRequest
  observation?: WorkflowStepObservation
  trace: ProcessTrace[]
  startedAt?: number
  completedAt?: number
}

export interface WorkflowStepRuntimeOptions {
  intentVisible?: boolean
  userConfirmed?: boolean
  evidenceSources?: readonly string[]
  evidenceSummary?: string
  stepIndex?: number
  toolCallIndex?: number
  limits?: object
  signal?: AbortSignal
}

export interface ExecuteWorkflowStepInput<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
> {
  id: string
  title: string
  assistantRunId?: AssistantRunId
  toolRequest?: TRequest
  planStepCount?: number
  options?: TOptions
  intentVisible?: boolean
  userConfirmed?: boolean
  evidenceSources?: readonly string[]
  evidenceSummary?: string
  stepIndex?: number
  toolCallIndex?: number
  limits?: TOptions['limits']
  signal?: AbortSignal
}

export interface WorkflowStepToolExecutionInput<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
> {
  stepId: string
  assistantRunId?: AssistantRunId
  request: TRequest
  options: TOptions
}

export interface WorkflowStepExecutorDependencies<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
> {
  clock: Clock
  executeTool(
    input: WorkflowStepToolExecutionInput<TRequest, TOptions>,
  ): Promise<WorkflowStepObservation | undefined>
  redactText(value: string): string
  projectTrace(trace: ProcessTrace): ProcessTrace
}

export type WorkflowStepExecutor<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
> = (
  input: ExecuteWorkflowStepInput<TRequest, TOptions>,
) => Promise<WorkflowStep<TRequest>>

export function createWorkflowStepExecutor<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
>(
  dependencies: WorkflowStepExecutorDependencies<TRequest, TOptions>,
): WorkflowStepExecutor<TRequest, TOptions> {
  return async (input) => {
    const startedAt = dependencies.clock.now()
    const toolInputMetadata = createToolInputTraceMetadata(input.toolRequest, input, dependencies.redactText)
    const traces: ProcessTrace[] = [
      dependencies.projectTrace({
        id: `${input.id}-start`,
        type: 'reasoning',
        title: input.title,
        content: input.toolRequest
          ? `Starting tool step ${input.toolRequest.name ?? input.toolRequest.toolId}.`
          : 'No tool call was required.',
        status: input.toolRequest ? 'running' : 'done',
        startedAt,
        ...(toolInputMetadata ? { metadata: toolInputMetadata } : {}),
      }),
    ]

    if (input.signal?.aborted) {
      const cancelled = withStepObservationTraceMetadata(
        input,
        createCancelledToolObservation(input.id, startedAt, dependencies.projectTrace),
        dependencies,
      )
      return completeStep(input, traces, cancelled, 'cancelled', startedAt, dependencies.clock)
    }

    if (!input.toolRequest) {
      return {
        id: input.id,
        title: input.title,
        status: 'done',
        trace: traces,
        startedAt,
        completedAt: dependencies.clock.now(),
      }
    }

    const { mode: _ignoredLegacyMode, ...modeFreeOptions } = (input.options ?? {}) as TOptions & {
      mode?: unknown
    }
    const executionOptions = {
      ...modeFreeOptions,
      intentVisible: input.intentVisible ?? input.options?.intentVisible,
      userConfirmed: input.userConfirmed ?? input.options?.userConfirmed,
      evidenceSources: input.evidenceSources ?? input.options?.evidenceSources,
      evidenceSummary: input.evidenceSummary ?? input.options?.evidenceSummary,
      stepIndex: input.stepIndex ?? input.options?.stepIndex,
      toolCallIndex: input.toolCallIndex ?? input.options?.toolCallIndex,
      limits: input.limits ?? input.options?.limits,
      signal: input.signal ?? input.options?.signal,
    } as TOptions
    const observation = await dependencies.executeTool({
      stepId: input.id,
      ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
      request: input.toolRequest,
      options: executionOptions,
    }) ?? unavailableToolObservation(input.toolRequest, dependencies)
    const attributedObservation = withStepObservationTraceMetadata(input, observation, dependencies)
    traces.push(attributedObservation.diagnostic)

    if (input.signal?.aborted) {
      const cancelled = withStepObservationTraceMetadata(
        input,
        createCancelledToolObservation(input.id, startedAt, dependencies.projectTrace),
        dependencies,
      )
      traces.push(cancelled.diagnostic)
      return completeStep(input, traces, cancelled, 'cancelled', startedAt, dependencies.clock)
    }

    return completeStep(
      input,
      traces,
      attributedObservation,
      attributedObservation.status === 'done' ? 'done' : attributedObservation.status,
      startedAt,
      dependencies.clock,
    )
  }
}

function unavailableToolObservation<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
>(
  request: TRequest,
  dependencies: WorkflowStepExecutorDependencies<TRequest, TOptions>,
): WorkflowStepObservation {
  const identity = request.name ?? request.toolId ?? 'unknown'
  const startedAt = dependencies.clock.now()
  const message = 'Tool is unavailable.'
  return {
    ok: false,
    status: 'error',
    output: message,
    blocks: [{ type: 'text', text: message }],
    diagnostic: dependencies.projectTrace({
      id: `agent-tool-unavailable-${startedAt}`,
      type: 'tool',
      title: `Agent ${identity}`,
      content: message,
      status: 'error',
      startedAt,
      metadata: { errorCode: 'tool_unavailable' },
    }),
    errorCode: 'tool_unavailable',
  }
}

function createToolInputTraceMetadata<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
>(
  toolRequest: TRequest | undefined,
  input: ExecuteWorkflowStepInput<TRequest, TOptions>,
  redactText: (value: string) => string,
): Record<string, unknown> | undefined {
  const stepProgress = createStepProgressMetadata(input)
  if (!toolRequest) return stepProgress
  const metadata: Record<string, unknown> = {}
  if (toolRequest.name) metadata.toolName = toolRequest.name
  if (toolRequest.toolId) metadata.toolId = toolRequest.toolId
  if (toolRequest.source) metadata.toolSource = toolRequest.source

  const inputSummary = summarizeToolInputArguments(toolRequest.arguments, redactText)
  if (inputSummary.summary) {
    metadata.inputSummary = inputSummary.summary
    metadata.inputSummaryRedacted = inputSummary.redacted
  }
  return Object.keys(metadata).length || stepProgress
    ? { ...stepProgress, ...metadata }
    : undefined
}

function createStepProgressMetadata<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
>(
  input: ExecuteWorkflowStepInput<TRequest, TOptions>,
): Record<string, unknown> | undefined {
  if (!Number.isInteger(input.stepIndex) || input.stepIndex === undefined || input.stepIndex < 0) return undefined
  const metadata: Record<string, unknown> = {
    stepIndex: input.stepIndex,
    stepNumber: input.stepIndex + 1,
  }
  if (
    Number.isInteger(input.planStepCount) &&
    input.planStepCount !== undefined &&
    input.planStepCount >= input.stepIndex + 1
  ) {
    metadata.planStepCount = input.planStepCount
  }
  return metadata
}

function withStepObservationTraceMetadata<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
>(
  input: ExecuteWorkflowStepInput<TRequest, TOptions>,
  observation: WorkflowStepObservation,
  dependencies: WorkflowStepExecutorDependencies<TRequest, TOptions>,
): WorkflowStepObservation {
  return {
    ...observation,
    diagnostic: dependencies.projectTrace({
      ...observation.diagnostic,
      metadata: {
        ...observation.diagnostic.metadata,
        ...createStepObservationTraceMetadata(input, dependencies.redactText),
      },
    }),
  }
}

function createStepObservationTraceMetadata<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
>(
  input: ExecuteWorkflowStepInput<TRequest, TOptions>,
  redactText: (value: string) => string,
): Record<string, unknown> {
  return {
    ...(createStepProgressMetadata(input) ?? {}),
    stepId: input.id,
    stepTitle: clampOutput(redactText(input.title.trim()), STEP_TITLE_LIMIT).replace(/\n\[output truncated\]$/, ''),
  }
}

function summarizeToolInputArguments(
  args: Record<string, unknown> | undefined,
  redactText: (value: string) => string,
): { summary: string; redacted: boolean } {
  if (!args) return { summary: '', redacted: false }
  const snapshot = snapshotToolArguments(args, {
    seen: new WeakSet<object>(),
    remainingProperties: TOOL_ARGUMENT_SNAPSHOT_PROPERTY_LIMIT,
  })
  if (!snapshot.ok || !snapshot.hasEnumerableValue) return { summary: '', redacted: false }

  let serialized = ''
  try {
    serialized = JSON.stringify(snapshot.value)
  } catch {
    serialized = '[unserializable tool arguments]'
  }
  if (!serialized) return { summary: '', redacted: false }
  const redacted = redactText(serialized)
  return {
    summary: clampOutput(redacted, TOOL_INPUT_SUMMARY_LIMIT),
    redacted: redacted !== serialized,
  }
}

interface ToolArgumentSnapshotState {
  seen: WeakSet<object>
  remainingProperties: number
}

type ToolArgumentSnapshot =
  | { ok: true; value: unknown; hasEnumerableValue: boolean }
  | { ok: false }

function snapshotToolArguments(
  value: unknown,
  state: ToolArgumentSnapshotState,
  depth = 0,
): ToolArgumentSnapshot {
  if (value === null || typeof value !== 'object') {
    const safeValue = typeof value === 'function' || typeof value === 'symbol' ? undefined : value
    return { ok: true, value: safeValue, hasEnumerableValue: safeValue !== undefined }
  }
  if (depth > TOOL_ARGUMENT_SNAPSHOT_DEPTH_LIMIT || state.seen.has(value)) return { ok: false }

  let isArray: boolean
  let keys: readonly PropertyKey[]
  try {
    isArray = Array.isArray(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return { ok: false }
  }
  state.seen.add(value)

  if (isArray) {
    let lengthDescriptor: PropertyDescriptor | undefined
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    } catch {
      return { ok: false }
    }
    if (
      !lengthDescriptor ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > TOOL_ARGUMENT_SNAPSHOT_PROPERTY_LIMIT
    ) {
      return { ok: false }
    }
  }

  const snapshot: Record<PropertyKey, unknown> | unknown[] = isArray
    ? Object.setPrototypeOf([], null)
    : Object.create(null)
  let hasEnumerableValue = false
  for (const key of keys) {
    if (typeof key === 'symbol' || key === 'length') continue
    if (state.remainingProperties <= 0) return { ok: false }

    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return { ok: false }
    }
    if (!descriptor || !descriptor.enumerable) continue
    if (!Object.hasOwn(descriptor, 'value')) return { ok: false }

    state.remainingProperties -= 1
    const child = snapshotToolArguments(descriptor.value, state, depth + 1)
    if (!child.ok) return child
    try {
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: child.value,
      })
    } catch {
      return { ok: false }
    }
    hasEnumerableValue = true
  }
  return { ok: true, value: snapshot, hasEnumerableValue }
}

function completeStep<
  TRequest extends WorkflowStepToolRequest,
  TOptions extends WorkflowStepRuntimeOptions,
>(
  input: ExecuteWorkflowStepInput<TRequest, TOptions>,
  traces: ProcessTrace[],
  observation: WorkflowStepObservation,
  status: WorkflowStepStatus,
  startedAt: number,
  clock: Clock,
): WorkflowStep<TRequest> {
  return {
    id: input.id,
    title: input.title,
    status,
    toolRequest: input.toolRequest,
    observation,
    trace: traces,
    startedAt,
    completedAt: clock.now(),
  }
}

function createCancelledToolObservation(
  stepId: string,
  startedAt: number,
  projectTrace: (trace: ProcessTrace) => ProcessTrace,
): WorkflowStepObservation {
  const message = 'Agent workflow execution was cancelled.'
  return {
    ok: false,
    status: 'skipped',
    output: message,
    blocks: [{ type: 'text', text: message }],
    diagnostic: projectTrace({
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

function clampOutput(input: string, limit: number): string {
  const max = Math.max(0, limit)
  if (input.length <= max) return input
  return `${input.slice(0, Math.max(0, max - 32)).trimEnd()}\n[output truncated]`
}
