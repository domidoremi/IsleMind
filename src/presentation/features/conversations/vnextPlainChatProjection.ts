import type { AssistantRun } from '@/modules/assistant-runtime'
import type { ConversationRunProjection, ConversationRunProjectionEvent } from '@/modules/conversations'
import type { ContextCitation } from '@/modules/knowledge'
import { finishConversationTaskActivityForMessage } from '@/modules/tasks'
import { buildEstimatedUsage, estimateTextTokens } from '@/services/tokenUsage'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { MessageUsage } from '@/types/chatContracts'
import type { MessageCitation } from '@/types/contextContracts'
import type { ChatErrorCode } from '@/types/providerContracts'
import { st } from '@/i18n/service'
import {
  resolveVNextChatRecoveryMessageId,
  type VNextPlainChatProjectionInput,
} from './vnextPlainChatController'

export function createVNextPlainChatProjection(
  input: VNextPlainChatProjectionInput,
  onTerminalPersisted: () => void,
): ConversationRunProjection {
  const state: ProjectionState = {
    conversationId: input.conversation.id,
    messageId: input.assistantMessageId,
    citations: [],
  }
  return async (event) => {
    projectContextCitations(state, event.contextCitations)
    if (event.journalEntry?.type === 'stream.event') projectStreamEvent(state, event)
    if (event.journalEntry?.type === 'model-operation.selected') {
      useChatStreamingStore.getState().resetContent(
        state.conversationId,
        state.messageId,
        event.run.checkpoint?.outputText ?? '',
      )
    }
    if (event.journalEntry?.type === 'run.confirmation-resolved') {
      removePendingModelOperationTrace(state)
      useChatStreamingStore.getState().setStreaming(state.conversationId, state.messageId)
    }
    if (event.journalEntry?.type === 'run.awaiting-confirmation') {
      await projectPendingModelOperation(state, event.run)
    }
    if (isTerminalStatus(event.run.status)) {
      removePendingModelOperationTrace(state)
      onTerminalPersisted()
      await finalizeProjection(state, event.run)
    }
  }
}

async function projectPendingModelOperation(
  state: ProjectionState,
  run: AssistantRun,
): Promise<void> {
  const pending = run.pendingModelOperation
  if (!pending) return
  const source = pending.operationId.startsWith('mcp:')
    ? 'mcp'
    : pending.operationId.startsWith('android:')
      ? 'android'
      : 'builtin'
  const summary = `The model selected ${pending.operationId}. Confirm this destructive operation to continue.`
  useChatStreamingStore.getState().resetContent(state.conversationId, state.messageId, '')
  useChatStreamingStore.getState().upsertTrace(state.conversationId, state.messageId, {
    id: `pending-model-operation:${pending.runId}:${pending.callId}`,
    type: 'system',
    title: 'Agent workflow',
    content: summary,
    status: 'running',
    startedAt: pending.requestedAt,
    metadata: {
      pendingModelOperationRunId: pending.runId,
      pendingAction: {
        id: pending.callId,
        reason: 'permission_required',
        title: 'Confirm operation',
        summary,
        toolName: pending.operationId,
        toolId: pending.operationId,
        source,
        permission: 'destructive',
        confirmable: true,
        resumeToolRequest: {
          toolId: pending.operationId,
          name: pending.operationId,
          source,
          arguments: {},
        },
        createdAt: pending.requestedAt,
      },
    },
  })
  await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId)
}

function removePendingModelOperationTrace(state: ProjectionState): void {
  const message = getMessage(state.conversationId, state.messageId)
  if (!message?.reasoning?.length) return
  useChatStore.getState().updateMessage(state.conversationId, state.messageId, {
    reasoning: message.reasoning.filter((trace) =>
      typeof trace.metadata?.pendingModelOperationRunId !== 'string'),
  })
}

