import type { Dispatch, SetStateAction } from 'react'

import type { ChatMultimodalPolicy } from '@/presentation/features/chat/chatMultimodalPolicy'
import type { Attachment } from '@/types/chatContracts'

import { ChatConversationEmptyState, type ChatBoundaryMemoryStatus } from './ChatEmptyState'
import type { ComposerPanel } from './FloatingComposer'

type ApplyStarterDraft = (draft: string, attachments?: Attachment[], restoreIfEmpty?: boolean) => void

export interface ChatActiveMessageEmptyStateProps {
  multimodalPolicy: ChatMultimodalPolicy
  memoryStatus: ChatBoundaryMemoryStatus
  modeEmptyTitle: string
  modeEmptyDescription: string
  minHeight: number
  goProviders: () => void
  goMemoryReview: () => void
  setComposerPanel: Dispatch<SetStateAction<ComposerPanel>>
  onApplyStarter: ApplyStarterDraft
}

export function ChatActiveMessageEmptyState({
  multimodalPolicy,
  memoryStatus,
  modeEmptyTitle,
  modeEmptyDescription,
  minHeight,
  goProviders,
  goMemoryReview,
  setComposerPanel,
  onApplyStarter,
}: ChatActiveMessageEmptyStateProps) {
  return (
    <ChatConversationEmptyState
      multimodalPolicy={multimodalPolicy}
      memoryStatus={memoryStatus}
      title={modeEmptyTitle}
      description={modeEmptyDescription}
      onProviders={goProviders}
      onOpenMemory={goMemoryReview}
      onOpenTools={() => setComposerPanel('more')}
      onApplyStarter={onApplyStarter}
      minHeight={Math.max(0, minHeight)}
    />
  )
}
