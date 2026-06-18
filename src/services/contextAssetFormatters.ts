import type { TFunction } from 'i18next'
import type { KnowledgeDocument, LocalRagModelCapability, MemoryItem, MemorySourceKind } from '@/types'

export function capabilityLabel(capability: LocalRagModelCapability, t: TFunction): string {
  return t(`contextPanel.localModel.capabilities.${capability}`)
}

export function formatKnowledgeMeta(document: KnowledgeDocument, t: TFunction): string {
  const status = document.status === 'ready'
    ? document.chunkCount > 0
      ? t('contextPanel.knowledgeStatusReady')
      : t('contextPanel.knowledgeStatusEmpty')
    : document.status === 'extracting'
      ? t('contextPanel.knowledgeStatusIndexing')
      : t('contextPanel.knowledgeStatusFailed')
  const updated = t('contextPanel.knowledgeUpdatedAt', { time: formatMemoryTime(document.updatedAt) })
  const source = document.sourceUri
    ? t('contextPanel.knowledgeSource', { source: shortenKnowledgeSource(document.sourceUri) })
    : ''
  const error = document.status === 'error' && document.error
    ? t('contextPanel.knowledgeError', { error: document.error })
    : ''
  return [status, updated, source, error].filter(Boolean).join(' · ')
}

export function shortenKnowledgeSource(source: string): string {
  if (source.length <= 48) return source
  return `${source.slice(0, 24)}...${source.slice(-18)}`
}

export function formatMemoryMeta(memory: MemoryItem, t: TFunction): string {
  const origin = memory.conversationId
    ? t('contextPanel.memorySourceConversation', { id: memory.conversationId.slice(0, 8) })
    : ''
  const sourceKind = t(memorySourceKindKey(memory.sourceKind))
  const confidence = typeof memory.confidence === 'number'
    ? t('contextPanel.memoryConfidence', { confidence: Math.round(Math.max(0, Math.min(1, memory.confidence)) * 100) })
    : ''
  const sourceDetail = memory.sourceDetail
    ? t('contextPanel.memorySourceDetail', { detail: memory.sourceDetail })
    : ''
  const created = t('contextPanel.memoryCreatedAt', { time: formatMemoryTime(memory.createdAt) })
  const used = memory.lastHitAt
    ? t('contextPanel.memoryLastUsedAt', { time: formatMemoryTime(memory.lastHitAt) })
    : t('contextPanel.memoryNeverUsed')
  const updated = Math.abs(memory.updatedAt - memory.createdAt) > 1000
    ? t('contextPanel.memoryUpdatedAt', { time: formatMemoryTime(memory.updatedAt) })
    : ''
  return [origin, sourceKind, confidence, sourceDetail, created, used, updated].filter(Boolean).join(' · ')
}

export function memorySourceKindKey(sourceKind: MemoryItem['sourceKind']): string {
  switch (sourceKind) {
    case 'manual':
      return 'contextPanel.memorySourceManual'
    case 'deterministic':
      return 'contextPanel.memorySourceDeterministic'
    case 'model':
      return 'contextPanel.memorySourceModel'
    case 'imported':
      return 'contextPanel.memorySourceImported'
    case 'legacy':
    default:
      return 'contextPanel.memorySourceLegacy'
  }
}

export function memoryReviewFocusKey(focus: MemorySourceKind): string {
  switch (focus) {
    case 'manual':
      return 'contextPanel.memoryReviewManualFilter'
    case 'deterministic':
      return 'contextPanel.memoryReviewDeterministicFilter'
    case 'model':
      return 'contextPanel.memoryReviewModelFilter'
    case 'imported':
      return 'contextPanel.memoryReviewImportedFilter'
    case 'legacy':
    default:
      return 'contextPanel.memoryReviewLegacyFilter'
  }
}

export function formatMemoryTime(value?: number): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return '-'
  }
}
