import { st } from '@/i18n/service'
import { finishConversationTaskActivityForMessage } from '@/modules/tasks'
import {
  clearActiveStream,
  getActiveStream,
  hasActiveStream,
} from '@/services/chatStreamLifecycle'
import {
  completeTrace,
  sanitizeTrace,
  settleMessageTraces,
} from '@/services/chatTraceUtils'
import { buildEstimatedUsage, estimateTextTokens } from '@/services/tokenUsage'
import { useChatStore } from '@/store/chatStore'
import {
  mergeMessageWithStreamingTraceSnapshot,
  useChatStreamingStore,
} from '@/store/chatStreamingStore'
import type { Message } from '@/types/chatContracts'
import { describeUserFacingError, type ProcessTrace } from '@/core'

import {
  createConversationControlController,
} from './conversationControlController'
import { startConversationReplyAfterHistoryProjectionRuntime } from './conversationMessageRuntimeBinding'

function createControlTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getConversationMessage(conversationId: string, messageId: string): Message | undefined {
  return useChatStore.getState().conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === messageId)
}

function hasLiveStreamingState(conversationId: string, messageId: string): boolean {
  return useChatStreamingStore.getState().activeStreams.get(`${conversationId}:${messageId}`) === true
}

function upsertConversationTrace(conversationId: string, messageId: string, trace: ProcessTrace): void {
  const safeTrace = sanitizeTrace(trace)
  if (hasLiveStreamingState(conversationId, messageId)) {
    useChatStreamingStore.getState().upsertTrace(conversationId, messageId, safeTrace)
    return
  }
  useChatStore.getState().upsertMessageTrace(conversationId, messageId, safeTrace)
}

function settleConversationRunningTraces(
  conversationId: string,
  messageId: string,
  options: { fallbackStatus: ProcessTrace['status']; fallbackContent: string },
): void {
  const message = getConversationMessage(conversationId, messageId)
  const snapshot = useChatStreamingStore.getState().getStreamingTraceSnapshot(conversationId, messageId)
  const merged = message ? mergeMessageWithStreamingTraceSnapshot(message, snapshot) : undefined
  for (const trace of settleMessageTraces(merged, options)) {
    upsertConversationTrace(conversationId, messageId, trace)
  }
}

const controller = createConversationControlController({
  buildEstimatedUsage,
  clearActiveStream,
  clearStreaming(conversationId, messageId) {
    useChatStreamingStore.getState().clearStreaming(conversationId, messageId)
  },
  commitStreamingBuffers(conversationId, messageId) {
    const streamingStore = useChatStreamingStore.getState()
    streamingStore.commitStreamingText(conversationId, messageId)
    streamingStore.commitStreamingTraces(conversationId, messageId)
  },
  createRecoveredTrace(completedAt) {
    return completeTrace({
      id: createControlTraceId('recovered-stream'),
      type: 'system',
      title: st('chatRunner.trace.recoveredTitle'),
      content: st('chatRunner.trace.recoveredContent'),
      status: 'done',
      startedAt: completedAt,
    })
  },
  createStoppedTrace(completedAt) {
    return completeTrace({
      id: createControlTraceId('stop'),
      type: 'system',
      title: st('chatRunner.trace.stopTitle'),
      content: st('chatRunner.trace.stopContent'),
      status: 'done',
      startedAt: completedAt,
    })
  },
  estimateTextTokens,
  finishCancelledTask(conversationId, messageId, reason) {
    finishConversationTaskActivityForMessage(conversationId, messageId, 'cancelled', {
      metadata: { reason },
    })
  },
  flushStreamingMessage(conversationId, messageId) {
    return useChatStreamingStore.getState().flushStreamingMessage(conversationId, messageId)
  },
  getActiveStream,
  getConversation(conversationId) {
    return useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)
  },
  getMessage: getConversationMessage,
  hasActiveStream,
  now: Date.now,
  removeMessage(conversationId, messageId) {
    useChatStore.getState().removeMessage(conversationId, messageId)
  },
  reportReplyStartFailure(kind, error) {
    const fallbackKey = kind === 'retry' ? 'chatRunner.error.retryFailed' : 'chatRunner.error.regenerateFailed'
    useChatStore.getState().setError(describeUserFacingError(error, st, { headlineKey: fallbackKey }))
  },
  settleRunningTraces: settleConversationRunningTraces,
  startAssistantReplyAfterHistoryProjection: startConversationReplyAfterHistoryProjectionRuntime,
  traceText(key) {
    return st(key === 'recoveredStopped'
      ? 'chatRunner.trace.recoveredStopped'
      : 'chatRunner.trace.recoveredEmpty')
  },
  trimAfterMessage(conversationId, messageId) {
    useChatStore.getState().trimAfterMessage(conversationId, messageId)
  },
  updateMessage(conversationId, messageId, updates) {
    useChatStore.getState().updateMessage(conversationId, messageId, updates)
  },
  upsertTrace: upsertConversationTrace,
})

export const stopConversationMessage = controller.stop
export const recoverStaleConversationMessages = controller.recoverStale
export const retryConversationMessage = controller.retry
export const regenerateLastConversationAssistant = controller.regenerateLastAssistant
