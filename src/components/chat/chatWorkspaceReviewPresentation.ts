export const CHAT_WORKSPACE_REVIEW_WRITEBACK_LIMIT = 24

export type ChatWorkspaceReviewKind =
  | 'summary'
  | 'character'
  | 'lorebook'
  | 'memory'
  | 'scene'
  | 'shaping'

export type ChatWorkspaceReviewStatus =
  | 'pending'
  | 'needs-attention'
  | 'conflict'
  | 'blocked'

export interface ChatWorkspaceReviewWritebackProjection {
  id: string
  status: ChatWorkspaceReviewStatus
  reviewUnitCount: number
  kindCounts: Partial<Readonly<Record<ChatWorkspaceReviewKind, number>>>
  canApprove: boolean
  canDismiss: boolean
  approveConfirmationRequired?: boolean
}

export interface ChatWorkspaceReviewProjection {
  pendingWritebackCount: number
  reviewUnitCount: number
  privateMemoryCount: number
  canClearPrivateMemory: boolean
  pendingWritebacks: readonly ChatWorkspaceReviewWritebackProjection[]
}

export interface ChatWorkspaceReviewKindCount {
  kind: ChatWorkspaceReviewKind
  count: number
}

export interface ChatWorkspaceReviewPresentedWriteback {
  id: string
  status: ChatWorkspaceReviewStatus
  reviewUnitCount: number
  kindCounts: readonly ChatWorkspaceReviewKindCount[]
  canApprove: boolean
  canDismiss: boolean
  approveConfirmationRequired: boolean
}

export interface ChatWorkspaceReviewPresentation {
  pendingWritebackCount: number
  hiddenPendingWritebackCount: number
  reviewUnitCount: number
  privateMemoryCount: number
  canClearPrivateMemory: boolean
  writebacks: readonly ChatWorkspaceReviewPresentedWriteback[]
}

const REVIEW_KINDS: readonly ChatWorkspaceReviewKind[] = [
  'summary',
  'character',
  'lorebook',
  'memory',
  'scene',
  'shaping',
]

export function presentChatWorkspaceReview(
  projection: ChatWorkspaceReviewProjection,
): ChatWorkspaceReviewPresentation {
  const seenIds = new Set<string>()
  const writebacks: ChatWorkspaceReviewPresentedWriteback[] = []

  for (const writeback of projection.pendingWritebacks) {
    if (writebacks.length >= CHAT_WORKSPACE_REVIEW_WRITEBACK_LIMIT) break
    if (!writeback.id.trim() || seenIds.has(writeback.id)) continue
    seenIds.add(writeback.id)

    writebacks.push({
      id: writeback.id,
      status: writeback.status,
      reviewUnitCount: boundedCount(writeback.reviewUnitCount),
      kindCounts: REVIEW_KINDS.flatMap((kind) => {
        const count = boundedCount(writeback.kindCounts[kind] ?? 0)
        return count > 0 ? [{ kind, count }] : []
      }),
      canApprove: writeback.canApprove === true,
      canDismiss: writeback.canDismiss === true,
      approveConfirmationRequired: writeback.approveConfirmationRequired === true,
    })
  }

  const pendingWritebackCount = Math.max(
    boundedCount(projection.pendingWritebackCount),
    writebacks.length,
  )

  return {
    pendingWritebackCount,
    hiddenPendingWritebackCount: Math.max(0, pendingWritebackCount - writebacks.length),
    reviewUnitCount: boundedCount(projection.reviewUnitCount),
    privateMemoryCount: boundedCount(projection.privateMemoryCount),
    canClearPrivateMemory: projection.canClearPrivateMemory === true,
    writebacks,
  }
}

function boundedCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value))
}
