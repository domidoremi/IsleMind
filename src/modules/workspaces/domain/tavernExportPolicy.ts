import type {
  TavernExportAudit,
  TavernExportOptions,
  TavernPendingWriteback,
  TavernScopeDuplicateResult,
  TavernSnapshot,
} from './tavernContracts'
import { hasTavernPendingWritebackReviewUnits } from './tavernReviewPolicy'
import { normalizeTavernSnapshot } from './tavernSnapshotPolicy'

export function filterTavernSnapshotForExport(
  snapshot: TavernSnapshot,
  options: TavernExportOptions = {},
): TavernSnapshot {
  const normalized = normalizeTavernSnapshot(snapshot)
  const includeHiddenMemory = Boolean(options.includeHiddenMemory)
  const includePendingWritebacks = Boolean(options.includePendingWritebacks)
  return {
    ...normalized,
    relationshipMemories: includeHiddenMemory
      ? normalized.relationshipMemories
      : normalized.relationshipMemories.filter((memory) => memory.userVisible),
    pendingWritebacks: includePendingWritebacks
      ? filterPendingWritebacksForExport(
          normalized.pendingWritebacks,
          includeHiddenMemory,
          new Set(normalized.relationshipMemories.filter((memory) => !memory.userVisible).map((memory) => memory.id)),
        )
      : [],
  }
}

export function buildTavernExportAudit(
  snapshot: TavernSnapshot,
  options: TavernExportOptions = {},
): TavernExportAudit {
  const normalized = normalizeTavernSnapshot(snapshot)
  const includePendingWritebacks = Boolean(options.includePendingWritebacks)
  return {
    includeHiddenMemory: Boolean(options.includeHiddenMemory),
    includePendingWritebacks,
    hiddenRelationshipMemoryOmitted: options.includeHiddenMemory
      ? 0
      : normalized.relationshipMemories.filter((memory) => !memory.userVisible).length,
    hiddenPendingRelationshipMemoryCandidateOmitted: options.includeHiddenMemory || !includePendingWritebacks
      ? 0
      : countHiddenPendingRelationshipMemoryCandidates(normalized.pendingWritebacks),
    pendingWritebackOmitted: includePendingWritebacks ? 0 : normalized.pendingWritebacks.length,
    pendingSummaryDraftOmitted: includePendingWritebacks ? 0 : countPendingSummaryDrafts(normalized.pendingWritebacks),
    pendingCharacterDraftOmitted: includePendingWritebacks ? 0 : countPendingCharacterDrafts(normalized.pendingWritebacks),
    pendingLorebookDraftOmitted: includePendingWritebacks ? 0 : countPendingLorebookDrafts(normalized.pendingWritebacks),
    pendingRelationshipMemoryCandidateOmitted: includePendingWritebacks ? 0 : countPendingRelationshipMemoryCandidates(normalized.pendingWritebacks),
    pendingSceneChangeOmitted: includePendingWritebacks ? 0 : countPendingSceneChanges(normalized.pendingWritebacks),
  }
}

export function buildTavernScopeDuplicateAudit(
  snapshot: TavernSnapshot,
  includePendingWritebacks = false,
): TavernScopeDuplicateResult['duplicateAudit'] {
  const normalized = normalizeTavernSnapshot(snapshot)
  const hiddenPendingRelationshipMemoryCandidateCount = countHiddenPendingRelationshipMemoryCandidates(
    normalized.pendingWritebacks,
  )
  return {
    includePendingWritebacks,
    pendingWritebackOmitted: includePendingWritebacks ? 0 : normalized.pendingWritebacks.length,
    pendingSummaryDraftOmitted: includePendingWritebacks ? 0 : countPendingSummaryDrafts(normalized.pendingWritebacks),
    pendingCharacterDraftOmitted: includePendingWritebacks ? 0 : countPendingCharacterDrafts(normalized.pendingWritebacks),
    pendingLorebookDraftOmitted: includePendingWritebacks ? 0 : countPendingLorebookDrafts(normalized.pendingWritebacks),
    pendingRelationshipMemoryCandidateOmitted: includePendingWritebacks ? 0 : countPendingRelationshipMemoryCandidates(normalized.pendingWritebacks),
    pendingPrivateRelationshipMemoryCandidateOmitted: includePendingWritebacks
      ? 0
      : hiddenPendingRelationshipMemoryCandidateCount,
    pendingPrivateRelationshipMemoryCandidateIncluded: includePendingWritebacks
      ? hiddenPendingRelationshipMemoryCandidateCount
      : 0,
    pendingSceneChangeOmitted: includePendingWritebacks ? 0 : countPendingSceneChanges(normalized.pendingWritebacks),
  }
}

function filterPendingWritebacksForExport(
  pendingWritebacks: readonly TavernPendingWriteback[],
  includeHiddenMemory: boolean,
  hiddenRelationshipMemoryIds: ReadonlySet<string> = new Set(),
): TavernPendingWriteback[] {
  if (includeHiddenMemory) return [...pendingWritebacks]
  return pendingWritebacks
    .map((pending) => {
      const hiddenCandidateEvidence = new Set(
        pending.relationshipMemoryCandidates
          .filter((candidate) => !candidate.suggestedUserVisible)
          .map((candidate) => `memory-candidate:${candidate.id}`),
      )
      const hiddenMemoryEvidence = new Set(Array.from(hiddenRelationshipMemoryIds).map((memoryId) => `memory:${memoryId}`))
      return {
        ...pending,
        relationshipMemoryCandidates: pending.relationshipMemoryCandidates.filter((candidate) => candidate.suggestedUserVisible),
        evidence: pending.evidence.filter((item) => !hiddenCandidateEvidence.has(item) && !hiddenMemoryEvidence.has(item)),
      }
    })
    .filter(hasTavernPendingWritebackReviewUnits)
}

function countPendingSummaryDrafts(pendingWritebacks: readonly TavernPendingWriteback[]): number {
  return pendingWritebacks.filter((pending) => pending.summaryDraft).length
}

function countPendingCharacterDrafts(pendingWritebacks: readonly TavernPendingWriteback[]): number {
  return pendingWritebacks.filter((pending) => pending.characterDraftProposal).length
}

function countPendingLorebookDrafts(pendingWritebacks: readonly TavernPendingWriteback[]): number {
  return pendingWritebacks.filter((pending) => pending.lorebookDraftProposal).length
}

function countHiddenPendingRelationshipMemoryCandidates(pendingWritebacks: readonly TavernPendingWriteback[]): number {
  return pendingWritebacks.reduce(
    (count, pending) => count + pending.relationshipMemoryCandidates.filter((candidate) => !candidate.suggestedUserVisible).length,
    0,
  )
}

function countPendingRelationshipMemoryCandidates(pendingWritebacks: readonly TavernPendingWriteback[]): number {
  return pendingWritebacks.reduce((count, pending) => count + pending.relationshipMemoryCandidates.length, 0)
}

function countPendingSceneChanges(pendingWritebacks: readonly TavernPendingWriteback[]): number {
  return pendingWritebacks.filter((pending) => pending.sceneChangeProposal).length
}
