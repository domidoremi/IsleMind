import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { View } from 'react-native'
import { FlashList, type FlashListRef } from '@shopify/flash-list'

import type { useIsleDialog } from '@/components/ui/isle'
import type { ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import type { ProductMobileMessageListLayout } from '@/presentation/layout/productMobileLayout'
import type { Attachment, Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import { ChatActiveMessageEmptyState } from './ChatActiveMessageEmptyState'
import { ChatActiveMessageItem } from './ChatActiveMessageItem'
import { ChatReplyFallbackNotice } from './ChatReplyFallbackNotice'
import type { ChatBoundaryMemoryStatus } from './ChatEmptyState'
import type { ChatActiveMessageFeedState } from './chatActiveMessageFeedState'
import type { ChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import { renderConversationHeaderSpacer } from './chatScreenFrame'
import type { ComposerPanel } from './FloatingComposer'
import { getMessageItemType } from './messageListNavigation'
import { useAppScrollIndicatorStyle } from '@/hooks/useAppScrollIndicatorStyle'

type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

export interface ChatActiveMessageVirtualListProps {
  conversation: Conversation
  provider: AIProvider | undefined
  multimodalPolicy: ChatMultimodalPolicy
  memoryStatus: ChatBoundaryMemoryStatus
  modeEmptyTitle: string
  modeEmptyDescription: string
  regenerableAssistantId?: string
  viewportHeight: number
  messageListBottomPadding: number
  messageListLayout: ProductMobileMessageListLayout
  emptyConversationTopPadding: number
  conversationHeaderTopPadding: number
  listRef: RefObject<FlashListRef<Message> | null>
  dialog: ReturnType<typeof useIsleDialog>
  onApplyStarter: ApplyStarterDraft
  refreshSkills: () => Promise<void>
  removeMessage: (convId: string, msgId: string) => void
  openAgentWorkflowSettings: (message: Message) => void
  goProviders: () => void
  goMemoryReview: () => void
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  activeActionMessageId: string | null
  setActiveActionMessageId: Dispatch<SetStateAction<string | null>>
  repairAgentEvidenceFromMessage: ChatActiveWorkspaceActions['repairAgentEvidenceFromMessage']
  confirmActionFromMessage: ChatActiveWorkspaceActions['confirmActionFromMessage']
  feedState: ChatActiveMessageFeedState
}

export function ChatActiveMessageVirtualList({
  conversation,
  provider,
  multimodalPolicy,
  memoryStatus,
  modeEmptyTitle,
  modeEmptyDescription,
  regenerableAssistantId,
  viewportHeight,
  messageListBottomPadding,
  messageListLayout,
  emptyConversationTopPadding,
  conversationHeaderTopPadding,
  listRef,
  dialog,
  onApplyStarter,
  refreshSkills,
  removeMessage,
  openAgentWorkflowSettings,
  goProviders,
  goMemoryReview,
  setComposerPanel,
  activeActionMessageId,
  setActiveActionMessageId,
  repairAgentEvidenceFromMessage,
  confirmActionFromMessage,
  feedState,
}: ChatActiveMessageVirtualListProps) {
  const scrollIndicatorStyle = useAppScrollIndicatorStyle()
  const {
    editUserMessage,
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
    messageListAccessibility,
    messageListAccessibilityLabel,
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
  } = feedState
  const emptyConversationMinHeight = Math.max(
    0,
    viewportHeight - emptyConversationTopPadding - messageListBottomPadding,
  )
  const readingColumnStyle = useMemo(() => ({
    width: '100%' as const,
    minWidth: 0,
    maxWidth: Math.max(0, messageListLayout.readingColumnMaxWidth - messageListLayout.horizontalPadding * 2),
    alignSelf: 'center' as const,
  }), [messageListLayout.horizontalPadding, messageListLayout.readingColumnMaxWidth])
  const messageListRenderExtraData = useMemo(() => ({
    feed: messageListExtraData,
    providerId: provider?.id ?? null,
    modelId: conversation.model,
  }), [conversation.model, messageListExtraData, provider?.id])

  return (
    <FlashList indicatorStyle={scrollIndicatorStyle}
      ref={listRef}
      style={{ flex: 1 }}
      data={conversation.messages}
      extraData={messageListRenderExtraData}
      keyExtractor={(item) => item.id}
      accessibilityRole="list"
      accessibilityLabel={messageListAccessibilityLabel}
      accessibilityValue={{ text: messageListAccessibility.value }}
      accessibilityState={messageListAccessibility.state}
      keyboardShouldPersistTaps="handled"
      onLayout={handleListLayout}
      onContentSizeChange={handleListContentSizeChange}
      onTouchStart={handleListTouchStart}
      onTouchEnd={handleListTouchEnd}
      onTouchCancel={handleListTouchEnd}
      onScroll={handleListScroll}
      onScrollBeginDrag={handleListScrollBeginDrag}
      onScrollEndDrag={handleListScrollEndDrag}
      onMomentumScrollBegin={handleListMomentumScrollBegin}
      onMomentumScrollEnd={handleListMomentumScrollEnd}
      viewabilityConfig={messageListViewabilityConfig}
      onViewableItemsChanged={handleMessageViewableItemsChanged}
      maintainVisibleContentPosition={messageListMaintainVisibleContentPosition}
      scrollEventThrottle={16}
      drawDistance={messageListDrawDistance}
      getItemType={getMessageItemType}
      contentContainerStyle={{
        minWidth: 0,
        paddingLeft: messageListLayout.horizontalPadding,
        paddingRight: messageListLayout.horizontalPadding,
        paddingTop: conversation.messages.length ? 0 : emptyConversationTopPadding,
        paddingBottom: messageListBottomPadding,
      }}
      ListHeaderComponent={<View style={readingColumnStyle}>{conversation.messages.length ? renderConversationHeaderSpacer(conversationHeaderTopPadding) : null}</View>}
      ListFooterComponent={<View style={readingColumnStyle}><ChatReplyFallbackNotice conversation={conversation} /></View>}
      renderItem={({ item: message, index }) => (
        <View testID={`chat-reading-row-${message.id}`} style={readingColumnStyle}>
        <ChatActiveMessageItem
          conversationId={conversation.id}
          message={message}
          index={index}
          motion={messageListMotion}
          viewportHeight={viewportHeight}
          provider={provider}
          modelId={conversation.model ?? ''}
          regenerableAssistantId={regenerableAssistantId}
          actionSheetActive={activeActionMessageId === message.id}
          onActionMessageChange={setActiveActionMessageId}
          multiSelectActive={multiSelectActive}
          selected={selectedMessageIds.has(message.id)}
          onToggleSelected={toggleSelectedMessage}
          onLayoutChangeRequest={requestMessageLayoutScroll}
          dialog={dialog}
          onApplyStarter={onApplyStarter}
          refreshSkills={refreshSkills}
          removeMessage={removeMessage}
          openAgentWorkflowSettings={openAgentWorkflowSettings}
          repairAgentEvidenceFromMessage={repairAgentEvidenceFromMessage}
          confirmActionFromMessage={confirmActionFromMessage}
          quoteMessage={quoteMessage}
          editUserMessage={editUserMessage}
          startMessageMultiSelect={startMessageMultiSelect}
          isRewinding={rewindingMessageIds.has(message.id)}
        />
        </View>
      )}
      ListEmptyComponent={(
        <View style={readingColumnStyle}>
        <ChatActiveMessageEmptyState
          multimodalPolicy={multimodalPolicy}
          memoryStatus={memoryStatus}
          modeEmptyTitle={modeEmptyTitle}
          modeEmptyDescription={modeEmptyDescription}
          goProviders={goProviders}
          goMemoryReview={goMemoryReview}
          setComposerPanel={setComposerPanel}
          onApplyStarter={onApplyStarter}
          minHeight={emptyConversationMinHeight}
        />
        </View>
      )}
    />
  )
}
