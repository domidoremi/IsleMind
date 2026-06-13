import type { ProcessTrace } from '@/types'
import type {
  AgentFailureCode,
  AgentRagRuntime,
  AgentRequestedOutput,
  AgentRunLimits,
  AgentRuntimeLogOptions,
  AgentToolManifest,
  AgentToolRequest,
  AgentWorkflowDefinition,
  AgentWorkflowRun,
} from '@/services/agent/agentToolTypes'
import { classifyAgentIntent, type AgentIntentClassification } from '@/services/agent/agentIntentClassifier'
import { runAgenticWorkflow } from '@/services/agent/agentOrchestrator'
import { createAgentWorkflowSkillSuggestionFromRun } from '@/services/agent/agentWorkflowSkills'

export interface AgenticChatEntryInput {
  content: string
  conversationTitle?: string
  explicitToolRequest?: AgentToolRequest
  requestedOutput?: AgentRequestedOutput
  workflowDefinition?: AgentWorkflowDefinition
  manifests?: AgentToolManifest[]
  ragRuntime?: AgentRagRuntime
  runtimeLog?: AgentRuntimeLogOptions
  limits?: Partial<AgentRunLimits>
  intentVisible?: boolean
  userConfirmed?: boolean
  signal?: AbortSignal
  forceAgenticCancellation?: boolean
  now?: number
}

export interface AgenticChatEntryDecision {
  shouldHandle: boolean
  reason: AgenticChatEntryReason
  classification: AgentIntentClassification
  traces: ProcessTrace[]
}

export type AgenticChatEntryReason =
  | 'direct-chat'
  | 'explicit-tool-request'
  | 'work-artifact'
  | 'selected-workflow-skill'
  | 'rag-runtime-ready'
  | 'rag-runtime-missing'
  | 'settings-local-command-router'
  | 'planner-tool-missing'
  | 'cancelled'

export interface AgenticChatWorkflowReply {
  handled: boolean
  content: string
  status: 'done' | 'waiting' | 'error' | 'skipped' | 'cancelled'
  traces: ProcessTrace[]
  run?: AgentWorkflowRun
  failureCode?: AgentFailureCode
}

export function decideAgenticChatEntry(input: AgenticChatEntryInput): AgenticChatEntryDecision {
  const classification = classifyAgentIntent({
    goal: input.content,
    content: input.content,
    explicitToolRequest: input.explicitToolRequest,
    requestedOutput: input.requestedOutput,
    now: input.now,
  })

  if (input.forceAgenticCancellation && input.signal?.aborted) {
    return decision(true, 'cancelled', classification)
  }

  if (input.explicitToolRequest) {
    return cancellableDecision(input, 'explicit-tool-request', classification)
  }
  if (input.workflowDefinition) {
    return cancellableDecision(input, 'selected-workflow-skill', classification)
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

export async function runAgenticChatWorkflow(input: AgenticChatEntryInput): Promise<AgenticChatWorkflowReply> {
  const entry = decideAgenticChatEntry(input)
  if (!entry.shouldHandle) {
    return {
      handled: false,
      status: 'skipped',
      content: formatSkippedChatEntry(entry),
      traces: entry.traces,
    }
  }

  const run = await runAgenticWorkflow({
    goal: input.content,
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

  const traces = attachWorkflowSkillSuggestion(run.traces, run, input.manifests ?? [], input.now)
  return {
    handled: true,
    status: run.status === 'done' ? 'done' : run.status === 'waiting' ? 'waiting' : run.status === 'cancelled' ? 'cancelled' : run.status === 'error' ? 'error' : 'skipped',
    content: formatAgenticChatWorkflowReply(run),
    traces,
    run,
    failureCode: run.failureCode,
  }
}

export function formatAgenticChatWorkflowReply(run: AgentWorkflowRun): string {
  const output = run.finalOutput?.trim()
  if (run.status === 'done') return output || 'Agentic workflow completed.'
  if (run.status === 'waiting') return output || `Agentic workflow paused: ${run.failureCode ?? 'permission_required'}.`
  if (run.status === 'cancelled') return output || 'Agentic workflow was cancelled.'
  return output || `Agentic workflow failed: ${run.failureCode ?? 'execution_failed'}.`
}

function decision(
  shouldHandle: boolean,
  reason: AgenticChatEntryReason,
  classification: AgentIntentClassification
): AgenticChatEntryDecision {
  return {
    shouldHandle,
    reason,
    classification,
    traces: [classification.trace],
  }
}

function formatSkippedChatEntry(entry: AgenticChatEntryDecision): string {
  switch (entry.reason) {
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

function cancellableDecision(
  input: AgenticChatEntryInput,
  reason: AgenticChatEntryReason,
  classification: AgentIntentClassification
): AgenticChatEntryDecision {
  if (input.signal?.aborted) return decision(true, 'cancelled', classification)
  return decision(true, reason, classification)
}

function attachWorkflowSkillSuggestion(
  traces: ProcessTrace[],
  run: AgentWorkflowRun,
  manifests: AgentToolManifest[],
  now: number | undefined
): ProcessTrace[] {
  const suggestion = createAgentWorkflowSkillSuggestionFromRun({ run, manifests, now })
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

function findCompletionTraceIndex(traces: ProcessTrace[], status: AgentWorkflowRun['status']): number {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index]
    if (trace.title === 'Agent workflow' && trace.metadata?.status === status) return index
  }
  return -1
}
