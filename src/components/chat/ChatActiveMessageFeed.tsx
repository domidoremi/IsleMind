import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { FlashListRef } from '@shopify/flash-list'

import type { useIsleDialog } from '@/components/ui/isle'
import type { MotionIntensity } from '@/hooks/useMotionPreference'
import type { ConversationTaskActivityRecord } from '@/modules/tasks'
import type { ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import type { ProductMobileMessageListLayout } from '@/presentation/layout/productMobileLayout'
import type { Attachment, Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'

import { ChatActiveMessageVirtualList } from './ChatActiveMessageVirtualList'
import type { ChatBoundaryMemoryStatus } from './ChatEmptyState'
import { useChatActiveMessageFeedState } from './chatActiveMessageFeedState'
import type { ChatActiveWorkspaceActions } from './chatActiveWorkspaceActions'
import type { useChatMessageListScrollController } from './chatMessageListScrollState'
import type { useChatMessageSelectionController } from './chatMessageSelectionState'
import type { ComposerPanel } from './FloatingComposer'

type ChatMessageSelectionController = ReturnType<typeof useChatMessageSelectionController>
type ChatMessageListController = ReturnType<typeof useChatMessageListScrollController>
type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

export interface ChatActiveMessageFeedProps {
  conversation: Conversation
  provider: AIProvider | undefined
  multimodalPolicy: ChatMultimodalPolicy
  memoryStatus: ChatBoundaryMemoryStatus
  modeEmptyTitle: string
  modeEmptyDescription: string
  activityLabel: string
  isStreaming: boolean
  motion: MotionIntensity
  conversationTasks: ConversationTaskActivityRecord[]
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
  messageSelectionController: ChatMessageSelectionController
  messageListController: ChatMessageListController
  repairAgentEvidenceFromMessage: ChatActiveWorkspaceActions['repairAgentEvidenceFromMessage']
  confirmActionFromMessage: ChatActiveWorkspaceActions['confirmActionFromMessage']
}

export function ChatActiveMessageFeed({
  conversation,
  provider,
  multimodalPolicy,
  memoryStatus,
  modeEmptyTitle,
  modeEmptyDescription,
  activityLabel,
  isStreaming,
  motion,
  conversationTasks,
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
  messageSelectionController,
  messageListController,
  repairAgentEvidenceFromMessage,
  confirmActionFromMessage,
}: ChatActiveMessageFeedProps) {
  const feedState = useChatActiveMessageFeedState({
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
  })

  return (
    <ChatActiveMessageVirtualList
      conversation={conversation}
      provider={provider}
      multimodalPolicy={multimodalPolicy}
      memoryStatus={memoryStatus}
      modeEmptyTitle={modeEmptyTitle}
      modeEmptyDescription={modeEmptyDescription}
      regenerableAssistantId={regenerableAssistantId}
      viewportHeight={viewportHeight}
      messageListBottomPadding={messageListBottomPadding}
      messageListLayout={messageListLayout}
      emptyConversationTopPadding={emptyConversationTopPadding}
      conversationHeaderTopPadding={conversationHeaderTopPadding}
      listRef={listRef}
      dialog={dialog}
      onApplyStarter={onApplyStarter}
      refreshSkills={refreshSkills}
      removeMessage={removeMessage}
      openAgentWorkflowSettings={openAgentWorkflowSettings}
      goProviders={goProviders}
      goMemoryReview={goMemoryReview}
      setComposerPanel={setComposerPanel}
      activeActionMessageId={activeActionMessageId}
      setActiveActionMessageId={setActiveActionMessageId}
      repairAgentEvidenceFromMessage={repairAgentEvidenceFromMessage}
      confirmActionFromMessage={confirmActionFromMessage}
      feedState={feedState}
    />
  )
}
