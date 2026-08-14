import type { Conversation, Message, MessageUsage } from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'

export interface ConversationControlActiveStream {
  controller: AbortController
  messageId: string
  flush?: () => void
}

export interface ConversationControlDependencies {
  buildEstimatedUsage(inputMessages: Message[], outputText: string): MessageUsage
  clearActiveStream(conversationId: string): void
  clearStreaming(conversationId: string, messageId: string): void
  commitStreamingBuffers(conversationId: string, messageId: string): void
  createRecoveredTrace(completedAt: number): ProcessTrace
  createStoppedTrace(completedAt: number): ProcessTrace
  estimateTextTokens(text: string): number
  finishCancelledTask(conversationId: string, messageId: string, reason: 'stale_stream_recovered' | 'user_stopped'): void
  flushStreamingMessage(conversationId: string, messageId: string): Promise<void>
  getActiveStream(conversationId: string): ConversationControlActiveStream | undefined
  getConversation(conversationId: string): Conversation | undefined
  getMessage(conversationId: string, messageId: string): Message | undefined
  hasActiveStream(conversationId: string): boolean
  removeMessage(conversationId: string, messageId: string): void
  reportReplyStartFailure(kind: 'regenerate' | 'retry', error: unknown): void
  settleRunningTraces(
    conversationId: string,
    messageId: string,
    options: { fallbackStatus: ProcessTrace['status']; fallbackContent: string },
  ): void
  startAssistantReplyAfterHistoryProjection(conversationId: string): Promise<void>
  traceText(key: 'recoveredEmpty' | 'recoveredStopped'): string
  trimAfterMessage(conversationId: string, messageId: string): void
  updateMessage(conversationId: string, messageId: string, updates: Partial<Message>): void
  upsertTrace(conversationId: string, messageId: string, trace: ProcessTrace): void
  now(): number
}

export interface ConversationControlController {
  stop(conversationId: string): void
  recoverStale(conversationId: string): Promise<void>
  retry(conversationId: string, assistantMessageId: string): Promise<void>
  regenerateLastAssistant(conversationId: string): Promise<void>
}

export function createConversationControlController(
  dependencies: ConversationControlDependencies,
): ConversationControlController {
  function stop(conversationId: string): void {
    const active = dependencies.getActiveStream(conversationId)
    if (!active) return

    // Drain both runner-level batching and the streaming store before reading
    // partial output for terminal usage accounting.
    active.flush?.()
    dependencies.commitStreamingBuffers(conversationId, active.messageId)
    active.controller.abort()
    dependencies.clearActiveStream(conversationId)

    const current = dependencies.getMessage(conversationId, active.messageId)
    const conversation = dependencies.getConversation(conversationId)
    const inputMessages = conversation?.messages.filter(
      (message) => message.id !== active.messageId && message.status !== 'error',
    ) ?? []
    const outputText = current?.responseText ?? current?.content ?? ''
    const completedAt = dependencies.now()

    dependencies.updateMessage(conversationId, active.messageId, {
      status: 'cancelled',
      completedAt,
      durationMs: current?.startedAt ? completedAt - current.startedAt : current?.durationMs,
      usage: dependencies.buildEstimatedUsage(inputMessages, outputText),
      estimatedTokens: true,
      tokenCount: dependencies.estimateTextTokens(outputText),
    })
    dependencies.clearStreaming(conversationId, active.messageId)
    dependencies.finishCancelledTask(conversationId, active.messageId, 'user_stopped')
    dependencies.upsertTrace(
      conversationId,
      active.messageId,
      dependencies.createStoppedTrace(completedAt),
    )
  }

  async function recoverStale(conversationId: string): Promise<void> {
    if (dependencies.hasActiveStream(conversationId)) return
    const conversation = dependencies.getConversation(conversationId)
    const staleMessageIds = conversation?.messages
      .filter((message) => message.role === 'assistant' && (message.status === 'streaming' || message.status === 'sending'))
      .map((message) => message.id) ?? []

    for (const messageId of staleMessageIds) {
      // A newly registered live stream always wins over restart recovery.
      if (dependencies.hasActiveStream(conversationId)) return

      // Commit buffered text and traces first, then re-read the message so the
      // cancelled projection and usage include every recovered partial chunk.
      dependencies.commitStreamingBuffers(conversationId, messageId)
      const currentConversation = dependencies.getConversation(conversationId)
      const current = dependencies.getMessage(conversationId, messageId)
      if (!current || (current.status !== 'streaming' && current.status !== 'sending')) continue

      const completedAt = dependencies.now()
      const outputText = current.responseText ?? current.content ?? ''
      const inputMessages = currentConversation?.messages.filter(
        (message) => message.id !== messageId && message.status !== 'error',
      ) ?? []
      dependencies.updateMessage(conversationId, messageId, {
        status: 'cancelled',
        responseText: outputText,
        content: outputText,
        completedAt,
        durationMs: current.startedAt ? completedAt - current.startedAt : current.durationMs,
        usage: dependencies.buildEstimatedUsage(inputMessages, outputText),
        estimatedTokens: true,
        tokenCount: dependencies.estimateTextTokens(outputText),
      })
      dependencies.upsertTrace(
        conversationId,
        messageId,
        dependencies.createRecoveredTrace(completedAt),
      )
      dependencies.settleRunningTraces(conversationId, messageId, {
        fallbackStatus: outputText.trim() ? 'done' : 'skipped',
        fallbackContent: outputText.trim()
          ? dependencies.traceText('recoveredStopped')
          : dependencies.traceText('recoveredEmpty'),
      })
      dependencies.finishCancelledTask(conversationId, messageId, 'stale_stream_recovered')
      await dependencies.flushStreamingMessage(conversationId, messageId)
    }
  }

  async function retry(conversationId: string, assistantMessageId: string): Promise<void> {
    const conversation = dependencies.getConversation(conversationId)
    if (!conversation) return
    const assistantIndex = conversation.messages.findIndex(
      (message) => message.id === assistantMessageId && message.role === 'assistant',
    )
    if (assistantIndex < 0) return
    const previousUser = [...conversation.messages.slice(0, assistantIndex)]
      .reverse()
      .find((message) => message.role === 'user')
    if (!previousUser) return

    // Stop first so trimming cannot discard uncommitted output or traces.
    stop(conversationId)
    dependencies.trimAfterMessage(conversationId, previousUser.id)
    try {
      await dependencies.startAssistantReplyAfterHistoryProjection(conversationId)
    } catch (error) {
      dependencies.reportReplyStartFailure('retry', error)
      throw error
    }
  }

  async function regenerateLastAssistant(conversationId: string): Promise<void> {
    const conversation = dependencies.getConversation(conversationId)
    if (!conversation) return
    const lastAssistant = conversation.messages.at(-1)
    if (!lastAssistant || lastAssistant.role !== 'assistant') return
    // Stop first so removing the final assistant cannot discard its buffers.
    stop(conversationId)
    dependencies.removeMessage(conversationId, lastAssistant.id)
    try {
      await dependencies.startAssistantReplyAfterHistoryProjection(conversationId)
    } catch (error) {
      dependencies.reportReplyStartFailure('regenerate', error)
      throw error
    }
  }

  return {
    stop,
    recoverStale,
    retry,
    regenerateLastAssistant,
  }
}
