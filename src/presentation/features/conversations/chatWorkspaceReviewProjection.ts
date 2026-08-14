import type { ChatWorkspaceReviewProjection as WorkspaceReviewProjection } from '@/modules/workspaces'
import type {
  ChatWorkspaceReviewProjection as ChatReviewProjection,
  ChatWorkspaceReviewStatus,
} from '@/components/chat/chatWorkspaceReviewPresentation'

export function projectChatWorkspaceReview(
  projection: WorkspaceReviewProjection,
): ChatReviewProjection {
  return {
    pendingWritebackCount: projection.counts.pendingWritebackCount,
    reviewUnitCount: projection.counts.pendingReviewUnitCount,
    privateMemoryCount: projection.counts.totalPrivateRelationshipMemoryCount,
    canClearPrivateMemory: projection.counts.totalPrivateRelationshipMemoryCount > 0,
    pendingWritebacks: projection.pendingWritebacks.map((pending) => ({
      id: pending.id,
      status: resolveStatus(pending.counts.privateRelationshipMemoryCandidateCount),
      reviewUnitCount: pending.counts.reviewUnitCount,
      kindCounts: {
        summary: pending.counts.summaryCount,
        character: pending.counts.characterCount,
        lorebook: pending.counts.lorebookCount,
        memory: pending.counts.relationshipMemoryCandidateCount,
        scene: pending.counts.sceneCount,
      },
      canApprove: pending.counts.reviewUnitCount > 0,
      canDismiss: pending.counts.reviewUnitCount > 0,
      approveConfirmationRequired:
        pending.counts.persistablePrivateRelationshipMemoryCandidateCount > 0,
    })),
  }
}

function resolveStatus(privateCandidateCount: number): ChatWorkspaceReviewStatus {
  return privateCandidateCount > 0 ? 'needs-attention' : 'pending'
}
