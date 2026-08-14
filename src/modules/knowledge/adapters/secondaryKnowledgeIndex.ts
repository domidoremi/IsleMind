import type {
  KnowledgeChunkRecord,
  KnowledgeDocumentIndexPort,
  KnowledgeDocumentRecord,
} from '../contracts'

export interface SecondaryKnowledgeIndexDocument extends KnowledgeDocumentRecord {}

export interface SecondaryKnowledgeIndexChunk
  extends Omit<KnowledgeChunkRecord, 'headingPath' | 'entities' | 'relations' | 'rerankSignals'> {
  headingPath?: string[]
  entities?: string[]
  relations?: string[]
  rerankSignals?: Record<string, number>
}

export interface SecondaryKnowledgeIndexWriter<Options> {
  upsertDocument(document: SecondaryKnowledgeIndexDocument): Promise<void>
  upsertChunks(
    chunks: SecondaryKnowledgeIndexChunk[],
    options?: Options,
  ): Promise<void>
}

/** Maintains compatibility secondary indexes after canonical records are durable. */
export function createSecondaryKnowledgeIndex<Options>(
  writer: SecondaryKnowledgeIndexWriter<Options>,
  indexing?: Options,
): KnowledgeDocumentIndexPort {
  return {
    async synchronize(document, chunks, operation) {
      throwIfAborted(operation.signal)
      await writer.upsertDocument({ ...document })
      throwIfAborted(operation.signal)
      await writer.upsertChunks(chunks.map(copyChunk), indexing)
      throwIfAborted(operation.signal)
    },
  }
}

function copyChunk(chunk: KnowledgeChunkRecord): SecondaryKnowledgeIndexChunk {
  const { headingPath, entities, relations, rerankSignals, ...record } = chunk
  return {
    ...record,
    ...(headingPath === undefined ? {} : { headingPath: [...headingPath] }),
    ...(entities === undefined ? {} : { entities: [...entities] }),
    ...(relations === undefined ? {} : { relations: [...relations] }),
    ...(rerankSignals === undefined ? {} : { rerankSignals: { ...rerankSignals } }),
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Knowledge document import was cancelled.')
}
