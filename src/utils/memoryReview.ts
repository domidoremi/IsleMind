import type { MemoryItem, MemorySourceKind } from '@/types'

export const MEMORY_REVIEW_LOW_CONFIDENCE_THRESHOLD = 0.7

export type MemoryReviewQueueFocus = 'all' | MemorySourceKind | 'lowConfidence'

export interface MemoryReviewSummary {
  pendingCount: number
  modelCount: number
  deterministicCount: number
  manualCount: number
  importedCount: number
  legacyCount: number
  lowConfidenceCount: number
  averageConfidence?: number
}

export function buildMemoryReviewSummary(
  memories: MemoryItem[],
  lowConfidenceThreshold = MEMORY_REVIEW_LOW_CONFIDENCE_THRESHOLD
): MemoryReviewSummary {
  const pendingMemories = memories.filter((memory) => memory.status === 'pending')
  const confidenceValues = pendingMemories
    .map((memory) => memory.confidence)
    .filter((confidence): confidence is number => typeof confidence === 'number')

  return {
    pendingCount: pendingMemories.length,
    modelCount: countPendingBySource(pendingMemories, 'model'),
    deterministicCount: countPendingBySource(pendingMemories, 'deterministic'),
    manualCount: countPendingBySource(pendingMemories, 'manual'),
    importedCount: countPendingBySource(pendingMemories, 'imported'),
    legacyCount: pendingMemories.filter((memory) => memory.sourceKind === 'legacy' || !memory.sourceKind).length,
    lowConfidenceCount: pendingMemories.filter((memory) => typeof memory.confidence === 'number' && memory.confidence < lowConfidenceThreshold).length,
    averageConfidence: confidenceValues.length
      ? confidenceValues.reduce((total, confidence) => total + confidence, 0) / confidenceValues.length
      : undefined,
  }
}

export function filterPendingMemoriesForReview(
  memories: MemoryItem[],
  focus: MemoryReviewQueueFocus = 'all',
  lowConfidenceThreshold = MEMORY_REVIEW_LOW_CONFIDENCE_THRESHOLD
): MemoryItem[] {
  const pendingMemories = memories.filter((memory) => memory.status === 'pending')
  if (focus === 'all') return pendingMemories
  if (focus === 'lowConfidence') {
    return pendingMemories.filter((memory) => typeof memory.confidence === 'number' && memory.confidence < lowConfidenceThreshold)
  }
  if (focus === 'legacy') {
    return pendingMemories.filter((memory) => memory.sourceKind === 'legacy' || !memory.sourceKind)
  }
  return pendingMemories.filter((memory) => memory.sourceKind === focus)
}

function countPendingBySource(memories: MemoryItem[], sourceKind: MemorySourceKind): number {
  return memories.filter((memory) => memory.sourceKind === sourceKind).length
}
