import type { AssistantRun, PendingModelOperation } from '@/modules/assistant-runtime'
import { getAssistantRunMessageAttribution, HARNESS_ENGINE_VERSION } from '@/modules/assistant-runtime'
import type { ConversationRunProjection, ConversationRunProjectionEvent } from '@/modules/conversations'
import type { ContextCitation } from '@/modules/knowledge'
import { finishConversationTaskActivityForMessage } from '@/modules/tasks'
import { buildEstimatedUsage, estimateTextTokens } from '@/services/tokenUsage'
import { hasActiveStream } from '@/services/chatStreamLifecycle'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { MessageUsage } from '@/types/chatContracts'
import type { MessageCitation } from '@/types/contextContracts'
import type { ChatErrorCode } from '@/types/providerContracts'
import { st } from '@/i18n/service'
import { modelOperationActivity } from './modelOperationActivity'
import {
  resolveChatRecoveryMessageId,
  type PlainChatProjectionInput,
} from './plainChatController'

export function createPlainChatProjection(
  input: PlainChatProjectionInput,
  onTerminalPersisted: () => void,
  isCurrent?: () => boolean,
): ConversationRunProjection {
  const paused = getMessage(input.conversation.id, input.assistantMessageId)?.responseLifecycle?.stage === 'paused'
  if (!paused && (!isCurrent || isCurrent())) useChatStore.getState().transitionMessageLifecycle(
      input.conversation.id,
      input.assistantMessageId,
      'waiting',
    )
  const state: ProjectionState = {
    conversationId: input.conversation.id,
    messageId: input.assistantMessageId,
    citations: [...(getMessage(input.conversation.id, input.assistantMessageId)?.citations ?? [])],
    suppressTextUntilContinuation: false,
    paused,
    ...(isCurrent ? { isCurrent } : {}),
  }
  return async (event) => {
    if (state.isCurrent && !state.isCurrent()) return
    const sequence = event.journalEntry?.sequence ?? event.run.journalSequence
    if (state.harnessLifecycleSequence !== undefined && sequence < state.harnessLifecycleSequence) return
    const attribution = getAssistantRunMessageAttribution(event.run)
    if (attribution) {
      const message = getMessage(state.conversationId, state.messageId)
      if (message && (message.providerId !== attribution.providerId || message.model !== attribution.model || message.generationProtocol?.adapterId !== attribution.generationProtocol?.adapterId)) {
        useChatStore.getState().updateMessage(state.conversationId, state.messageId, attribution)
      }
    }
    projectContextCitations(state, event.contextCitations)
    if (event.run.status === 'paused') {
      state.paused = true
      state.harnessLifecycleSequence = sequence
      await projectPausedProjection(state, event.run, false, event.journalEntry?.occurredAt)
      return
    }
    if (event.journalEntry?.type === 'run.resumed') {
      state.paused = false
      state.harnessLifecycleSequence = sequence
      // Match the exact durable pre-request baseline, not the partial text from
      // the interrupted attempt. Completed tool receipts remain in the request.
      useChatStreamingStore.getState().resetContent(state.conversationId, state.messageId,
        event.run.checkpoint?.outputText ?? event.run.lifecycleCheckpoint?.outputText ?? '')
      useChatStreamingStore.getState().setStreaming(state.conversationId, state.messageId)
      useChatStore.getState().transitionMessageLifecycle(state.conversationId, state.messageId, 'working', {
        at: event.journalEntry.occurredAt,
      })
      return
    }
    if (state.paused && !isTerminalStatus(event.run.status)) return
    const activity = modelOperationActivity(event)
    if (activity) {
      useChatStreamingStore.getState().upsertTrace(state.conversationId, state.messageId, activity)
      useChatStore.getState().transitionMessageLifecycle(state.conversationId, state.messageId,
        activity.status === 'running' || activity.status === 'pending' ? 'tool_calling' : 'tool_result',
        { at: event.journalEntry!.occurredAt, traceId: activity.id })
    }
    if (event.journalEntry?.type === 'stream.event') projectStreamEvent(state, event)
    if (event.journalEntry?.type === 'model-operation.selected') {
      state.suppressTextUntilContinuation = true
      useChatStreamingStore.getState().resetContent(
        state.conversationId,
        state.messageId,
        '',
      )
      if (!isTerminalStatus(event.run.status) && event.run.status !== 'awaiting-confirmation') {
        useChatStore.getState().transitionMessageLifecycle(
          state.conversationId,
          state.messageId,
          'tool_result',
          { at: event.journalEntry.occurredAt, ...(activity ? { traceId: activity.id } : {}) },
        )
      }
    }
    if (event.journalEntry?.type === 'provider-continuation.started') {
      state.suppressTextUntilContinuation = false
      useChatStore.getState().transitionMessageLifecycle(
        state.conversationId,
        state.messageId,
        'working',
        { at: event.journalEntry.occurredAt },
      )
    }
    if (event.journalEntry?.type === 'run.confirmation-resolved') {
      removePendingModelOperationTrace(state)
      useChatStreamingStore.getState().setStreaming(state.conversationId, state.messageId)
    }
    if (event.journalEntry?.type === 'run.awaiting-confirmation' && event.run.pendingModelOperation) {
      await projectPendingModelOperation(state, event.run.pendingModelOperation)
    }
    if (isTerminalStatus(event.run.status)) {
      removePendingModelOperationTrace(state)
      onTerminalPersisted()
      await finalizeProjection(state, event.run)
    }
  }
}

