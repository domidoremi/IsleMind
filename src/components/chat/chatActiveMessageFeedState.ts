import { useMemo } from 'react'
import { Platform } from 'react-native'
import { useTranslation } from 'react-i18next'

import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { ConversationTaskActivityRecord } from '@/modules/tasks'
import type { Conversation } from '@/types/chatContracts'

import {
  buildMessageListAccessibility,
  buildMessageListExtraData,
  resolveMessageListDrawDistance,
  resolveMessageListMotion,
} from './chatMessageListState'
import type { useChatMessageListScrollController } from './chatMessageListScrollState'
import type { useChatMessageSelectionController } from './chatMessageSelectionState'

type ChatMessageSelectionController = ReturnType<typeof useChatMessageSelectionController>
type ChatMessageListController = ReturnType<typeof useChatMessageListScrollController>

export interface ChatActiveMessageFeedStateInput {
  activeActionMessageId: string | null
  activityLabel: string
  conversation: Conversation
  isStreaming: boolean
  messageListController: ChatMessageListController
  messageSelectionController: ChatMessageSelectionController
  conversationTasks: ConversationTaskActivityRecord[]
  motion: MotionIntensity
  regenerableAssistantId?: string
  viewportHeight: number
}

export function useChatActiveMessageFeedState({
  activeActionMessageId,
  activityLabel,
  conversation,
  isStreaming,
  messageListController,
  messageSelectionController,
  conversationTasks,
  motion,
  regenerableAssistantId,
  viewportHeight,
}: ChatActiveMessageFeedStateInput) {
  const { t } = useTranslation()
  const {
    editUserMessage,
    multiSelectActive,
    quoteMessage,
    selectedMessageIds,
    selectedMessageSignature,
    rewindingMessageIds,
    startMessageMultiSelect,
    toggleSelectedMessage,
  } = messageSelectionController
  const {
    handleListContentSizeChange,
    handleListLayout,
    handleListMomentumScrollBegin,
    handleListMomentumScrollEnd,
    handleListScroll,
    handleListScrollBeginDrag,
    handleListScrollEndDrag,
    handleListTouchEnd,
    handleListTouchStart,
    handleMessageViewableItemsChanged,
    messageListMaintainVisibleContentPosition,
    messageListViewabilityConfig,
    requestMessageLayoutScroll,
  } = messageListController
  const messageListDrawDistance = resolveMessageListDrawDistance(Platform.OS, viewportHeight)
  const messageListMotion = resolveMessageListMotion(conversation.messages.length, motion)
  const messageListExtraData = useMemo(() => buildMessageListExtraData({
    activeActionMessageId,
    isStreaming,
    messageListMotion,
    conversationTasks,
    multiSelectActive,
    regenerableAssistantId,
    selectedMessageSignature,
    rewindingMessageIds,
  }), [activeActionMessageId, conversationTasks, isStreaming, messageListMotion, multiSelectActive, regenerableAssistantId, rewindingMessageIds, selectedMessageSignature])
  const messageListAccessibility = useMemo(() => buildMessageListAccessibility({
    activityLabel,
    isStreaming,
    messageCount: conversation.messages.length,
    t,
  }), [activityLabel, conversation.messages.length, isStreaming, t])

  return {
    editUserMessage,
    handleListContentSizeChange,
    handleListLayout,
    handleListMomentumScrollBegin,
    handleListMomentumScrollEnd,
    handleListScroll,
    handleListScrollBeginDrag,
    handleListScrollEndDrag,
    handleListTouchEnd,
    handleMessageViewableItemsChanged,
    handleListTouchStart,
    messageListAccessibility,
    messageListAccessibilityLabel: t('chat.messageListAccessibilityLabel'),
    messageListDrawDistance,
    messageListExtraData,
    messageListMaintainVisibleContentPosition,
    messageListMotion,
    messageListViewabilityConfig,
    multiSelectActive,
    quoteMessage,
    requestMessageLayoutScroll,
    selectedMessageIds,
    rewindingMessageIds,
    startMessageMultiSelect,
    toggleSelectedMessage,
  }
}

export type ChatActiveMessageFeedState = ReturnType<typeof useChatActiveMessageFeedState>
