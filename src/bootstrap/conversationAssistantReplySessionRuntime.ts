import { createAssistantConversationReplySessionRuntime } from '@/modules/assistant-runtime'
import { startConversationTaskActivity } from '@/modules/tasks'
import { stopConversationMessage } from '@/presentation/features/conversations/conversationControlCommand'
import { setActiveStream } from '@/services/chatStreamLifecycle'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { Conversation } from '@/types/chatContracts'

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const conversationAssistantReplySessionRuntime =
  createAssistantConversationReplySessionRuntime<Conversation>({
    stopConversationMessage,
    getConversation(conversationId) {
      return useChatStore.getState().conversations.find(
        (conversation) => conversation.id === conversationId,
      )
    },
    now: Date.now,
    generateId: createMessageId,
    appendMessage(conversationId, message) {
      useChatStore.getState().addMessage(conversationId, message)
    },
    startConversationTaskActivity,
    setStreaming(conversationId, assistantMessageId) {
      useChatStreamingStore
        .getState()
        .setStreaming(conversationId, assistantMessageId)
    },
    createRequestController: () => new AbortController(),
    setActiveStream,
  })
