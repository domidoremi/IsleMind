import type { Clock, ContextSnapshotId, IdGenerator, Result } from '@/core'
import type { ContextSnapshot } from '@/modules/assistant-runtime'

export const KNOWLEDGE_CONTEXT_SNAPSHOT_RECORD_SCHEMA = 'islemind.knowledge-context-snapshot-record.v1'

export type ContextSourceKind = 'memory' | 'knowledge' | 'web' | 'attachment' | 'tool'

export interface ContextSourceReference {
  id: string
  kind: ContextSourceKind
  title?: string
  sourceUri?: string
  score?: number
}

/** Provider-neutral provenance retained with an immutable context snapshot. */
export interface ContextCitation {
  id: string
  type: Extract<ContextSourceKind, 'memory' | 'knowledge' | 'web'>
  title: string
  excerpt?: string
  url?: string
  documentId?: string
  chunkId?: string
  score?: number
}

export interface KnowledgeRetrievalResult {
  providerContext: string
  sources: readonly ContextSourceReference[]
  citations?: readonly ContextCitation[]
}

export interface KnowledgeContextRetrievalInput {
  conversationId: string
  requestMessageId?: string
  requestText: string
}

export interface KnowledgeContextRetriever {
  retrieve(
    input: KnowledgeContextRetrievalInput,
    options: { signal: AbortSignal },
  ): Promise<KnowledgeRetrievalResult>
}

/**
 * Boundary for a concrete retrieval implementation. The implementation may
 * use local storage, a remote index, or a temporary migration adapter, but it
 * returns untrusted data for the module to validate and normalize.
 */
export interface KnowledgeContextRetrievalPort {
  retrieve(input: KnowledgeContextRetrievalInput, options: { signal: AbortSignal }): Promise<unknown>
}

export interface KnowledgeContextRetrieverDependencies {
  port: KnowledgeContextRetrievalPort
}

export type MemoryCandidateSourceKind = 'deterministic' | 'model'

export interface MemoryCandidateRecord {
  content: string
}

export interface PendingMemoryCandidate {
  conversationId: string
  content: string
  sourceKind: MemoryCandidateSourceKind
  sourceDetail: string
  confidence: number
}

export interface KnowledgeRepositoryOperationOptions {
  signal?: AbortSignal
}

