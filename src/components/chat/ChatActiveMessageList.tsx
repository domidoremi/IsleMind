import { View } from 'react-native'

import { ChatActiveMessageFeed, type ChatActiveMessageFeedProps } from './ChatActiveMessageFeed'
import { ChatActiveNavigationRail } from './ChatActiveNavigationRail'

export interface ChatActiveMessageListProps extends ChatActiveMessageFeedProps {
  messageListTopInset: number
  visualTopInset: number
  closeOptionsFromBackground: () => void
}

/**
 * The conversation canvas is one continuous scroll surface.
 *
 * Scroll utilities are overlays: they float above the canvas and never reserve
 * viewport height, so reading position, auto-follow, and jump targets stay
 * stable whether or not a utility happens to be on screen.
 */
export function ChatActiveMessageList(props: ChatActiveMessageListProps) {
  const {
    closeOptionsFromBackground,
    messageListBottomPadding,
    messageListController,
    messageListTopInset,
    visualTopInset,
  } = props

  return (
    <View onTouchStart={closeOptionsFromBackground} style={{ flex: 1 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ChatActiveMessageFeed {...props} />
      </View>
      <ChatActiveNavigationRail
        messageListBottomPadding={messageListBottomPadding}
        messageListController={messageListController}
        messageListTopInset={messageListTopInset}
        visualTopInset={visualTopInset}
      />
    </View>
  )
}
