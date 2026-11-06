import { projectSettingsProviderReferences } from '@/modules/settings'
import { projectConversationProviderReference } from '@/modules/conversations'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { conversationPersistence } from './conversationPersistence'
import { createProviderConnectionReferenceRuntime } from './providerConnectionReferenceRuntime'

export const providerConnectionReferenceRuntime = createProviderConnectionReferenceRuntime({
  capture(providerIds) {
    const state = useChatStore.getState()
    const local = [...new Map(state.conversations.map(conversation => [conversation.id, conversation])).values()]
    const projected = local.map(conversation => projectConversationProviderReference(
      conversation, providerIds, state.draftConversationIds.has(conversation.id),
    ))
    const localDrafts = local.filter(conversation => state.draftConversationIds.has(conversation.id)).length
    return {
      settingsReferences: projectSettingsProviderReferences(useSettingsStore.getState().settings, providerIds),
      localReferences: projected.flatMap(result => result.reference ? [result.reference] : []),
      localSaved: local.length - localDrafts, localDrafts,
      localUnreadable: projected.filter(result => result.unreadable).length,
      localIds: local.map(conversation => conversation.id),
    }
  },
  reader: conversationPersistence,
  now: Date.now,
})
