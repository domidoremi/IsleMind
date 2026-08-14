import {
  createConversationAssistantMessageProjectionPolicy,
  createConversationAssistantProjectionExecutor,
  type ConversationAssistantSuccessPlan,
} from '@/modules/conversations'
import { finishConversationTaskActivityForMessage } from '@/modules/tasks'
import { getActiveStream, clearActiveStream } from '@/services/chatStreamLifecycle'
import { buildEstimatedUsage, estimateTextTokens } from '@/services/tokenUsage'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { ChatErrorCode } from '@/types/providerContracts'

export const conversationAssistantMessageProjection = createConversationAssistantMessageProjectionPolicy({
  buildEstimatedUsage,
  estimateTextTokens,
})

export function commitConversationAssistantSuccessProjection(input: {
  conversationId: string
  assistantMessageId: string
  projection: ConversationAssistantSuccessPlan
}): void {
  createProjectionExecutor(input).commitSuccess(input.projection)
}

export function projectConversationAssistantFailure(input: {
  conversationId: string
  assistantMessageId: string
  content: string
  errorCode?: ChatErrorCode
  providerId?: string
}): void {
  createProjectionExecutor(input).projectFailure(() => {
    const conversation = useChatStore.getState().conversations.find(
      (item) => item.id === input.conversationId,
    )
    return conversationAssistantMessageProjection.buildFailurePlan({
      conversation,
      message: conversation?.messages.find((item) => item.id === input.assistantMessageId),
      content: input.content,
      errorCode: input.errorCode ?? 'unknown',
      providerId: input.providerId,
      completedAt: Date.now(),
    })
  })
}

function createProjectionExecutor(input: { conversationId: string; assistantMessageId: string }) {
  return createConversationAssistantProjectionExecutor({
    flushActiveStream() {
      const active = getActiveStream(input.conversationId)
      if (active?.messageId !== input.assistantMessageId) return
      active.flush?.()
      clearActiveStream(input.conversationId)
    },
    commitStreamingText() {
      useChatStreamingStore.getState().commitStreamingText(input.conversationId, input.assistantMessageId)
    },
    commitStreamingTraces() {
      useChatStreamingStore.getState().commitStreamingTraces(input.conversationId, input.assistantMessageId)
    },
    updateMessage(patch) {
      useChatStore.getState().updateMessage(input.conversationId, input.assistantMessageId, patch)
    },
    clearStreaming() {
      useChatStreamingStore.getState().clearStreaming(input.conversationId, input.assistantMessageId)
    },
    finishTask(completion) {
      finishConversationTaskActivityForMessage(
        input.conversationId,
        input.assistantMessageId,
        completion.status,
        { error: completion.error, metadata: completion.metadata },
      )
    },
    reportError(error) {
      useChatStore.getState().setError(error)
    },
  })
}