export async function projectPendingModelOperation(
  state: Pick<ProjectionState, 'conversationId' | 'messageId' | 'isCurrent'>,
  pending: PendingModelOperation,
): Promise<void> {
  if (state.isCurrent && !state.isCurrent()) return
  const source = pending.operationId.startsWith('mcp:')
    ? 'mcp'
    : pending.operationId.startsWith('android:')
      ? 'android'
      : 'builtin'
  const summary = st('messageBubble.agentPermissionRequired', undefined, '需要确认后继续')
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
  if (state.isCurrent) await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId, state.isCurrent)
  else await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId)
}

function removePendingModelOperationTrace(state: ProjectionState): void {
  const message = getMessage(state.conversationId, state.messageId)
  if (!message) return
  const patch: Partial<Pick<typeof message, 'reasoning' | 'toolCalls' | 'retrievalTrace'>> = {}
  // System traces are stored in retrievalTrace, not reasoning. Remove the
  // resolved review marker wherever historical/current projections placed it.
  for (const key of ['reasoning', 'toolCalls', 'retrievalTrace'] as const) {
    const traces = message[key]
    if (!traces?.some(trace => typeof trace.metadata?.pendingModelOperationRunId === 'string')) continue
    patch[key] = traces.filter(trace => typeof trace.metadata?.pendingModelOperationRunId !== 'string')
  }
  if (Object.keys(patch).length) useChatStore.getState().updateMessage(state.conversationId, state.messageId, patch)
}

export async function finishPlainChatProjectionFailure(
  input: PlainChatProjectionInput,
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

export async function recoverChatProjection(run: AssistantRun, isCurrent?: () => boolean): Promise<void> {
  // Historical Agent records are reconciled through the same Chat
  // projection; the persisted discriminator remains read compatibility only.
  const messageId = resolveChatRecoveryMessageId(run)
  if (!messageId || (!isTerminalStatus(run.status) && run.status !== 'paused')) return
  const state: ProjectionState = {
    conversationId: run.conversationId,
    messageId,
    citations: [],
    suppressTextUntilContinuation: false,
    usage: undefined,
    ...(isCurrent ? { isCurrent } : {}),
  }
  if (run.status === 'paused') await projectPausedProjection(state, run, true)
  else await finalizeProjection(state, run, true)
}

export function isPlainChatMessageCancelled(conversationId: string, messageId: string): boolean {
  return currentMessageStatus(conversationId, messageId) === 'cancelled'
}

interface ProjectionState {
  conversationId: string
  messageId: string
  citations: MessageCitation[]
  suppressTextUntilContinuation: boolean
  paused?: boolean
  harnessLifecycleSequence?: number
  usage?: MessageUsage
  isCurrent?: () => boolean
}

async function projectPausedProjection(state: ProjectionState, run: AssistantRun, recovering: boolean, at = Date.now()): Promise<void> {
  const current = () => {
    if ((state.isCurrent && !state.isCurrent()) || (recovering && hasActiveStream(state.conversationId))) return undefined
    const message = getMessage(state.conversationId, state.messageId)
    return message?.status === 'streaming' || message?.status === 'sending' ? message : undefined
  }
  if (!current()) return
  if (state.isCurrent) await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId, state.isCurrent)
  else await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId)
  if (!current()) return
  const reason = run.lifecycleCheckpoint?.waitingReason
  const checkpoint = run.lifecycleCheckpoint
  const resumable = !run.parentRunId && !run.pendingModelOperation && run.engineVersion === HARNESS_ENGINE_VERSION
    && checkpoint?.recovery === 'resumable' && checkpoint.phase !== 'operation'
    && checkpoint.phase !== 'confirmation' && checkpoint.phase !== 'complete'
    && Number.isSafeInteger(run.journalSequence) && run.journalSequence > 0
  // The compact message remains unfinished; pause is not success, failure, or
  // cancellation and must never admit a destructive action or an implicit retry.
  useChatStore.getState().transitionMessageLifecycle(state.conversationId, state.messageId, 'paused', {
    at,
    summary: reason ? st(`agentTasks.reason.${reason}`) : st('agentTasks.status.paused'),
    traceId: resumable ? `harness-pause-v1:${run.id}:${run.journalSequence}` : `harness-pause:${run.id}`,
  })
  await useChatStore.getState().flushStreamingMessage(state.conversationId, state.messageId)
}

