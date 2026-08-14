import { ConversationNavigationRail } from './ConversationNavigationRail'
import type { useChatMessageListScrollController } from './chatMessageListScrollState'

type ChatMessageListController = ReturnType<typeof useChatMessageListScrollController>

export interface ChatActiveNavigationRailProps {
  messageListBottomPadding: number
  messageListController: ChatMessageListController
  messageListTopInset: number
  visualTopInset: number
}

export function ChatActiveNavigationRail({
  messageListBottomPadding,
  messageListController,
  messageListTopInset,
  visualTopInset,
}: ChatActiveNavigationRailProps) {
  const {
    activeAssistantNavigationIndex,
    activeAssistantNavigationItem,
    assistantNavigationFloatingVisible,
    assistantNavigationItems,
    assistantNavigationVisible,
    handleAssistantNavigationInteractionEnd,
    handleAssistantNavigationInteractionStart,
    scrollToAssistantNavigationItem,
  } = messageListController

  if (!assistantNavigationVisible || !activeAssistantNavigationItem) return null

  return (
    <ConversationNavigationRail
      items={assistantNavigationItems}
      activeIndex={activeAssistantNavigationIndex}
      visible={assistantNavigationFloatingVisible}
      topOffset={Math.max(visualTopInset + 70, messageListTopInset + 8)}
      bottomOffset={messageListBottomPadding + 12}
      onSelect={scrollToAssistantNavigationItem}
      onInteractionStart={handleAssistantNavigationInteractionStart}
      onInteractionEnd={handleAssistantNavigationInteractionEnd}
    />
  )
}