export async function finishVNextPlainChatProjectionFailure(
  input: VNextPlainChatProjectionInput,
  message: string,
): Promise<void> {
  const current = getMessage(input.conversation.id, input.assistantMessageId)
  if (!current || current.status === 'cancelled') return
  const completedAt = Date.now()
  useChatStreamingStore.getState().clearStreaming(input.conversation.id, input.assistantMessageId)
  useChatStore.getState().updateMessage(input.conversation.id, input.assistantMessageId, {
    status: 'error',
    content: current.content || st('chatRunner.error.sendFailed'),
    responseText: current.responseText ?? (current.content || st('chatRunner.error.sendFailed')),
    errorCode: 'unknown',
    errorProviderId: input.provider.id,
    completedAt,
    durationMs: current.startedAt ? completedAt - current.startedAt : current.durationMs,
  })
  useChatStore.getState().setError(message)
}

export async function recoverVNextChatProjection(run: AssistantRun): Promise<void> {
  // Historical Agent records are terminally reconciled through the same Chat
  // projection; the persisted discriminator remains read compatibility only.
  const messageId = resolveVNextChatRecoveryMessageId(run)
  if (!messageId) return
  await finalizeProjection({
    conversationId: run.conversationId,
    messageId,
    citations: [],
    usage: undefined,
  }, run)
}

export function isVNextPlainChatMessageCancelled(conversationId: string, messageId: string): boolean {
  return currentMessageStatus(conversationId, messageId) === 'cancelled'
}

interface ProjectionState {
  conversationId: string
  messageId: string
  citations: MessageCitation[]
  usage?: MessageUsage
}

function projectStreamEvent(state: ProjectionState, event: ConversationRunProjectionEvent): void {
  if (currentMessageStatus(state.conversationId, state.messageId) !== 'streaming') return
  const data = event.journalEntry?.data
  const eventType = typeof data?.eventType === 'string' ? data.eventType : undefined
  if (eventType === 'text-delta' && typeof data?.text === 'string' && data.text) {
    useChatStreamingStore.getState().appendContent(state.conversationId, state.messageId, data.text)
    return
  }
  if (eventType === 'citation' && typeof data?.citationId === 'string') {
    const citation: MessageCitation = {
      id: data.citationId,
      type: 'web',
      title: typeof data.title === 'string' && data.title ? data.title : data.citationId,
      ...(typeof data.url === 'string' && data.url ? { url: data.url } : {}),
    }
    if (!state.citations.some((item) => item.id === citation.id)) state.citations.push(citation)
    useChatStore.getState().updateMessage(state.conversationId, state.messageId, { citations: state.citations })
    return
  }
  if (eventType === 'usage') {
    const inputTokens = typeof data?.inputTokens === 'number' ? data.inputTokens : undefined
    const outputTokens = typeof data?.outputTokens === 'number' ? data.outputTokens : undefined
    const totalTokens = typeof data?.totalTokens === 'number' ? data.totalTokens : undefined
    const cacheCreationInputTokens = typeof data?.cacheCreationInputTokens === 'number' ? data.cacheCreationInputTokens : undefined
    const cacheReadInputTokens = typeof data?.cacheReadInputTokens === 'number' ? data.cacheReadInputTokens : undefined
    const cachedInputTokens = typeof data?.cachedInputTokens === 'number' ? data.cachedInputTokens : cacheReadInputTokens
    const reasoningTokens = typeof data?.reasoningTokens === 'number' ? data.reasoningTokens : undefined
    if (inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined) {
      state.usage = {
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
        ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
        ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
        ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
        totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
        source: 'provider',
      }
    }
  }
}

function projectContextCitations(
  state: ProjectionState,
  citations: readonly ContextCitation[] | undefined,
): void {
  if (!citations?.length || currentMessageStatus(state.conversationId, state.messageId) !== 'streaming') return
  let changed = false
  for (const citation of citations) {
    if (state.citations.some((item) => item.id === citation.id)) continue
    state.citations.push({
      id: citation.id,
      type: citation.type,
      title: citation.title,
      ...(citation.excerpt ? { excerpt: citation.excerpt } : {}),
      ...(citation.url ? { url: citation.url } : {}),
      ...(citation.documentId ? { documentId: citation.documentId } : {}),
      ...(citation.chunkId ? { chunkId: citation.chunkId } : {}),
      ...(citation.score === undefined ? {} : { score: citation.score }),
    })
    changed = true
  }
  if (changed) useChatStore.getState().updateMessage(state.conversationId, state.messageId, { citations: state.citations })
}

