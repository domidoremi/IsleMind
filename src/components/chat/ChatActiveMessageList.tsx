import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { ChatActiveMessageFeed, type ChatActiveMessageFeedProps } from './ChatActiveMessageFeed'
import { ChatActiveNavigationRail } from './ChatActiveNavigationRail'

const MOBILE_MESSAGE_LIST_CONTENT_END_GAP = 8

export interface ChatActiveMessageListProps extends ChatActiveMessageFeedProps {
  messageListTopInset: number
  visualTopInset: number
  closeOptionsFromBackground: () => void
}

export function ChatActiveMessageList(props: ChatActiveMessageListProps) {
  const {
    closeOptionsFromBackground,
    messageListBottomPadding,
    messageListController,
    messageListLayout,
    messageListTopInset,
    visualTopInset,
  } = props
  const [mobileNavigationExpanded, setMobileNavigationExpanded] = useState(false)
  const mobileConversationNavigationEnabled =
    messageListLayout.conversationNavigationDockClearance > 0 &&
    messageListController.assistantNavigationVisible
  const expandedMobileNavigationVisible =
    mobileConversationNavigationEnabled &&
    messageListController.assistantNavigationFloatingVisible &&
    mobileNavigationExpanded
  // The floating navigation dock is an overlay: the list viewport keeps a
  // stable frame. Only the explicitly expanded dock receives scroll-content
  // clearance; the default compact trigger stays out of the reading flow.
  const conversationNavigationViewportClearance = expandedMobileNavigationVisible
    ? messageListLayout.conversationNavigationDockClearance
    : 0
  const messageListContentBottomPadding = mobileConversationNavigationEnabled
    ? messageListBottomPadding + conversationNavigationViewportClearance + (expandedMobileNavigationVisible ? MOBILE_MESSAGE_LIST_CONTENT_END_GAP : 0)
    : messageListBottomPadding

  useEffect(() => {
    if (mobileConversationNavigationEnabled && messageListController.assistantNavigationFloatingVisible) return
    setMobileNavigationExpanded(false)
  }, [
    messageListController.assistantNavigationFloatingVisible,
    mobileConversationNavigationEnabled,
  ])

  useEffect(() => {
    // The mobile viewport contracts around the composer and navigation dock.
    // Re-apply only the existing auto-follow policy; historical readers stay
    // anchored because the controller refuses to follow while away from the
    // latest message.
    if (!mobileConversationNavigationEnabled) return
    messageListController.requestMessageLayoutScroll()
  }, [
    messageListController.requestMessageLayoutScroll,
    messageListContentBottomPadding,
    mobileConversationNavigationEnabled,
  ])

  return (
    <View onTouchStart={closeOptionsFromBackground} style={{ flex: 1 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ChatActiveMessageFeed
          {...props}
          messageListBottomPadding={messageListContentBottomPadding}
        />
      </View>
      <ChatActiveNavigationRail
        mobileNavigationExpanded={mobileNavigationExpanded}
        messageListBottomPadding={messageListBottomPadding}
        messageListController={messageListController}
        messageListTopInset={messageListTopInset}
        onMobileNavigationExpandedChange={setMobileNavigationExpanded}
        visualTopInset={visualTopInset}
      />
    </View>
  )
}
