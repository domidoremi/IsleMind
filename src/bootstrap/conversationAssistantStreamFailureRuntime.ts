import {
  createAssistantConversationStreamFailureRuntime,
} from '@/modules/assistant-runtime'
import { projectConversationAssistantFailure } from '@/bootstrap/conversationAssistantMessageProjection'
import { classifyChatError, toUserFacingError } from '@/services/chatErrorUtils'
import { sanitizeTrace } from '@/services/chatTraceUtils'
import { useChatStore } from '@/store/chatStore'
import { useChatStreamingStore } from '@/store/chatStreamingStore'
import type { Message } from '@/types/chatContracts'
import type { ChatErrorCode } from '@/types/providerContracts'
import { st } from '@/i18n/service'

export const conversationAssistantStreamFailureRuntime =
  createAssistantConversationStreamFailureRuntime<Message, ChatErrorCode>({
    getMessage(conversationId, assistantMessageId) {
      const conversation = useChatStore
        .getState()
        .conversations.find((item) => item.id === conversationId)
      return conversation?.messages.find(
        (message) => message.id === assistantMessageId,
      )
    },
    now: Date.now,
    generateTraceId(prefix) {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    },
    modelRequestTitle() {
      return st('chatRunner.trace.modelRequestTitle')
    },
    fallbackFailureMessage() {
      return st('chatRunner.error.sendFailed')
    },
    classifyError: classifyChatError,
    toUserFacingError,
    recordTrace({ conversationId, assistantMessageId, trace }) {
      const safeTrace = sanitizeTrace(trace)
      const streamingStore = useChatStreamingStore.getState()
      if (streamingStore.activeStreams.get(
        `${conversationId}:${assistantMessageId}`,
      ) === true) {
        streamingStore.upsertTrace(conversationId, assistantMessageId, safeTrace)
        return
      }
      useChatStore
        .getState()
        .upsertMessageTrace(conversationId, assistantMessageId, safeTrace)
    },
    projectTerminalFailure: projectConversationAssistantFailure,
  })
