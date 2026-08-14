import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'

import { stopConversationMessage } from '@/presentation/features/conversations/conversationControlCommand'
import type { Attachment, CommandReference, Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import type { useIsleDialog } from '@/components/ui/isle'
import type { ModelAccessSettings } from './chatModelSelection'
import { confirmConversationModelSwitch } from './chatModelActions'
import {
  confirmActionForMessage,
  repairAgentEvidenceDraft,
} from './chatMessageBubbleActions'

type ChatActionDialog = ReturnType<typeof useIsleDialog>
type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

interface ChatActiveWorkspaceActionOptions {
  activeConversation: Conversation
  dialog: ChatActionDialog
  modelAccessSettings: ModelAccessSettings
  onApplyStarter: ApplyStarterDraft
  setShowOptions: Dispatch<SetStateAction<boolean>>
  switchConversationModel: (id: string, providerId: string, model: string) => boolean
  t: TFunction
  updateConversation: (id: string, updates: Partial<Conversation>) => void
}

export interface ChatActiveWorkspaceActions {
  confirmActionFromMessage: (item: Message) => void
  confirmSwitchModel: (nextProvider: AIProvider, nextModel: string) => void
  rememberCommandReference: (reference: CommandReference) => void
  repairAgentEvidenceFromMessage: (item: Message) => void
  safeStopMessage: (conversationId: string) => void
}

export function useChatActiveWorkspaceActions({
  activeConversation,
  dialog,
  modelAccessSettings,
  onApplyStarter,
  setShowOptions,
  switchConversationModel,
  t,
  updateConversation,
}: ChatActiveWorkspaceActionOptions): ChatActiveWorkspaceActions {
  function safeStopMessage(conversationId: string) {
    try {
      stopConversationMessage(conversationId)
    } catch {
    }
  }

  function rememberCommandReference(reference: CommandReference) {
    const existing = activeConversation.commandRefs ?? []
    if (existing.some((item) => item.type === reference.type && item.id === reference.id)) return
    updateConversation(activeConversation.id, { commandRefs: [reference, ...existing].slice(0, 12) })
  }

  function confirmSwitchModel(nextProvider: AIProvider, nextModel: string) {
    confirmConversationModelSwitch({
      activeConversation,
      dialog,
      modelAccessSettings,
      nextModel,
      nextProvider,
      setShowOptions,
      stopStreaming: safeStopMessage,
      switchConversationModel,
      t,
    })
  }

  function repairAgentEvidenceFromMessage(item: Message) {
    repairAgentEvidenceDraft({ dialog, message: item, onApplyStarter, t })
  }

  function confirmActionFromMessage(item: Message) {
    confirmActionForMessage({ conversationId: activeConversation.id, dialog, message: item, t })
  }

  return {
    confirmActionFromMessage,
    confirmSwitchModel,
    rememberCommandReference,
    repairAgentEvidenceFromMessage,
    safeStopMessage,
  }
}
