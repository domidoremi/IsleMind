import { buildEstimatedUsage, estimateTextTokens } from '@/services/tokenUsage'
import { normalizeUserContent } from '@/services/chatMessageUtils'
import { useChatStore } from '@/store/chatStore'

import {
  createConversationMessageController,
  type ConversationMessageInput,
} from './conversationMessageController'
import { dispatchConversationMessageRuntime } from './conversationMessageRuntimeBinding'

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const controller = createConversationMessageController({
  buildEstimatedUsage,
  createMessageId,
  dispatchLegacyMessage: dispatchConversationMessageRuntime,
  estimateTextTokens,
  normalizeContent: normalizeUserContent,
  now: () => Date.now(),
  store: {
    setError(error) {
      useChatStore.getState().setError(error)
    },
    addMessage(conversationId, message) {
      useChatStore.getState().addMessage(conversationId, message)
    },
    getConversation(conversationId) {
      return useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)
    },
  },
})

export type { ConversationMessageInput }

export const sendConversationMessage = controller.send
