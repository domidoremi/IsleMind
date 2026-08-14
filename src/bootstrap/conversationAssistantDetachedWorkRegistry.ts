import { createAssistantConversationDetachedWorkRegistry } from '@/modules/assistant-runtime'

export const conversationAssistantDetachedWorkRegistry =
  createAssistantConversationDetachedWorkRegistry()

export function cancelConversationAssistantDetachedWork(conversationId: string): void {
  conversationAssistantDetachedWorkRegistry.cancelConversation(conversationId)
}

export function cancelAllConversationAssistantDetachedWork(): void {
  conversationAssistantDetachedWorkRegistry.cancelAll()
}