function projectStreamEvent(state: ProjectionState, event: ConversationRunProjectionEvent): void {
  if (currentMessageStatus(state.conversationId, state.messageId) !== 'streaming') return
  const data = event.journalEntry?.data
  const eventType = typeof data?.eventType === 'string' ? data.eventType : undefined
  if (eventType === 'tool-call') {
    // Any provider tool call means the preceding assistant text is narration,
    // not the final answer. Clear it before the tool phase becomes visible.
    state.suppressTextUntilContinuation = true
    useChatStreamingStore.getState().resetContent(
      state.conversationId,
      state.messageId,
      '',
    )
    useChatStore.getState().transitionMessageLifecycle(
      state.conversationId,
      state.messageId,
      'tool_calling',
      { at: event.journalEntry?.occurredAt },
    )
    return
  }
  if (eventType === 'text-delta' && typeof data?.text === 'string' && data.text) {
    if (state.suppressTextUntilContinuation) return
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

async function finalizeProjection(state: ProjectionState, run: AssistantRun, recovering = false): Promise<void> {
  if (state.isCurrent && !state.isCurrent()) return
  const status = currentMessageStatus(state.conversationId, state.messageId)
  if (!status || status === 'cancelled') return
  if (recovering && (hasActiveStream(state.conversationId) || (status !== 'streaming' && status !== 'sending'))) return

  // Flush the out-of-band streaming buffer before reading terminal content.
  // The provider runtime can deliver its terminal event while the last text
  // delta is still queued in the presentation store; reading first would
  // finalize a stale response and drop that buffered suffix.
  if (state.isCurrent) await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId, state.isCurrent)
  else await useChatStreamingStore.getState().flushStreamingMessage(state.conversationId, state.messageId)

  const current = getMessage(state.conversationId, state.messageId)
  // Cancellation or a newer live/terminal projection may win during the flush.
  // Duplicate recovery must not project or finish the same task a second time.
  if (!current || current.status === 'cancelled' || (state.isCurrent && !state.isCurrent())) return
  if (recovering && (hasActiveStream(state.conversationId) || (current.status !== 'streaming' && current.status !== 'sending'))) return
  removePendingModelOperationTrace(state)
  const conversation = useChatStore.getState().conversations.find((item) => item.id === state.conversationId)
  const completedAt = run.completedAt ?? Date.now()
  const outputText = run.result?.outputText ?? run.checkpoint?.outputText ?? current?.responseText ?? current?.content ?? ''
  const attribution = getAssistantRunMessageAttribution(run)
  const inputMessages = conversation?.messages.filter((message) => message.id !== state.messageId && message.status !== 'error') ?? []
  const estimatedUsage = buildEstimatedUsage(inputMessages, outputText)

  if (run.status === 'succeeded') {
    const usage = state.usage ?? estimatedUsage
    useChatStore.getState().updateMessage(state.conversationId, state.messageId, {
      status: 'done',
      ...attribution,
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
    if (recovering) await useChatStore.getState().flushStreamingMessage(state.conversationId, state.messageId)
    return
  }

  if (run.status === 'cancelled') {
    useChatStore.getState().updateMessage(state.conversationId, state.messageId, {
      status: 'cancelled',
      ...attribution,
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
    if (recovering) await useChatStore.getState().flushStreamingMessage(state.conversationId, state.messageId)
    return
  }

  const errorCode: ChatErrorCode = run.failure?.code === 'output_limit_exceeded' ? 'max_tokens_exceeded' : 'unknown'
  const failureText = outputText || st('chatRunner.error.sendFailed')
  useChatStore.getState().updateMessage(state.conversationId, state.messageId, {
    status: 'error',
    content: failureText,
    ...attribution,
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
  if (recovering) await useChatStore.getState().flushStreamingMessage(state.conversationId, state.messageId)
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
