import type { Message, MessageUsage } from '@/types/chatContracts'
import type { ChatErrorCode } from '@/types/providerContracts'
import type { ProcessTrace } from '@/core'

export type ConversationChatWorkflowMessageFailureCode =
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

export interface ConversationChatWorkflowMessageProjectionInput {
  handled: boolean
  content: string
  status: 'done' | 'waiting' | 'error' | 'skipped' | 'cancelled'
  traces: ProcessTrace[]
  failureCode?: ConversationChatWorkflowMessageFailureCode
}

export interface ConversationChatWorkflowAssistantMessagePatch {
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

export function buildConversationChatWorkflowAssistantMessagePatch(
  reply: ConversationChatWorkflowMessageProjectionInput,
  startedAt = Date.now(),
): ConversationChatWorkflowAssistantMessagePatch {
  const traces = splitConversationChatWorkflowTracesForMessage(reply.traces)
  const completedAt = Date.now()
  const content = reply.content.trim()
  const status = resolveConversationChatWorkflowMessageStatus(reply)
  return {
    content,
    responseText: content,
    status,
    reasoning: traces.reasoning,
    retrievalTrace: traces.retrievalTrace,
    toolCalls: traces.toolCalls,
    usage: buildConversationChatWorkflowEstimatedUsage(content),
    tokenCount: estimateConversationChatWorkflowTokens(content),
    errorCode: status === 'error' ? conversationChatWorkflowFailureToChatError(reply.failureCode) : undefined,
    durationMs: Math.max(0, completedAt - startedAt),
    completedAt,
  }
}

export function splitConversationChatWorkflowTracesForMessage(
  traces: ProcessTrace[],
): Pick<ConversationChatWorkflowAssistantMessagePatch, 'reasoning' | 'retrievalTrace' | 'toolCalls'> {
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

export function conversationChatWorkflowFailureToChatError(
  code: ConversationChatWorkflowMessageFailureCode | undefined,
): ChatErrorCode {
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

function resolveConversationChatWorkflowMessageStatus(
  reply: ConversationChatWorkflowMessageProjectionInput,
): Message['status'] {
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

function buildConversationChatWorkflowEstimatedUsage(content: string): MessageUsage {
  const outputTokens = estimateConversationChatWorkflowTokens(content)
  return {
    inputTokens: 0,
    outputTokens,
    totalTokens: outputTokens,
    source: 'estimated',
  }
}

function estimateConversationChatWorkflowTokens(content: string): number {
  const trimmed = content.trim()
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0
}
