import type { TFunction } from 'i18next'
import { LayoutAnimation, Platform } from 'react-native'

import type { Attachment, Conversation, Message } from '@/types/chatContracts'

import {
  buildQuotedMessageDraft,
  isMessageSelectable,
  toggleSelectedMessageIds,
} from './messageSelectionFormatting'
import { buildChatMessageEditPlan } from './chatMessageEditState'

type ChatMessageDraftDialog = {
  toast: (options: { title: string; tone: 'mint' }) => void
}

type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void
type SetActiveActionMessageId = (value: string | null) => void
type SetMultiSelectActive = (value: boolean) => void
type SetSelectedMessageIds = (value: Set<string> | ((current: Set<string>) => Set<string>)) => void

interface MessageSelectionDraft {
  content: string
  attachments?: Attachment[]
  toastKey: string
}

interface MessageDraftActionState {
  dialog: ChatMessageDraftDialog
  onApplyStarter: ApplyStarterDraft
  setActiveActionMessageId: SetActiveActionMessageId
  setMultiSelectActive: SetMultiSelectActive
  setSelectedMessageIds: SetSelectedMessageIds
  t: TFunction
}

export function applyChatMessageDraft({
  dialog,
  draft,
  onApplyStarter,
  setActiveActionMessageId,
  setMultiSelectActive,
  setSelectedMessageIds,
  t,
}: MessageDraftActionState & {
  draft: MessageSelectionDraft
}) {
  onApplyStarter(draft.content, draft.attachments, false)
  setActiveActionMessageId(null)
  setMultiSelectActive(false)
  setSelectedMessageIds(new Set())
  dialog.toast({ title: t(draft.toastKey), tone: 'mint' })
}

export function quoteChatMessageDraft({
  message,
  ...state
}: MessageDraftActionState & {
  message: Message
}) {
  applyChatMessageDraft({
    ...state,
    draft: {
      content: buildQuotedMessageDraft(message, state.t),
      toastKey: 'messageBubble.quoteInserted',
    },
  })
}

export function editUserChatMessageDraft({
  conversation,
  message,
  safeStopMessage,
  updateConversation,
  onBeforeTrim,
  onTrimComplete,
  trimDelayMs = 0,
  ...state
}: MessageDraftActionState & {
  conversation: Conversation
  message: Message
  safeStopMessage: (conversationId: string) => void
  updateConversation: (conversationId: string, updates: Partial<Conversation>) => void
  onBeforeTrim?: (messageId: string, removedMessageIds: string[]) => void
  onTrimComplete?: (messageId: string) => void
  trimDelayMs?: number
}): ReturnType<typeof setTimeout> | undefined {
  const plan = buildChatMessageEditPlan(conversation, message)
  if (!plan) return undefined
  safeStopMessage(conversation.id)
  onBeforeTrim?.(plan.messageId, plan.removedMessageIds)

  const commit = () => {
    if (Platform.OS === 'android') {
      LayoutAnimation.configureNext({
        duration: 180,
        create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
        update: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.scaleXY },
        delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      })
    } else if (Platform.OS !== 'web') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    }
    updateConversation(conversation.id, { messages: plan.retainedMessages })
    applyChatMessageDraft({
      ...state,
      draft: {
        ...plan.draft,
        toastKey: 'messageBubble.editInserted',
      },
    })
    onTrimComplete?.(plan.messageId)
  }

  if (trimDelayMs > 0) return setTimeout(commit, trimDelayMs)
  commit()
  return undefined
}

export function startChatMessageMultiSelect({
  message,
  setActiveActionMessageId,
  setMultiSelectActive,
  setSelectedMessageIds,
}: {
  message: Message
  setActiveActionMessageId: SetActiveActionMessageId
  setMultiSelectActive: SetMultiSelectActive
  setSelectedMessageIds: SetSelectedMessageIds
}) {
  if (!isMessageSelectable(message)) return
  setActiveActionMessageId(null)
  setMultiSelectActive(true)
  setSelectedMessageIds(new Set([message.id]))
}

export function toggleChatMessageSelection({
  message,
  setMultiSelectActive,
  setSelectedMessageIds,
}: {
  message: Message
  setMultiSelectActive: SetMultiSelectActive
  setSelectedMessageIds: SetSelectedMessageIds
}) {
  if (!isMessageSelectable(message)) return
  setMultiSelectActive(true)
  setSelectedMessageIds((current) => toggleSelectedMessageIds(current, message.id))
}

export function clearChatMessageSelection({
  setMultiSelectActive,
  setSelectedMessageIds,
}: {
  setMultiSelectActive: SetMultiSelectActive
  setSelectedMessageIds: SetSelectedMessageIds
}) {
  setMultiSelectActive(false)
  setSelectedMessageIds(new Set())
}
