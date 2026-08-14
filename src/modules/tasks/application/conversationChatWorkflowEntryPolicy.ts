import type { AssistantRunId, ProcessTrace } from '@/core'
import type { WorkflowCheckpointStore } from './workflowCheckpoint'

export type ConversationChatWorkflowEntryIntent =
  | 'plain_chat'
  | 'settings_action'
  | 'tool_task'
  | 'rag_evidence'
  | 'work_artifact'
  | 'handoff'
  | 'diagnostic'

export type ConversationChatWorkflowEntryToolSource =
  | 'mcp'
  | 'builtin'
  | 'app-action'
  | 'rag'
  | 'search'
  | 'work-artifact'
  | 'android'

export type ConversationChatWorkflowEntryRequestedOutput = 'auto' | 'reply' | 'work-artifact'
export type ConversationChatWorkflowEntryRunStatus =
  | 'planning'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'cancelled'
export type ConversationChatWorkflowEntryFailureCode =
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

export interface ConversationChatWorkflowEntryToolRequest {
  toolId?: string
  name?: string
  source?: ConversationChatWorkflowEntryToolSource
  serverId?: string
  arguments?: Record<string, unknown>
}

export interface ConversationChatWorkflowEntryIntentClassification<
  TRequest extends ConversationChatWorkflowEntryToolRequest = ConversationChatWorkflowEntryToolRequest,
> {
  intent: ConversationChatWorkflowEntryIntent
  shouldRunWorkflow: boolean
  confidence: number
  reasons: string[]
  suggestedToolRequest?: TRequest
  trace: ProcessTrace
}

export interface ConversationChatWorkflowEntryRuntimeLogOptions {
  enabled?: boolean
  maxBytes?: number
}

export interface ConversationChatWorkflowEntryRunLimits {
  maxSteps: number
  maxToolCallsPerStep: number
  allowReadOnlyTools: boolean
  allowReadWriteTools: boolean | 'visible'
  allowDestructiveTools: boolean | 'confirm'
  allowBackgroundContinuation: boolean
  requireTrace: boolean
  outputCharLimit: number
}

export interface ConversationChatWorkflowEntryInput<
  TRequest extends ConversationChatWorkflowEntryToolRequest = ConversationChatWorkflowEntryToolRequest,
  TWorkflowDefinition = unknown,
  TManifest = unknown,
  TRagRuntime = unknown,
> {
  content: string
  assistantRunId?: AssistantRunId
  workflowCheckpointStore?: WorkflowCheckpointStore
  conversationTitle?: string
  explicitToolRequest?: TRequest
  requestedOutput?: ConversationChatWorkflowEntryRequestedOutput
  workflowDefinition?: TWorkflowDefinition
  manifests?: TManifest[]
  ragRuntime?: TRagRuntime
  runtimeLog?: ConversationChatWorkflowEntryRuntimeLogOptions
  limits?: Partial<ConversationChatWorkflowEntryRunLimits>
  intentVisible?: boolean
  userConfirmed?: boolean
  signal?: AbortSignal
  forceConversationChatWorkflowCancellation?: boolean
  now?: number
}

export interface ConversationChatWorkflowEntryDecision<
  TClassification extends ConversationChatWorkflowEntryIntentClassification = ConversationChatWorkflowEntryIntentClassification,
> {
  shouldHandle: boolean
  reason: ConversationChatWorkflowEntryReason
  classification: TClassification
  traces: ProcessTrace[]
}

export type ConversationChatWorkflowEntryReason =
  | 'direct-chat'
  | 'explicit-tool-request'
  | 'work-artifact'
  | 'selected-workflow-skill'
  | 'rag-runtime-ready'
  | 'rag-runtime-missing'
  | 'settings-local-command-router'
  | 'planner-tool-missing'
  | 'cancelled'

export interface ConversationChatWorkflowEntryWorkflowRun {
  status: ConversationChatWorkflowEntryRunStatus
  traces: ProcessTrace[]
  finalOutput?: string
  failureCode?: ConversationChatWorkflowEntryFailureCode
}