async function finalizeProjection(state: ProjectionState, run: AssistantRun): Promise<void> {
  const status = currentMessageStatus(state.conversationId, state.messageId)
  if (!status || status === 'cancelled') return

  // Flush the out-of-band streaming buffer before reading terminal content.
  // The provider runtime can deliver its terminal event while the last text
  // delta is still queued in the presentation store; reading first would
  // finalize a stale response and drop that buffered suffix.
  await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId)

  const current = getMessage(state.conversationId, state.messageId)
  const conversation = useChatStore.getState().conversations.find((item) => item.id === state.conversationId)
  const completedAt = Date.now()
  const outputText = run.result?.outputText ?? run.checkpoint?.outputText ?? current?.responseText ?? current?.content ?? ''
  const inputMessages = conversation?.messages.filter((message) => message.id !== state.messageId && message.status !== 'error') ?? []
  const estimatedUsage = buildEstimatedUsage(inputMessages, outputText)

  if (run.status === 'succeeded') {
    const usage = state.usage ?? estimatedUsage
    useChatStore.getState().updateMessage(state.conversationId, state.messageId, {
      status: 'done',
      content: outputText,
      responseText: outputText,
      ...(state.citations.length ? { citations: state.citations } : {}),
      completedAt,
      durationMs: current?.startedAt ? completedAt - current.startedAt : current?.durationMs,
      usage,
      estimatedTokens: usage.source === 'estimated',
      tokenCount: usage.outputTokens ?? estimateTextTokens(outputText),
    })
    finishConversationTaskActivityForMessage(state.conversationId, state.messageId, 'done', {
      metadata: { providerId: run.providerId, model: run.model, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
    })
    return
  }

  if (run.status === 'cancelled') {
    useChatStore.getState().updateMessage(state.conversationId, state.messageId, {
      status: 'cancelled',
      content: outputText,
      responseText: outputText,
      completedAt,
      durationMs: current?.startedAt ? completedAt - current.startedAt : current?.durationMs,
      usage: estimatedUsage,
      estimatedTokens: true,
      tokenCount: estimatedUsage.outputTokens ?? estimateTextTokens(outputText),
    })
    finishConversationTaskActivityForMessage(state.conversationId, state.messageId, 'cancelled', {
      metadata: { reason: 'assistant_run_cancelled' },
    })
    return
  }

  const errorCode: ChatErrorCode = run.failure?.code === 'output_limit_exceeded' ? 'max_tokens_exceeded' : 'unknown'
  const failureText = outputText || st('chatRunner.error.sendFailed')
  useChatStore.getState().updateMessage(state.conversationId, state.messageId, {
    status: 'error',
    content: failureText,
    responseText: failureText,
    errorCode,
    errorProviderId: run.providerId,
    completedAt,
    durationMs: current?.startedAt ? completedAt - current.startedAt : current?.durationMs,
    usage: estimatedUsage,
    estimatedTokens: true,
    tokenCount: estimatedUsage.outputTokens ?? estimateTextTokens(failureText),
  })
  finishConversationTaskActivityForMessage(state.conversationId, state.messageId, 'failed', {
    error: st('chatRunner.error.sendFailed'),
    metadata: { errorCode, providerId: run.providerId, runFailure: run.failure?.code },
  })
}

function isTerminalStatus(status: AssistantRun['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function currentMessageStatus(conversationId: string, messageId: string): string | undefined {
  return getMessage(conversationId, messageId)?.status
}

function getMessage(conversationId: string, messageId: string) {
  const conversation = useChatStore.getState().conversations.find((item) => item.id === conversationId)
  return conversation?.messages.find((message) => message.id === messageId)
}
