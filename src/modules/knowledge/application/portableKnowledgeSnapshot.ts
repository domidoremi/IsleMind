import type { Clock } from '@/core'
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  MemoryItem,
  MemorySourceKind,
} from '@/types/contextContracts'
import {
  KNOWLEDGE_CHUNK_RECORD_SCHEMA,
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  type KnowledgeChunkRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeMemoryRecord,
  type KnowledgeMemorySourceKind,
  type KnowledgeMemoryStatus,
  type KnowledgeMemoryWrite,
  type KnowledgeRepository,
  type KnowledgeRepositoryOperationOptions,
  type KnowledgeRepositorySnapshot,
} from '../contracts'
import { buildKnowledgeChunkMetadata } from '../domain/knowledgeChunkMetadata'

/** Portable backup DTO retained at the untrusted storage boundary. */
export interface PortableKnowledgeSnapshot {
  memories: MemoryItem[]
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
}

export interface PortableKnowledgeSnapshotDependencies {
  repository: KnowledgeRepository
  replaceSnapshot: (
    snapshot: KnowledgeRepositorySnapshot,
    options?: KnowledgeRepositoryOperationOptions,
  ) => Promise<void>
  clock: Pick<Clock, 'now'>
  fallbackChunkTitle: () => string
}

export interface PortableKnowledgeSnapshotService {
  exportSnapshot(options?: KnowledgeRepositoryOperationOptions): Promise<PortableKnowledgeSnapshot>
  prepareImportSnapshot(snapshot: Partial<PortableKnowledgeSnapshot>): KnowledgeRepositorySnapshot
  importSnapshot(
    snapshot: Partial<PortableKnowledgeSnapshot>,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
  importMemoriesForReview(
    memories: readonly MemoryItem[],
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
}

export function createPortableKnowledgeSnapshotService(
  dependencies: PortableKnowledgeSnapshotDependencies,
): PortableKnowledgeSnapshotService {
  return {
    async exportSnapshot(options = {}) {
      throwIfAborted(options.signal)
      const { memories, documents, chunks } = await dependencies.repository.loadSnapshot(options)
      throwIfAborted(options.signal)
      return {
        memories: memories.map(toMemoryItem),
        documents: documents.map(toKnowledgeDocument),
        chunks: chunks.map(toKnowledgeChunk)
          .sort((left, right) => right.createdAt - left.createdAt || left.ordinal - right.ordinal),
      }
    },

    prepareImportSnapshot(snapshot) {
      return dependencies.repository.prepareReplacementSnapshot(
        prepareImportedKnowledgeSnapshot(
          snapshot,
          dependencies.clock.now(),
          dependencies.fallbackChunkTitle,
        ),
      )
    },

    async importSnapshot(snapshot, options = {}) {
      throwIfAborted(options.signal)
      const records = dependencies.repository.prepareReplacementSnapshot(
        prepareImportedKnowledgeSnapshot(
          snapshot,
          dependencies.clock.now(),
          dependencies.fallbackChunkTitle,
        ),
      )
      throwIfAborted(options.signal)
      await dependencies.replaceSnapshot(records, { signal: options.signal })
      throwIfAborted(options.signal)
    },

    async importMemoriesForReview(memories, options = {}) {
      throwIfAborted(options.signal)
      if (!memories.length) return
      const now = dependencies.clock.now()
      const records = memories
        .map((memory) => toImportedMemoryWrite(memory, now))
        .filter((memory): memory is KnowledgeMemoryWrite => memory !== undefined)
      throwIfAborted(options.signal)
      await dependencies.repository.importMemories(records, { signal: options.signal })
      throwIfAborted(options.signal)
    },
  }
}

function prepareImportedKnowledgeSnapshot(
  snapshot: Partial<PortableKnowledgeSnapshot>,
  now: number,
  fallbackChunkTitle: () => string,
): KnowledgeRepositorySnapshot {
  return {
    memories: (Array.isArray(snapshot.memories) ? snapshot.memories : [])
      .map((memory) => toImportedMemoryWrite(memory, now))
      .filter((memory): memory is KnowledgeMemoryWrite => memory !== undefined),
    documents: (Array.isArray(snapshot.documents) ? snapshot.documents : [])
      .map((document) => toImportedDocumentRecord(document, now))
      .filter((document): document is KnowledgeDocumentRecord => document !== undefined),
    chunks: (Array.isArray(snapshot.chunks) ? snapshot.chunks : [])
      .map((chunk) => toImportedChunkRecord(chunk, now, fallbackChunkTitle))
      .filter((chunk): chunk is KnowledgeChunkRecord => chunk !== undefined),
  }
}

function toImportedMemoryWrite(memory: Partial<MemoryItem>, now: number): KnowledgeMemoryWrite | undefined {
  if (!memory.id) return undefined
  const content = normalizeText(memory.content ?? '')
  if (!content) return undefined
  const sourceKind = memory.sourceKind == null ? 'imported' : normalizeMemorySourceKind(memory.sourceKind)
  return {
    id: memory.id,
    content,
    status: normalizeMemoryStatus(memory.status),
    ...(optionalText(memory.conversationId) ? { conversationId: optionalText(memory.conversationId) } : {}),
    sourceKind,
    ...(optionalText(memory.sourceDetail) ? { sourceDetail: optionalText(memory.sourceDetail) } : {}),
    confidence: normalizeConfidence(memory.confidence ?? defaultMemoryConfidence(sourceKind)),
    ...(optionalTimestamp(memory.lastHitAt) === undefined ? {} : { lastHitAt: optionalTimestamp(memory.lastHitAt) }),
    createdAt: timestamp(memory.createdAt, now),
    updatedAt: timestamp(memory.updatedAt, now),
  }
}

function toImportedDocumentRecord(document: Partial<KnowledgeDocument>, now: number): KnowledgeDocumentRecord | undefined {
  const id = optionalText(document.id)
  const title = optionalText(document.title)
  if (!id || !title) return undefined
  return {
    schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
    id,
    title,
    mimeType: optionalText(document.mimeType) ?? 'text/plain',
    size: nonNegativeInteger(document.size),
    chunkCount: nonNegativeInteger(document.chunkCount),
    status: document.status === 'extracting' || document.status === 'error' ? document.status : 'ready',
    ...(optionalText(document.error) ? { error: optionalText(document.error) } : {}),
    ...(optionalText(document.sourceUri) ? { sourceUri: optionalText(document.sourceUri) } : {}),
    ...(optionalText(document.rawPath) ? { rawPath: optionalText(document.rawPath) } : {}),
    ...(optionalText(document.contentHash) ? { contentHash: optionalText(document.contentHash) } : {}),
    createdAt: timestamp(document.createdAt, now),
    updatedAt: timestamp(document.updatedAt, now),
  }
}

function toImportedChunkRecord(
  chunk: Partial<KnowledgeChunk>,
  now: number,
  fallbackChunkTitle: () => string,
): KnowledgeChunkRecord | undefined {
  const id = optionalText(chunk.id)
  const documentId = optionalText(chunk.documentId)
  const content = chunk.content ?? ''
  if (!id || !documentId || !content) return undefined
  const title = optionalText(chunk.title) ?? fallbackChunkTitle()
  const metadata = buildKnowledgeChunkMetadata(content, title)
  const ordinal = nonNegativeInteger(chunk.ordinal)
  return {
    schema: KNOWLEDGE_CHUNK_RECORD_SCHEMA,
    id,
    documentId,
    title,
    content,
    ordinal,
    chunkIndex: optionalNonNegativeInteger(chunk.chunkIndex) ?? ordinal,
    ...(optionalNonNegativeInteger(chunk.sentenceStart) === undefined ? {} : { sentenceStart: optionalNonNegativeInteger(chunk.sentenceStart) }),
    ...(optionalNonNegativeInteger(chunk.sentenceEnd) === undefined ? {} : { sentenceEnd: optionalNonNegativeInteger(chunk.sentenceEnd) }),
    semanticBoundary: optionalText(chunk.semanticBoundary) ?? metadata.semanticBoundary,
    headingPath: chunk.headingPath ?? metadata.headingPath,
    entities: chunk.entities ?? metadata.entities,
    relations: chunk.relations ?? metadata.relations,
    ...(optionalText(chunk.summaryNodeId) ? { summaryNodeId: optionalText(chunk.summaryNodeId) } : {}),
    ...(optionalText(chunk.parentChunkId) ? { parentChunkId: optionalText(chunk.parentChunkId) } : {}),
    qualityScore: unitInterval(chunk.qualityScore) ?? metadata.qualityScore,
    ...(optionalText(chunk.embeddingModelId) ? { embeddingModelId: optionalText(chunk.embeddingModelId) } : {}),
    rerankSignals: chunk.rerankSignals ?? metadata.rerankSignals,
    embeddingProvider: chunk.embeddingProvider === 'provider' || chunk.embeddingProvider === 'onnx' ? chunk.embeddingProvider : 'hash',
    ...(optionalTimestamp(chunk.lastHitAt) === undefined ? {} : { lastHitAt: optionalTimestamp(chunk.lastHitAt) }),
    createdAt: timestamp(chunk.createdAt, now),
  }
}

function toMemoryItem(record: KnowledgeMemoryWrite): MemoryItem {
  if (!record.id || record.createdAt === undefined || record.updatedAt === undefined) {
    throw new TypeError('The coherent knowledge snapshot contains an incomplete memory record.')
  }
  return {
    id: record.id,
    content: record.content,
    status: record.status,
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    sourceKind: record.sourceKind,
    ...(record.sourceDetail ? { sourceDetail: record.sourceDetail } : {}),
    ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
    ...(record.lastHitAt === undefined ? {} : { lastHitAt: record.lastHitAt }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toKnowledgeDocument(record: KnowledgeDocumentRecord): KnowledgeDocument {
  const { schema: _schema, ...document } = record
  return document
}

function toKnowledgeChunk(record: KnowledgeChunkRecord): KnowledgeChunk {
  const { schema: _schema, headingPath, entities, relations, rerankSignals, ...chunk } = record
  return {
    ...chunk,
    ...(headingPath ? { headingPath: [...headingPath] } : {}),
    ...(entities ? { entities: [...entities] } : {}),
    ...(relations ? { relations: [...relations] } : {}),
    ...(rerankSignals ? { rerankSignals: { ...rerankSignals } } : {}),
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function optionalText(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, ' ').trim() || undefined
}

function normalizeMemorySourceKind(value: unknown): KnowledgeMemorySourceKind {
  return value === 'manual' || value === 'deterministic' || value === 'model' || value === 'imported' || value === 'legacy' ? value : 'legacy'
}

function normalizeMemoryStatus(value: unknown): KnowledgeMemoryStatus {
  return value === 'active' || value === 'disabled' ? value : 'pending'
}

function normalizeConfidence(value: number | null | undefined): number | undefined {
  if (value == null || Number.isNaN(value)) return undefined
  return Number(Math.max(0, Math.min(1, value)).toFixed(2))
}

function defaultMemoryConfidence(sourceKind: MemorySourceKind): number {
  return sourceKind === 'manual' ? 1 : sourceKind === 'deterministic' ? 0.82 : sourceKind === 'model' ? 0.68 : sourceKind === 'imported' ? 0.74 : 0.5
}

function timestamp(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value as number : fallback
}

function optionalTimestamp(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value : undefined
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value as number : 0
}

function optionalNonNegativeInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value : undefined
}

function unitInterval(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, Math.min(1, value))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Portable knowledge snapshot operation was cancelled.')
  error.name = 'AbortError'
  throw error
}
