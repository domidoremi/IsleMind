import { useState } from 'react'
import { CHAT_PRESENTATION_CATALOG, type ChatStarterDefinition } from '@/presentation/features/chat/chatPresentationCatalog'
import type { ComposerDraftPresence } from './composerDraftState'

export function resolveChatEntryDraftAction(presence: ComposerDraftPresence) {
  return presence === 'empty' ? 'prepare' : presence === 'draft' ? 'preserve' : 'wait'
}

export function useChatEntryTasks(presence: ComposerDraftPresence, onStarter: (starter: ChatStarterDefinition) => void) {
  const [selectedId, select] = useState<string>(CHAT_PRESENTATION_CATALOG.starters[0].id)
  const selected = CHAT_PRESENTATION_CATALOG.starters.find(starter => starter.id === selectedId)
    ?? CHAT_PRESENTATION_CATALOG.starters[0]
  const action = resolveChatEntryDraftAction(presence)
  return {
    selected, select, action,
    prepare: () => { if (action === 'prepare') onStarter(selected) },
  }
}