/** Port for the durable memory store used by the target candidate use case. */
export interface MemoryCandidateRepository {
  listAll(options?: KnowledgeRepositoryOperationOptions): Promise<readonly MemoryCandidateRecord[]>
  addPending(
    candidate: PendingMemoryCandidate,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<MemoryCandidateRecord | undefined>
}

export const KNOWLEDGE_MEMORY_RECORD_SCHEMA = 'islemind.knowledge-memory-record.v1'
export const KNOWLEDGE_DOCUMENT_RECORD_SCHEMA = 'islemind.knowledge-document-record.v1'
export const KNOWLEDGE_CHUNK_RECORD_SCHEMA = 'islemind.knowledge-chunk-record.v1'

export type KnowledgeMemoryStatus = 'pending' | 'active' | 'disabled'
export type KnowledgeMemorySourceKind = 'manual' | 'deterministic' | 'model' | 'imported' | 'legacy'

/**
 * Provider-neutral, durable memory record. The repository maps this record to
 * the existing SQLite data during the migration; callers do not depend on the
 * legacy context-store type or its concrete database implementation.
 */
export interface KnowledgeMemoryRecord extends MemoryCandidateRecord {
  schema: typeof KNOWLEDGE_MEMORY_RECORD_SCHEMA
  id: string
  status: KnowledgeMemoryStatus
  conversationId?: string
  sourceKind: KnowledgeMemorySourceKind
  sourceDetail?: string
  confidence?: number
  lastHitAt?: number
  createdAt: number
  updatedAt: number
}

export interface KnowledgeMemoryWrite {
  id?: string
  content: string
  status: KnowledgeMemoryStatus
  conversationId?: string
  sourceKind: KnowledgeMemorySourceKind
  sourceDetail?: string
  confidence?: number
  lastHitAt?: number
  createdAt?: number
  updatedAt?: number
}

export interface KnowledgeMemoryListInput extends KnowledgeRepositoryOperationOptions {
  statuses?: readonly KnowledgeMemoryStatus[]
}

export interface KnowledgeMemorySearchHit extends KnowledgeMemoryRecord {
  score: number
}

export interface KnowledgeMemorySearchInput extends KnowledgeRepositoryOperationOptions {
  query: string
  limit: number
  statuses: readonly KnowledgeMemoryStatus[]
}

export interface KnowledgeRepositorySnapshot {
  memories: readonly KnowledgeMemoryWrite[]
  documents: readonly KnowledgeDocumentRecord[]
  chunks: readonly KnowledgeChunkRecord[]
}

export interface KnowledgeMemoryRepository extends MemoryCandidateRepository {
  listMemories(input?: KnowledgeMemoryListInput): Promise<readonly KnowledgeMemoryRecord[]>
  saveMemory(
    input: KnowledgeMemoryWrite,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<KnowledgeMemoryRecord>
  updateMemoryStatus(
    id: string,
    status: KnowledgeMemoryStatus,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
  deleteMemory(id: string, options?: KnowledgeRepositoryOperationOptions): Promise<void>
  clearMemories(options?: KnowledgeRepositoryOperationOptions): Promise<void>
  searchMemories(input: KnowledgeMemorySearchInput): Promise<readonly KnowledgeMemorySearchHit[]>
  importMemories(
    memories: readonly KnowledgeMemoryWrite[],
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<readonly KnowledgeMemoryRecord[]>
}

export type KnowledgeDocumentStatus = 'ready' | 'extracting' | 'error'
export type KnowledgeEmbeddingProvider = 'hash' | 'provider' | 'onnx'

/** Stable document provenance stored independently from a concrete index. */
export interface KnowledgeDocumentRecord {
  schema: typeof KNOWLEDGE_DOCUMENT_RECORD_SCHEMA
  id: string
  title: string
  mimeType: string
  size: number
  chunkCount: number
  status: KnowledgeDocumentStatus
  error?: string
  sourceUri?: string
  rawPath?: string
  contentHash?: string
  createdAt: number
  updatedAt: number
}

/** A persisted chunk keeps source and indexing provenance for later retrieval. */
export interface KnowledgeChunkRecord {
  schema: typeof KNOWLEDGE_CHUNK_RECORD_SCHEMA
  id: string
  documentId: string
  title: string
  content: string
  ordinal: number
  chunkIndex?: number
  sentenceStart?: number
  sentenceEnd?: number
  semanticBoundary?: string
  headingPath?: readonly string[]
  entities?: readonly string[]
  relations?: readonly string[]
  summaryNodeId?: string
  parentChunkId?: string
  qualityScore?: number
  embeddingModelId?: string
  rerankSignals?: Readonly<Record<string, number>>
  embeddingProvider?: KnowledgeEmbeddingProvider
  lastHitAt?: number
  createdAt: number
}

/**
 * Provider-neutral FTS candidate returned before compatibility-layer
 * reranking. Provenance stays attached to the persisted chunk/document.
 */
export interface KnowledgeFtsSearchHit {
  id: string
  documentId: string
  title: string
  content: string
  ordinal: number
  chunkIndex?: number
  sourceUri?: string
  rawPath?: string
  score: number
}

export interface KnowledgeFtsSearchInput extends KnowledgeRepositoryOperationOptions {
  query: string
  limit: number
}

/**
 * Read/write boundary for FTS candidates and hit attribution. The caller owns
 * ranking policy while the port owns persisted search data and provenance.
 */
export interface KnowledgeFtsSearchPort {
  searchFts(input: KnowledgeFtsSearchInput): Promise<readonly KnowledgeFtsSearchHit[]>
  markFtsHits(
    chunkIds: readonly string[],
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
}

export interface KnowledgeDocumentRepository {
  loadSnapshot(
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<KnowledgeRepositorySnapshot>
  prepareReplacementSnapshot(snapshot: KnowledgeRepositorySnapshot): KnowledgeRepositorySnapshot
  saveDocument(
    document: KnowledgeDocumentRecord,
    chunks: readonly KnowledgeChunkRecord[],
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
  listDocuments(options?: KnowledgeRepositoryOperationOptions): Promise<readonly KnowledgeDocumentRecord[]>
  listChunks(
    documentId?: string,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<readonly KnowledgeChunkRecord[]>
  deleteDocument(id: string, options?: KnowledgeRepositoryOperationOptions): Promise<void>
  clearDocuments(options?: KnowledgeRepositoryOperationOptions): Promise<void>
  updateDocumentStatus(
    id: string,
    status: KnowledgeDocumentStatus,
    error?: string,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
  replaceSnapshot(
    snapshot: KnowledgeRepositorySnapshot,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
}

export type KnowledgeRepository = KnowledgeMemoryRepository & KnowledgeDocumentRepository & KnowledgeFtsSearchPort

export interface KnowledgeDocumentImportInput {
  title: string
  mimeType: string
  size: number
  text: string
  sourceUri?: string
  rawPath?: string
}

export interface KnowledgeDocumentImportResult {
  documentId: string
  title: string
  chunkCount: number
  sourceUri?: string
  rawPath?: string
  contentHash?: string
}

/**
 * Boundary for document parsing/indexing implementations. The knowledge module
 * validates the request and result even when a legacy importer is still bound
 * at bootstrap.
 */
export interface KnowledgeDocumentImportPort {
  import(
    input: KnowledgeDocumentImportInput,
    options: { signal: AbortSignal },
  ): Promise<unknown>
}

export interface KnowledgeDocumentImportUseCase {
  import(
    input: KnowledgeDocumentImportInput,
    options: { signal: AbortSignal },
  ): Promise<KnowledgeDocumentImportResult>
}

export interface KnowledgeDocumentImportDependencies {
  port: KnowledgeDocumentImportPort
  maxTextChars?: number
}

/**
 * Secondary-index boundary used after the canonical document/chunk bundle is
 * durable. Implementations may maintain vector, graph, or provider indexes,
 * but do not own the canonical knowledge records.
 */
export interface KnowledgeDocumentIndexPort {
  synchronize(
    document: KnowledgeDocumentRecord,
    chunks: readonly KnowledgeChunkRecord[],
    options: { signal: AbortSignal },
  ): Promise<void>
}

export interface KnowledgeDocumentImporterDependencies {
  repository: KnowledgeDocumentRepository
  index?: KnowledgeDocumentIndexPort
  clock?: Clock
  ids?: IdGenerator
  targetChunkLength?: number
}

export interface ContextSnapshotRecord {
  schema: typeof KNOWLEDGE_CONTEXT_SNAPSHOT_RECORD_SCHEMA
  snapshot: ContextSnapshot
  conversationId: string
  requestMessageId?: string
  providerContext: string
  sources: readonly ContextSourceReference[]
  citations: readonly ContextCitation[]
}

export interface ContextSnapshotRepository {
  save(record: ContextSnapshotRecord): Promise<void>
  get(id: ContextSnapshotId): Promise<ContextSnapshotRecord | undefined>
}

export interface ContextAssemblyInput {
  conversationId: string
  conversationMessageIds: readonly string[]
  requestMessageId?: string
  requestText: string
  cancellationSignal?: AbortSignal
}

export interface AssembledContext {
  snapshot: ContextSnapshot
  providerContext: string
  sources: readonly ContextSourceReference[]
  citations: readonly ContextCitation[]
}

export type ContextAssemblyErrorCode =
  | 'cancelled'
  | 'invalid_input'
  | 'retrieval_failed'
  | 'retrieval_invalid'
  | 'persistence_failed'

export interface ContextSnapshotAssembler {
  assemble(input: ContextAssemblyInput): Promise<Result<AssembledContext, ContextAssemblyErrorCode>>
}

export interface ContextSnapshotAssemblerDependencies {
  clock: Clock
  ids: IdGenerator
  repository: ContextSnapshotRepository
  retriever?: KnowledgeContextRetriever
  maxProviderContextChars?: number
}
