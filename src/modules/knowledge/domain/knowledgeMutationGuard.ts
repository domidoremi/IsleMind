import {
  KnowledgeRepositoryConflictError,
  type KnowledgeDocumentClearOptions,
  type KnowledgeDocumentMutationOptions,
  type KnowledgeDocumentRecord,
  type KnowledgeDocumentStatusMutationOptions,
  type KnowledgeChunkRecord,
  type KnowledgeMemoryClearOptions,
  type KnowledgeMemoryMutationOptions,
  type KnowledgeMemoryRecord,
} from '../contracts'

export function snapshotKnowledgeMemory<T extends Readonly<KnowledgeMemoryRecord>>(memory: T): T {
  return {
    ...memory,
    ...(memory.scope ? { scope: { ...memory.scope } } : {}),
    ...(memory.sourceMessageIds ? { sourceMessageIds: [...memory.sourceMessageIds] } : {}),
  }
}

type GuardedKnowledgeMutationOptions = KnowledgeMemoryMutationOptions & KnowledgeMemoryClearOptions
  & KnowledgeDocumentMutationOptions & KnowledgeDocumentClearOptions & KnowledgeDocumentStatusMutationOptions

export function snapshotKnowledgeChunk(chunk: Readonly<KnowledgeChunkRecord>): KnowledgeChunkRecord {
  return {
    ...chunk,
    ...(chunk.headingPath ? { headingPath: [...chunk.headingPath] } : {}),
    ...(chunk.entities ? { entities: [...chunk.entities] } : {}),
    ...(chunk.relations ? { relations: [...chunk.relations] } : {}),
    ...(chunk.rerankSignals ? { rerankSignals: { ...chunk.rerankSignals } } : {}),
  }
}

/** Capture consent before awaiting admission; keep the original cancellation signal. */
export function snapshotKnowledgeMutationOptions<T extends GuardedKnowledgeMutationOptions>(operation: T): T {
  return {
    ...operation,
    ...(operation.expectedMemory !== undefined ? { expectedMemory: snapshotKnowledgeMemory(operation.expectedMemory) } : {}),
    ...(operation.expectedActiveMemory !== undefined ? {
      expectedActiveMemory: operation.expectedActiveMemory ? snapshotKnowledgeMemory(operation.expectedActiveMemory) : null,
    } : {}),
    ...(operation.expectedMemories !== undefined ? { expectedMemories: operation.expectedMemories.map(snapshotKnowledgeMemory) } : {}),
    ...(operation.expectedDocument !== undefined ? { expectedDocument: { ...operation.expectedDocument } } : {}),
    ...(operation.expectedDocuments !== undefined ? { expectedDocuments: operation.expectedDocuments.map(document => ({ ...document })) } : {}),
    ...(operation.expectedChunks !== undefined ? { expectedChunks: operation.expectedChunks.map(snapshotKnowledgeChunk) } : {}),
  }
}

const memoryScalarFields = [
  'schema', 'id', 'content', 'status', 'subject', 'key', 'value', 'sensitivity',
  'validFrom', 'validUntil', 'supersedesId', 'conflictWithId', 'conversationId',
  'sourceKind', 'sourceDetail', 'confidence', 'lastHitAt', 'lastConfirmedAt',
  'createdAt', 'updatedAt',
] as const

const documentFields = [
  'schema', 'id', 'title', 'mimeType', 'size', 'chunkCount', 'status', 'error',
  'sourceUri', 'rawPath', 'contentHash', 'createdAt', 'updatedAt',
] as const

export function knowledgeMemoryLogicalKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function assertKnowledgeMemoryUnchanged(
  current: KnowledgeMemoryRecord | undefined,
  expected: Readonly<KnowledgeMemoryRecord>,
): void {
  if (!current
    || memoryScalarFields.some(field => current[field] !== expected[field])
    || current.scope.kind !== expected.scope?.kind
    || current.scope.id !== expected.scope?.id
    || current.sourceMessageIds.length !== expected.sourceMessageIds?.length
    || current.sourceMessageIds.some((id, index) => id !== expected.sourceMessageIds[index])) {
    throw new KnowledgeRepositoryConflictError()
  }
}

export function assertKnowledgeDocumentUnchanged(
  current: KnowledgeDocumentRecord | undefined,
  expected: Readonly<KnowledgeDocumentRecord>,
): void {
  if (!current || documentFields.some(field => current[field] !== expected[field])) {
    throw new KnowledgeRepositoryConflictError()
  }
}

/** Derived index provenance and retrieval hit times can change during reindexing. */
export function assertKnowledgeChunkSourcesUnchanged(
  current: readonly KnowledgeChunkRecord[],
  expected: readonly KnowledgeChunkRecord[],
): void {
  const fields = [
    'schema', 'id', 'documentId', 'title', 'content', 'ordinal', 'chunkIndex',
    'sentenceStart', 'sentenceEnd', 'semanticBoundary', 'parentChunkId',
    'qualityScore', 'embeddingModelId', 'createdAt',
  ] as const
  const byId = new Map(current.map(chunk => [chunk.id, chunk]))
  if (current.length !== expected.length || byId.size !== current.length ||
    new Set(expected.map(chunk => chunk.id)).size !== expected.length) throw new KnowledgeRepositoryConflictError()
  for (const chunk of expected) {
    const retained = byId.get(chunk.id)
    if (!retained || fields.some(field => retained[field] !== chunk[field])) throw new KnowledgeRepositoryConflictError()
    for (const field of ['headingPath', 'entities', 'relations'] as const) {
      const a = retained[field], b = chunk[field]
      if (a?.length !== b?.length || a?.some((item, index) => item !== b?.[index])) throw new KnowledgeRepositoryConflictError()
    }
    const a = retained.rerankSignals, b = chunk.rerankSignals
    if (Boolean(a) !== Boolean(b) || Object.keys(a ?? {}).length !== Object.keys(b ?? {}).length ||
      Object.keys(a ?? {}).some(key => a?.[key] !== b?.[key])) throw new KnowledgeRepositoryConflictError()
  }
}

export function knowledgeMemoryReviewMutationOptions(
  memory: KnowledgeMemoryRecord,
  catalog: readonly KnowledgeMemoryRecord[],
): KnowledgeMemoryMutationOptions {
  const { subject, key } = memory
  const active = subject && key
    ? catalog.find(item => item.id !== memory.id && item.status === 'active'
      && item.scope.kind === memory.scope.kind && item.scope.id === memory.scope.id
      && item.subject && item.key
      && knowledgeMemoryLogicalKey(item.subject) === knowledgeMemoryLogicalKey(subject)
      && knowledgeMemoryLogicalKey(item.key) === knowledgeMemoryLogicalKey(key))
    : undefined
  return {
    expectedMemory: snapshotKnowledgeMemory(memory),
    expectedActiveMemory: active ? snapshotKnowledgeMemory(active) : null,
  }
}
