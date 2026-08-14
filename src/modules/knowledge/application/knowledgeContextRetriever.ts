import type {
  ContextCitation,
  ContextSourceKind,
  ContextSourceReference,
  KnowledgeContextRetriever,
  KnowledgeContextRetrieverDependencies,
  KnowledgeRetrievalResult,
} from '../contracts'

/**
 * Normalizes retrieval-port output into the provider-neutral context contract.
 * Cancellation and provenance stay in the knowledge module even while a
 * concrete retriever is still supplied by bootstrap.
 */
export function createKnowledgeContextRetriever(
  dependencies: KnowledgeContextRetrieverDependencies,
): KnowledgeContextRetriever {
  return {
    async retrieve(input, options) {
      if (options.signal.aborted) return emptyResult()

      const value = await raceWithAbort(
        dependencies.port.retrieve(input, options),
        options.signal,
      )
      const result = parseRetrievalPortResult(value)
      if (!result) throw new Error('The knowledge retrieval port returned an invalid result.')

      return {
        providerContext: result.prompt,
        sources: result.sources.flatMap(toSourceReference),
        citations: result.sources.flatMap(toCitation),
      }
    },
  }
}

interface RetrievalPortResult {
  prompt: string
  sources: readonly Record<string, unknown>[]
}

function emptyResult(): KnowledgeRetrievalResult {
  return { providerContext: '', sources: [] }
}

function parseRetrievalPortResult(value: unknown): RetrievalPortResult | undefined {
  if (!isRecord(value) || typeof value.prompt !== 'string' || !Array.isArray(value.sources)) {
    return undefined
  }
  const sources: Record<string, unknown>[] = []
  for (const source of value.sources) {
    if (!isRecord(source)) return undefined
    sources.push(source)
  }
  return { prompt: value.prompt, sources }
}

function toSourceReference(source: Record<string, unknown>): ContextSourceReference[] {
  const id = readText(source.id)
  const kind = readSourceKind(source.type)
  if (!id || !kind) return []
  const title = readText(source.title)
  const sourceUri = readText(source.sourceUri)
  const score = readFiniteNumber(source.score)
  return [{
    id,
    kind,
    ...(title ? { title } : {}),
    ...(sourceUri ? { sourceUri } : {}),
    ...(score === undefined ? {} : { score }),
  }]
}

function toCitation(source: Record<string, unknown>): ContextCitation[] {
  const id = readText(source.id)
  const type = readCitationKind(source.type)
  const title = readText(source.title)
  if (!id || !type || !title) return []
  const excerpt = readText(source.excerpt)
  const url = readText(source.url)
  const documentId = readText(source.documentId)
  const chunkId = readText(source.chunkId)
  const score = readFiniteNumber(source.score)
  return [{
    id,
    type,
    title,
    ...(excerpt ? { excerpt } : {}),
    ...(url ? { url } : {}),
    ...(documentId ? { documentId } : {}),
    ...(chunkId ? { chunkId } : {}),
    ...(score === undefined ? {} : { score }),
  }]
}

function raceWithAbort<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise<Value>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(createAbortError())
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

function createAbortError(): Error {
  const error = new Error('Knowledge context retrieval was cancelled.')
  error.name = 'AbortError'
  return error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readSourceKind(value: unknown): ContextSourceKind | undefined {
  return value === 'memory' || value === 'knowledge' || value === 'web'
    ? value
    : undefined
}

function readCitationKind(value: unknown): ContextCitation['type'] | undefined {
  return value === 'memory' || value === 'knowledge' || value === 'web'
    ? value
    : undefined
}
