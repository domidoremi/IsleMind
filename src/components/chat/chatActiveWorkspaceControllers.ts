import { useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import { useChatActiveWorkspaceLayoutState } from './chatActiveWorkspaceLayoutState'
import { useChatMessageListScrollController } from './chatMessageListScrollState'
import { useChatMessageSelectionController } from './chatMessageSelectionState'
import { useConversationTaskStatus } from './conversationTaskState'
import type { ChatActiveWorkspaceProps } from './chatActiveWorkspaceTypes'

export function useChatActiveWorkspaceControllers({
  conversation: activeConversation,
  providerHealth,
  composerPanel,
  showOptions,
  chromeCollapsed,
  autoStickToBottom,
  workspaceOverlayLocked,
  visualTopInset,
  topChromeInset,
  onApplyStarter,
  updateConversation,
  switchConversationModel,
  dialog,
  listRef,
  setShowOptions,
  setChromeCollapsed,
  setComposerPanel,
  lastScrollOffset,
  messageListBottomPadding,
  setPagerGestureLocked,
  modelAccessSettings,
}: ChatActiveWorkspaceProps) {
  const { t } = useTranslation()
  const { width: activeWindowWidth } = useWindowDimensions()
  const {
    conversationTasks,
    activeConversationTasks,
    primaryConversationTask,
    primaryConversationTaskMessage,
  } = useConversationTaskStatus({ conversation: activeConversation })
  const [chromeHeight, setChromeHeight] = useState(0)
  const [activeActionMessageId, setActiveActionMessageId] = useState<string | null>(null)

  const activeActions = useChatActiveWorkspaceActions({
    activeConversation,
    dialog,
    modelAccessSettings,
    onApplyStarter,
    setShowOptions,
    switchConversationModel,
    t,
    updateConversation,
  })

  const messageSelectionController = useChatMessageSelectionController({
    conversation: activeConversation,
    dialog,
    onApplyStarter,
    safeStopMessage: activeActions.safeStopMessage,
    setActiveActionMessageId,
    t,
    updateConversation,
  })

  const layoutState = useChatActiveWorkspaceLayoutState({
    activeWindowWidth,
    chromeHeight,
    composerPanel,
    providerHealth,
    setChromeCollapsed,
    setChromeHeight,
    setComposerPanel,
    setShowOptions,
    showOptions,
    topChromeInset,
    visualTopInset,
  })

  const messageListController = useChatMessageListScrollController({
    activeActionMessageId,
    autoStickToBottom,
    chromeCollapsed,
    collapseChrome: layoutState.collapseChrome,
    conversationId: activeConversation.id,
    lastScrollOffset,
    listRef,
    messageListBottomPadding,
    messageListTopInset: layoutState.messageListTopInset,
    messages: activeConversation.messages,
    onCloseOverlays: layoutState.closeOptionsFromBackground,
    pagerGesturePersistentlyLocked: workspaceOverlayLocked,
    setActiveActionMessageId,
    setPagerGestureLocked,
  })

  return {
    activeActionMessageId,
    activeActions,
    activeConversationTasks,
    chromeHeight,
    layoutState,
    messageListController,
    messageSelectionController,
    conversationTasks,
    primaryConversationTask,
    primaryConversationTaskMessage,
    scrollToLatestMessage: messageListController.scrollToLatestMessage,
    setActiveActionMessageId,
    setChromeHeight,
  }
}
