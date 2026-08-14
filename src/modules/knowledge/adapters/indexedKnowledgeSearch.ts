import type {
  KnowledgeAgenticSearchRequest,
  KnowledgeHybridSearchRequest,
  KnowledgeIndexedSearchPort,
} from '../application/knowledgeRetrievalUseCase'

export interface IndexedKnowledgeHybridOptions<Provider = unknown> {
  limit: number
  mode: 'hybrid'
  embeddingMode: KnowledgeHybridSearchRequest<Provider>['embeddingMode']
  signal?: AbortSignal
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  provider?: Provider
}

export interface IndexedKnowledgeAgenticOptions<Plan = unknown, Technique = unknown> {
  limit: number
  signal?: AbortSignal
  plan?: Plan
  techniques?: Technique[]
}

export interface IndexedKnowledgeSearchDriver<
  Source,
  Provider = unknown,
  Plan = unknown,
  Technique = unknown,
> {
  searchHybrid(
    query: string,
    options: IndexedKnowledgeHybridOptions<Provider>,
  ): Promise<readonly Source[]>
  searchAgenticIndexes(
    query: string,
    options: IndexedKnowledgeAgenticOptions<Plan, Technique>,
  ): Promise<readonly Source[]>
}

export interface IndexedKnowledgeSearchAdapterDependencies<
  Source,
  Provider = unknown,
  Plan = unknown,
  Technique = unknown,
> {
  loadDriver(): Promise<IndexedKnowledgeSearchDriver<Source, Provider, Plan, Technique>>
    | IndexedKnowledgeSearchDriver<Source, Provider, Plan, Technique>
}

/**
 * Adapts a concrete hybrid/agentic index driver to the target retrieval port.
 * Driver loading remains injectable so bootstrap can defer legacy storage
 * initialization and keep runtime method substitution observable.
 */
export function createIndexedKnowledgeSearchAdapter<
  Source,
  Provider = unknown,
  Plan = unknown,
  Technique = unknown,
>(
  dependencies: IndexedKnowledgeSearchAdapterDependencies<Source, Provider, Plan, Technique>,
): KnowledgeIndexedSearchPort<Source, Provider, Plan, Technique> {
  return {
    async searchHybrid(input) {
      const driver = await loadDriver(dependencies, input.signal)
      const results = await raceWithAbort(
        Promise.resolve().then(() => driver.searchHybrid(input.query, {
          limit: input.limit,
          mode: 'hybrid',
          embeddingMode: input.embeddingMode,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: input.localEmbeddingModelId }),
          ...(input.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: input.localEmbeddingModelSource }),
          ...(input.provider === undefined ? {} : { provider: input.provider }),
        })),
        input.signal,
      )
      throwIfAborted(input.signal)
      return results
    },

    async searchAgentic(input) {
      const driver = await loadDriver(dependencies, input.signal)
      const results = await raceWithAbort(
        Promise.resolve().then(() => driver.searchAgenticIndexes(input.query, {
          limit: input.limit,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.plan === undefined ? {} : { plan: input.plan }),
          ...(input.techniques === undefined ? {} : { techniques: [...input.techniques] }),
        })),
        input.signal,
      )
      throwIfAborted(input.signal)
      return results
    },
  }
}

async function loadDriver<Source, Provider, Plan, Technique>(
  dependencies: IndexedKnowledgeSearchAdapterDependencies<Source, Provider, Plan, Technique>,
  signal: AbortSignal | undefined,
): Promise<IndexedKnowledgeSearchDriver<Source, Provider, Plan, Technique>> {
  throwIfAborted(signal)
  return raceWithAbort(
    Promise.resolve().then(() => dependencies.loadDriver()),
    signal,
  )
}

function raceWithAbort<Value>(operation: Promise<Value>, signal: AbortSignal | undefined): Promise<Value> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(createCancellationError())
  return new Promise<Value>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(createCancellationError())
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
  if (signal?.aborted) throw createCancellationError()
}

function createCancellationError(): Error {
  const error = new Error('Knowledge indexed search was cancelled.')
  error.name = 'AbortError'
  return error
}
