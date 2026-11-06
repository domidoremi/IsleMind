import { applyConversationContextPolicy, createConversationContextPolicyCommand } from '@/modules/conversations'
import type { Conversation } from '@/types/chatContracts'
import { isConversationLocked, lockConversation } from '@/services/conversationLock'
import { hasActiveStream } from '@/services/chatStreamLifecycle'
import { useChatStore } from '@/store/chatStore'
import { saveConversationRecord } from '@/presentation/features/conversations/conversationStorePersistenceCommand'
import { conversationPersistence } from './conversationPersistence'

export async function loadConversationContextTarget(id: string): Promise<Conversation | undefined> {
  return useChatStore.getState().conversations.find(conversation => conversation.id === id)
    ?? await conversationPersistence.loadRecord(id)
}

export const saveConversationContextPolicy = createConversationContextPolicyCommand({
  readConversation: loadConversationContextTarget,
  isBusy: id => isConversationLocked(id) || hasActiveStream(id),
  isDraft: id => useChatStore.getState().draftConversationIds.has(id),
  acquireLock: lockConversation,
  persist: saveConversationRecord,
  publish(conversation) {
    useChatStore.setState(state => ({
      conversations: state.conversations.map(current => current.id === conversation.id
        ? applyConversationContextPolicy(current, conversation.contextPolicyOverride, conversation.updatedAt) : current),
    }))
  },
  now: Date.now,
})