export interface WorkflowSkillSuggestionAttachment {
  ok: boolean
  skill?: unknown
}

export interface ConversationChatWorkflowReply<
  TRun extends ConversationChatWorkflowEntryWorkflowRun = ConversationChatWorkflowEntryWorkflowRun,
> {
  handled: boolean
  content: string
  status: 'done' | 'waiting' | 'error' | 'skipped' | 'cancelled'
  traces: ProcessTrace[]
  run?: TRun
  failureCode?: ConversationChatWorkflowEntryFailureCode
}

export interface ClassifyConversationChatWorkflowEntryInput<
  TRequest extends ConversationChatWorkflowEntryToolRequest,
> {
  goal: string
  content: string
  explicitToolRequest: TRequest | undefined
  requestedOutput: ConversationChatWorkflowEntryRequestedOutput | undefined
  now: number | undefined
}

export interface RunConversationChatWorkflowInput<
  TRequest extends ConversationChatWorkflowEntryToolRequest,
  TWorkflowDefinition,
  TManifest,
  TRagRuntime,
> {
  goal: string
  assistantRunId?: AssistantRunId
  workflowCheckpointStore?: WorkflowCheckpointStore
  content: string
  toolRequest: TRequest | undefined
  requestedOutput: ConversationChatWorkflowEntryRequestedOutput | undefined
  workflowDefinition: TWorkflowDefinition | undefined
  manifests: TManifest[] | undefined
  ragRuntime: TRagRuntime | undefined
  runtimeLog: ConversationChatWorkflowEntryRuntimeLogOptions | undefined
  limits: Partial<ConversationChatWorkflowEntryRunLimits> | undefined
  intentVisible: boolean | undefined
  userConfirmed: boolean | undefined
  signal: AbortSignal | undefined
  now: number | undefined
}

export interface ConversationChatWorkflowEntryPolicyDependencies<
  TRequest extends ConversationChatWorkflowEntryToolRequest,
  TWorkflowDefinition,
  TManifest,
  TRagRuntime,
  TClassification extends ConversationChatWorkflowEntryIntentClassification<TRequest>,
  TRun extends ConversationChatWorkflowEntryWorkflowRun,
  TSuggestion extends WorkflowSkillSuggestionAttachment,
> {
  classifyConversationChatWorkflowIntent(
    input: ClassifyConversationChatWorkflowEntryInput<TRequest>,
  ): TClassification
  runConversationChatWorkflow(
    input: RunConversationChatWorkflowInput<
      TRequest,
      TWorkflowDefinition,
      TManifest,
      TRagRuntime
    >,
  ): Promise<TRun>
  createWorkflowSkillSuggestionFromRun(input: {
    run: TRun
    manifests: TManifest[]
    now: number | undefined
  }): TSuggestion | undefined
}

export interface ConversationChatWorkflowEntryPolicy<
  TRequest extends ConversationChatWorkflowEntryToolRequest,
  TWorkflowDefinition,
  TManifest,
  TRagRuntime,
  TClassification extends ConversationChatWorkflowEntryIntentClassification<TRequest>,
  TRun extends ConversationChatWorkflowEntryWorkflowRun,
> {
  decideConversationChatWorkflowEntry(
    input: ConversationChatWorkflowEntryInput<
      TRequest,
      TWorkflowDefinition,
      TManifest,
      TRagRuntime
    >,
  ): ConversationChatWorkflowEntryDecision<TClassification>
  runConversationChatWorkflow(
    input: ConversationChatWorkflowEntryInput<
      TRequest,
      TWorkflowDefinition,
      TManifest,
      TRagRuntime
    >,
  ): Promise<ConversationChatWorkflowReply<TRun>>
  formatConversationChatWorkflowReply(run: TRun): string
}

