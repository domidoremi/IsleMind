import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'

import type { Attachment, Conversation, Message } from '@/types/chatContracts'

import {
  clearChatMessageSelection,
  editUserChatMessageDraft,
  quoteChatMessageDraft,
  startChatMessageMultiSelect,
  toggleChatMessageSelection,
} from './chatMessageDraftActions'
import {
  copyConversationLinkToClipboard,
  copySelectedMessagesToClipboard,
  deleteSelectedMessagesWithConfirmation,
  exportSelectedMessagesMarkdown,
  type MessageActionDialog,
} from './chatMessageSelectionActions'
import { useMotionPreference } from '@/hooks/useMotionPreference'

export function useChatMessageSelectionController({
  conversation,
  dialog,
  onApplyStarter,
  safeStopMessage,
  setActiveActionMessageId,
  t,
  updateConversation,
}: {
  conversation: Conversation
  dialog: MessageActionDialog
  onApplyStarter: (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void
  safeStopMessage: (conversationId: string) => void
  setActiveActionMessageId: Dispatch<SetStateAction<string | null>>
  t: TFunction
  updateConversation: (id: string, updates: Partial<Conversation>) => void
}) {
  const motion = useMotionPreference()
  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [multiSelectActive, setMultiSelectActive] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set())
  const [rewindingMessageIds, setRewindingMessageIds] = useState<Set<string>>(() => new Set())

  const selectedMessageSignature = useMemo(() => Array.from(selectedMessageIds).sort().join('|'), [selectedMessageIds])
  const selectedMessages = useMemo(
    () => conversation.messages.filter((message) => selectedMessageIds.has(message.id)),
    [conversation.messages, selectedMessageIds]
  )

  const clearMessageSelection = useCallback(() => {
    clearChatMessageSelection({ setMultiSelectActive, setSelectedMessageIds })
  }, [])

  const copyConversationLink = useCallback(async () => {
    await copyConversationLinkToClipboard({ conversationId: conversation.id, dialog, t })
  }, [conversation.id, dialog, t])

  const quoteMessage = useCallback((message: Message) => {
    quoteChatMessageDraft({ dialog, message, onApplyStarter, setActiveActionMessageId, setMultiSelectActive, setSelectedMessageIds, t })
  }, [dialog, onApplyStarter, setActiveActionMessageId, t])

  const editUserMessage = useCallback((message: Message) => {
    if (editTimerRef.current) clearTimeout(editTimerRef.current)
    editTimerRef.current = editUserChatMessageDraft({
      conversation,
      dialog,
      message,
      onApplyStarter,
      safeStopMessage,
      setActiveActionMessageId,
      setMultiSelectActive,
      setSelectedMessageIds,
      t,
      updateConversation,
      trimDelayMs: motion === 'full' ? 180 : 1,
      onBeforeTrim: (_messageId, removedMessageIds) => {
        setActiveActionMessageId(null)
        setMultiSelectActive(false)
        setSelectedMessageIds(new Set())
        setRewindingMessageIds(new Set(removedMessageIds))
      },
      onTrimComplete: () => {
        editTimerRef.current = null
        setRewindingMessageIds(new Set())
      },
    }) ?? null
  }, [conversation, dialog, motion, onApplyStarter, safeStopMessage, setActiveActionMessageId, t, updateConversation])

  const startMessageMultiSelect = useCallback((message: Message) => {
    startChatMessageMultiSelect({ message, setActiveActionMessageId, setMultiSelectActive, setSelectedMessageIds })
  }, [setActiveActionMessageId])

  const toggleSelectedMessage = useCallback((message: Message) => {
    toggleChatMessageSelection({ message, setMultiSelectActive, setSelectedMessageIds })
  }, [])

  const copySelectedMessages = useCallback(async () => {
    return copySelectedMessagesToClipboard({ selectedMessages, dialog, t })
  }, [dialog, selectedMessages, t])

  const exportSelectedMessages = useCallback(async () => {
    return exportSelectedMessagesMarkdown({ conversation, selectedMessages, dialog, t })
  }, [conversation, dialog, selectedMessages, t])

  const deleteSelectedMessages = useCallback(async () => {
    const deletedCount = await deleteSelectedMessagesWithConfirmation({
      conversation,
      selectedMessages,
      dialog,
      t,
      updateConversation,
    })
    if (deletedCount) clearMessageSelection()
    return deletedCount
  }, [clearMessageSelection, conversation, dialog, selectedMessages, t, updateConversation])

  useEffect(() => {
    clearMessageSelection()
    setActiveActionMessageId(null)
    setRewindingMessageIds(new Set())
    if (editTimerRef.current) {
      clearTimeout(editTimerRef.current)
      editTimerRef.current = null
    }
  }, [clearMessageSelection, conversation.id, setActiveActionMessageId])

  useEffect(() => () => {
    if (editTimerRef.current) clearTimeout(editTimerRef.current)
  }, [])

  useEffect(() => {
    if (multiSelectActive && selectedMessageIds.size === 0) setMultiSelectActive(false)
  }, [multiSelectActive, selectedMessageIds.size])

  return {
    clearMessageSelection,
    copyConversationLink,
    copySelectedMessages,
    deleteSelectedMessages,
    editUserMessage,
    exportSelectedMessages,
    multiSelectActive,
    quoteMessage,
    rewindingMessageIds,
    selectedMessageIds,
    selectedMessageSignature,
    selectedMessages,
    startMessageMultiSelect,
    toggleSelectedMessage,
  }
}
