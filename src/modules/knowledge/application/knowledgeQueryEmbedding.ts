import { createLocalKnowledgeEmbedding } from '../domain/localVectorIndex'

export type KnowledgeQueryEmbeddingMode = 'provider' | 'local' | 'hybrid'

export const KNOWLEDGE_DEFAULT_LOCAL_EMBEDDING_MODEL_ID = 'auto-local-onnx'

export interface KnowledgeStoredEmbeddingDescriptor {
  source?: string
  embeddingJson?: unknown
  model?: string
}

export interface KnowledgeOnnxQueryEmbeddingRequest {
  query: string
  embeddingMode?: KnowledgeQueryEmbeddingMode
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  signal?: AbortSignal
}

export interface KnowledgeProviderQueryEmbeddingRequest<Provider> {
  query: string
  provider: Provider
  signal?: AbortSignal
}

export interface KnowledgeUnsupportedProviderEmbeddingNotice<Provider> {
  provider: Provider
  signal?: AbortSignal
}

export type KnowledgeQueryEmbeddingSource = 'onnx' | 'provider' | 'local-hash'

export interface KnowledgeQueryEmbeddingResolutionNotice {
  source: KnowledgeQueryEmbeddingSource
  reason?: string
}

export interface KnowledgeQueryEmbeddingUseCaseDependencies<Provider> {
  embedWithOnnx(input: KnowledgeOnnxQueryEmbeddingRequest): Promise<number[] | null | undefined>
  embedWithProvider(input: KnowledgeProviderQueryEmbeddingRequest<Provider>): Promise<number[]>
  notifyProviderUnsupported(input: KnowledgeUnsupportedProviderEmbeddingNotice<Provider>): void | Promise<void>
}

export interface ResolveKnowledgeQueryEmbeddingInput<Provider> extends KnowledgeOnnxQueryEmbeddingRequest {
  chunks: readonly KnowledgeStoredEmbeddingDescriptor[]
  provider?: Provider
  providerConfigured: boolean
  providerSupportsEmbeddings: boolean
  onResolved?: (notice: KnowledgeQueryEmbeddingResolutionNotice) => void
}

export interface KnowledgeQueryEmbeddingUseCase<Provider> {
  resolve(input: ResolveKnowledgeQueryEmbeddingInput<Provider>): Promise<number[]>
}

export class KnowledgeQueryEmbeddingCancelledError extends Error {
  constructor() {
    super('Knowledge query embedding was cancelled.')
    this.name = 'KnowledgeQueryEmbeddingCancelledError'
  }
}

/**
 * Owns query-vector selection and fallback policy while concrete ONNX,
 * provider, and diagnostic adapters remain injected by the composition edge.
 */
export function createKnowledgeQueryEmbeddingUseCase<Provider>(
  dependencies: KnowledgeQueryEmbeddingUseCaseDependencies<Provider>,
): KnowledgeQueryEmbeddingUseCase<Provider> {
  return {
    async resolve(input) {
      throwIfAborted(input.signal)
      let fallbackReason: string | undefined
      const onnxVectorExists = input.chunks.some((chunk) => (
        chunk.source === 'onnx'
        && typeof chunk.embeddingJson === 'string'
        && chunk.model === resolveKnowledgeActiveLocalModelId(input.localEmbeddingModelId)
      ))

      if (input.embeddingMode !== 'provider' && onnxVectorExists) {
        try {
          const embedding = await raceWithAbort(
            dependencies.embedWithOnnx({
              query: input.query,
              embeddingMode: input.embeddingMode,
              ...(input.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: input.localEmbeddingModelId }),
              ...(input.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: input.localEmbeddingModelSource }),
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            }),
            input.signal,
          )
          throwIfAborted(input.signal)
          if (embedding?.length) {
            reportResolution(input, { source: 'onnx' })
            return embedding
          }
          fallbackReason = 'onnx_embedding_unavailable'
        } catch (error) {
          throwIfAborted(input.signal)
          fallbackReason = 'onnx_embedding_failed'
          // Provider and deterministic local vectors remain available.
        }
      }

      const providerVectorExists = input.chunks.some((chunk) => (
        chunk.source === 'provider' && typeof chunk.embeddingJson === 'string'
      ))
      const providerReady = Boolean(
        input.embeddingMode !== 'local'
        && input.provider !== undefined
        && input.providerConfigured
        && input.providerSupportsEmbeddings,
      )

      if (
        !providerReady
        && input.embeddingMode !== 'local'
        && input.provider !== undefined
        && input.providerConfigured
        && (input.embeddingMode === 'provider' || providerVectorExists)
      ) {
        fallbackReason ??= 'provider_embedding_unavailable'
        await raceWithAbort(
          Promise.resolve(dependencies.notifyProviderUnsupported({
            provider: input.provider,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })),
          input.signal,
        )
      }

      if (providerReady && providerVectorExists && input.provider !== undefined) {
        try {
          const embedding = await raceWithAbort(
            dependencies.embedWithProvider({
              query: input.query,
              provider: input.provider,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            }),
            input.signal,
          )
          throwIfAborted(input.signal)
          if (embedding.length) {
            reportResolution(input, { source: 'provider' })
            return embedding
          }
          fallbackReason = 'provider_embedding_empty'
        } catch (error) {
          throwIfAborted(input.signal)
          fallbackReason = 'provider_embedding_failed'
          // Deterministic local vectors keep retrieval available offline.
        }
      }

      throwIfAborted(input.signal)
      reportResolution(input, {
        source: 'local-hash',
        reason: fallbackReason ?? (input.embeddingMode === 'local' ? 'local_embedding_requested' : 'no_model_embedding_available'),
      })
      return createLocalKnowledgeEmbedding(input.query)
    },
  }
}

function reportResolution<Provider>(
  input: ResolveKnowledgeQueryEmbeddingInput<Provider>,
  notice: KnowledgeQueryEmbeddingResolutionNotice,
): void {
  try {
    input.onResolved?.(notice)
  } catch {
    // Diagnostics must never change retrieval behavior.
  }
}

export function resolveKnowledgeActiveLocalModelId(modelId?: string): string {
  return modelId ?? KNOWLEDGE_DEFAULT_LOCAL_EMBEDDING_MODEL_ID
}

function raceWithAbort<Value>(operation: Promise<Value>, signal: AbortSignal | undefined): Promise<Value> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new KnowledgeQueryEmbeddingCancelledError())
  return new Promise<Value>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new KnowledgeQueryEmbeddingCancelledError())
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KnowledgeQueryEmbeddingCancelledError()
}