export function createConversationChatWorkflowEntryPolicy<
  TRequest extends ConversationChatWorkflowEntryToolRequest,
  TWorkflowDefinition,
  TManifest,
  TRagRuntime,
  TClassification extends ConversationChatWorkflowEntryIntentClassification<TRequest>,
  TRun extends ConversationChatWorkflowEntryWorkflowRun,
  TSuggestion extends WorkflowSkillSuggestionAttachment,
>(
  dependencies: ConversationChatWorkflowEntryPolicyDependencies<
    TRequest,
    TWorkflowDefinition,
    TManifest,
    TRagRuntime,
    TClassification,
    TRun,
    TSuggestion
  >,
): ConversationChatWorkflowEntryPolicy<
  TRequest,
  TWorkflowDefinition,
  TManifest,
  TRagRuntime,
  TClassification,
  TRun
> {
  const decideConversationChatWorkflowEntry = (
    input: ConversationChatWorkflowEntryInput<
      TRequest,
      TWorkflowDefinition,
      TManifest,
      TRagRuntime
    >,
  ): ConversationChatWorkflowEntryDecision<TClassification> => {
    const classification = dependencies.classifyConversationChatWorkflowIntent({
      goal: input.content,
      content: input.content,
      explicitToolRequest: input.explicitToolRequest,
      requestedOutput: input.requestedOutput,
      now: input.now,
    })

    if (input.forceConversationChatWorkflowCancellation && input.signal?.aborted) {
      return decision(true, 'cancelled', classification)
    }

    if (input.explicitToolRequest) {
      return cancellableDecision(input, 'explicit-tool-request', classification)
    }
    if (input.workflowDefinition) {
      return cancellableDecision(input, 'selected-workflow-skill', classification)
    }
    if (input.requestedOutput === 'work-artifact') {
      return cancellableDecision(input, 'work-artifact', classification)
    }

    switch (classification.intent) {
      case 'plain_chat':
        return decision(false, 'direct-chat', classification)
      case 'settings_action':
        return decision(false, 'settings-local-command-router', classification)
      case 'work_artifact':
        return cancellableDecision(input, 'work-artifact', classification)
      case 'rag_evidence':
        return input.ragRuntime
          ? cancellableDecision(input, 'rag-runtime-ready', classification)
          : decision(false, 'rag-runtime-missing', classification)
      case 'handoff':
      case 'diagnostic':
      case 'tool_task':
        return classification.suggestedToolRequest
          ? cancellableDecision(input, 'explicit-tool-request', classification)
          : decision(false, 'planner-tool-missing', classification)
    }
  }

  const formatConversationChatWorkflowReply = (run: TRun): string => {
    const output = run.finalOutput?.trim()
    if (run.status === 'done') return output || 'Agentic workflow completed.'
    if (run.status === 'waiting') {
      return output || `Agentic workflow paused: ${run.failureCode ?? 'permission_required'}.`
    }
    if (run.status === 'cancelled') return output || 'Agentic workflow was cancelled.'
    return output || `Agentic workflow failed: ${run.failureCode ?? 'execution_failed'}.`
  }

  const runConversationChatWorkflow = async (
    input: ConversationChatWorkflowEntryInput<
      TRequest,
      TWorkflowDefinition,
      TManifest,
      TRagRuntime
    >,
  ): Promise<ConversationChatWorkflowReply<TRun>> => {
    const entry = decideConversationChatWorkflowEntry(input)
    if (!entry.shouldHandle) {
      return {
        handled: false,
        status: 'skipped',
        content: formatSkippedChatEntry(entry.reason),
        traces: entry.traces,
      }
    }

    const run = await dependencies.runConversationChatWorkflow({
      goal: input.content,
      ...(input.assistantRunId ? { assistantRunId: input.assistantRunId } : {}),
      ...(input.workflowCheckpointStore
        ? { workflowCheckpointStore: input.workflowCheckpointStore }
        : {}),
      content: input.content,
      toolRequest: input.explicitToolRequest,
      requestedOutput: input.requestedOutput,
      workflowDefinition: input.workflowDefinition,
      manifests: input.manifests,
      ragRuntime: input.ragRuntime,
      runtimeLog: input.runtimeLog,
      limits: input.limits,
      intentVisible: input.intentVisible,
      userConfirmed: input.userConfirmed,
      signal: input.signal,
      now: input.now,
    })

    const traces = attachWorkflowSkillSuggestion(
      run.traces,
      run,
      input.manifests ?? [],
      input.now,
      dependencies.createWorkflowSkillSuggestionFromRun,
    )
    return {
      handled: true,
      status: run.status === 'done'
        ? 'done'
        : run.status === 'waiting'
          ? 'waiting'
          : run.status === 'cancelled'
            ? 'cancelled'
            : run.status === 'error'
              ? 'error'
              : 'skipped',
      content: formatConversationChatWorkflowReply(run),
      traces,
      run,
      failureCode: run.failureCode,
    }
  }

  return {
    decideConversationChatWorkflowEntry,
    runConversationChatWorkflow,
    formatConversationChatWorkflowReply,
  }
}

