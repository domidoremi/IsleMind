import type { TFunction } from 'i18next'
import type { KnowledgeDocument, MemoryItem } from '@/types/contextContracts'
import { filterPendingMemoriesForReview, type MemoryReviewQueueFocus } from '@/utils/memoryReview'
export type MemoryStatusFocus = 'all' | MemoryItem['status']
export type KnowledgeStatusFocus = 'all' | 'ready' | 'extracting' | 'error' | 'empty'
export type MemorySortMode = 'updated' | 'created' | 'lastUsed'
export type KnowledgeSortMode = 'updated' | 'title' | 'chunks' | 'needsReview'

export function filterAndSortMemories<Memory extends MemoryItem>(
  memories: Memory[],
  options: {
    statusFocus: MemoryStatusFocus
    reviewFocus: MemoryReviewQueueFocus
    filter: string
    sortMode: MemorySortMode
  }
): Memory[] {
  const normalizedFilter = normalizeAssetFilter(options.filter)
  const statusFocused = options.statusFocus === 'all'
    ? memories
    : memories.filter((memory) => memory.status === options.statusFocus)
  const filtered = normalizedFilter
    ? statusFocused.filter((memory) => memoryMatchesFilter(memory, normalizedFilter))
    : statusFocused
  const reviewFiltered = options.statusFocus === 'pending' && options.reviewFocus !== 'all'
    ? filterPendingMemoriesForReview(filtered, options.reviewFocus)
    : filtered
  return sortMemories(reviewFiltered, options.sortMode)
}

export function filterAndSortKnowledgeDocuments<Document extends KnowledgeDocument>(
  documents: Document[],
  options: {
    statusFocus: KnowledgeStatusFocus
    filter: string
    sortMode: KnowledgeSortMode
  }
): Document[] {
  const normalizedFilter = normalizeAssetFilter(options.filter)
  const statusFocused = options.statusFocus === 'all'
    ? documents
    : documents.filter((document) => knowledgeDocumentMatchesStatus(document, options.statusFocus))
  const filtered = normalizedFilter
    ? statusFocused.filter((document) => knowledgeDocumentMatchesFilter(document, normalizedFilter))
    : statusFocused
  return sortKnowledgeDocuments(filtered, options.sortMode)
}

export function hasMemoryAssetFilters(statusFocus: MemoryStatusFocus, reviewFocus: MemoryReviewQueueFocus, filter: string): boolean {
  return statusFocus !== 'all' || reviewFocus !== 'all' || !!filter.trim()
}

export function hasKnowledgeAssetFilters(statusFocus: KnowledgeStatusFocus, filter: string): boolean {
  return statusFocus !== 'all' || !!filter.trim()
}

export function memoryAssetEmptyMessage(focus: MemoryStatusFocus, filter: string, t: TFunction): string {
  if (normalizeAssetFilter(filter) || focus === 'all') return t('contextPanel.noMemoryMatches')
  if (focus === 'pending') return t('contextPanel.noPendingMemories')
  if (focus === 'active') return t('contextPanel.noActiveMemories')
  return t('contextPanel.noDisabledMemories')
}

export function knowledgeAssetEmptyMessage(focus: KnowledgeStatusFocus, filter: string, t: TFunction): string {
  if (normalizeAssetFilter(filter) || focus === 'all') return t('contextPanel.noKnowledgeMatches')
  if (focus === 'ready') return t('contextPanel.noReadyKnowledge')
  if (focus === 'extracting') return t('contextPanel.noIndexingKnowledge')
  if (focus === 'error') return t('contextPanel.noFailedKnowledge')
  return t('contextPanel.noEmptyKnowledge')
}

export function sortMemories<Memory extends MemoryItem>(memories: Memory[], mode: MemorySortMode): Memory[] {
  return [...memories].sort((left, right) => {
    if (mode === 'created') return right.createdAt - left.createdAt
    if (mode === 'lastUsed') return (right.lastHitAt ?? 0) - (left.lastHitAt ?? 0)
    return right.updatedAt - left.updatedAt
  })
}

export function sortKnowledgeDocuments<Document extends KnowledgeDocument>(documents: Document[], mode: KnowledgeSortMode): Document[] {
  return [...documents].sort((left, right) => {
    if (mode === 'title') return left.title.localeCompare(right.title)
    if (mode === 'chunks') return right.chunkCount - left.chunkCount
    if (mode === 'needsReview') return knowledgeReviewWeight(right) - knowledgeReviewWeight(left) || right.updatedAt - left.updatedAt
    return right.updatedAt - left.updatedAt
  })
}

function normalizeAssetFilter(filter: string): string {
  return filter.trim().toLocaleLowerCase()
}

function memoryMatchesFilter(memory: MemoryItem, normalizedFilter: string): boolean {
  const searchableMeta = [
    memory.content,
    memory.status,
    memory.conversationId,
    memory.sourceKind,
    memory.sourceDetail,
    typeof memory.confidence === 'number' ? Math.round(Math.max(0, Math.min(1, memory.confidence)) * 100) : undefined,
  ].filter(Boolean).join(' ')
  return searchableMeta.toLocaleLowerCase().includes(normalizedFilter)
}

function knowledgeDocumentMatchesStatus(document: KnowledgeDocument, focus: KnowledgeStatusFocus): boolean {
  if (focus === 'empty') return document.status === 'ready' && document.chunkCount <= 0
  if (focus === 'ready') return document.status === 'ready' && document.chunkCount > 0
  return document.status === focus
}

function knowledgeDocumentMatchesFilter(document: KnowledgeDocument, normalizedFilter: string): boolean {
  return `${document.title} ${document.status} ${document.error ?? ''} ${document.chunkCount} ${Math.round(document.size / 1024)}`
    .toLocaleLowerCase()
    .includes(normalizedFilter)
}

function knowledgeReviewWeight(document: KnowledgeDocument): number {
  if (document.status === 'error') return 3
  if (document.status === 'ready' && document.chunkCount <= 0) return 2
  if (document.status === 'extracting') return 1
  return 0
}
