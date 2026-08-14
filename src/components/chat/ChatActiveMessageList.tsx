import { View } from 'react-native'

import { ChatActiveMessageFeed, type ChatActiveMessageFeedProps } from './ChatActiveMessageFeed'
import { ChatActiveNavigationRail } from './ChatActiveNavigationRail'

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
    messageListTopInset,
    visualTopInset,
  } = props

  return (
    <View onTouchStart={closeOptionsFromBackground} style={{ flex: 1 }}>
      <ChatActiveMessageFeed {...props} />
      <ChatActiveNavigationRail
        messageListBottomPadding={messageListBottomPadding}
        messageListController={messageListController}
        messageListTopInset={messageListTopInset}
        visualTopInset={visualTopInset}
      />
    </View>
  )
}