function decision<
  TClassification extends ConversationChatWorkflowEntryIntentClassification,
>(
  shouldHandle: boolean,
  reason: ConversationChatWorkflowEntryReason,
  classification: TClassification,
): ConversationChatWorkflowEntryDecision<TClassification> {
  return {
    shouldHandle,
    reason,
    classification,
    traces: [classification.trace],
  }
}

function cancellableDecision<
  TRequest extends ConversationChatWorkflowEntryToolRequest,
  TWorkflowDefinition,
  TManifest,
  TRagRuntime,
  TClassification extends ConversationChatWorkflowEntryIntentClassification<TRequest>,
>(
  input: ConversationChatWorkflowEntryInput<
    TRequest,
    TWorkflowDefinition,
    TManifest,
    TRagRuntime
  >,
  reason: ConversationChatWorkflowEntryReason,
  classification: TClassification,
): ConversationChatWorkflowEntryDecision<TClassification> {
  if (input.signal?.aborted) return decision(true, 'cancelled', classification)
  return decision(true, reason, classification)
}

function formatSkippedChatEntry(reason: ConversationChatWorkflowEntryReason): string {
  switch (reason) {
    case 'direct-chat':
      return 'Direct chat path selected.'
    case 'settings-local-command-router':
      return 'Settings action is handled by the local command router.'
    case 'rag-runtime-missing':
      return 'RAG evidence workflow requires a RAG runtime adapter.'
    case 'planner-tool-missing':
      return 'Agentic planner did not produce an executable tool step.'
    case 'cancelled':
      return 'Agentic workflow entry was cancelled.'
    case 'explicit-tool-request':
    case 'selected-workflow-skill':
    case 'work-artifact':
    case 'rag-runtime-ready':
      return 'Agentic workflow entry is ready.'
  }
}

function attachWorkflowSkillSuggestion<
  TManifest,
  TRun extends ConversationChatWorkflowEntryWorkflowRun,
  TSuggestion extends WorkflowSkillSuggestionAttachment,
>(
  traces: ProcessTrace[],
  run: TRun,
  manifests: TManifest[],
  now: number | undefined,
  createSuggestion: (input: {
    run: TRun
    manifests: TManifest[]
    now: number | undefined
  }) => TSuggestion | undefined,
): ProcessTrace[] {
  const suggestion = createSuggestion({ run, manifests, now })
  if (!suggestion?.ok || !suggestion.skill) return traces
  const completionIndex = findCompletionTraceIndex(traces, run.status)
  const targetIndex = completionIndex >= 0 ? completionIndex : traces.length - 1
  return traces.map((trace, index) => index === targetIndex
    ? {
        ...trace,
        metadata: {
          ...trace.metadata,
          workflowSkillSuggestion: suggestion,
        },
      }
    : trace)
}

function findCompletionTraceIndex(
  traces: ProcessTrace[],
  status: ConversationChatWorkflowEntryRunStatus,
): number {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (trace.title === 'Agent workflow' && trace.metadata?.status === status) {
      return index
    }
  }
  return -1
}
