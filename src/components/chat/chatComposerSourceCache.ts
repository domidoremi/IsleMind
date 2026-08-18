import type { KnowledgeDocument, MemoryItem } from '@/types/contextContracts'
import type { SkillDefinition } from '@/types/skillContracts'

export interface ComposerSourceSnapshot {
  skills: SkillDefinition[]
  documents: KnowledgeDocument[]
  memories: MemoryItem[]
}

export interface ComposerSourceLoaders {
  loadSkills: () => Promise<SkillDefinition[]>
  loadDocuments: (signal?: AbortSignal) => Promise<KnowledgeDocument[]>
  loadMemories: (signal?: AbortSignal) => Promise<MemoryItem[]>
}

export const COMPOSER_SOURCE_CACHE_TTL_MS = 15_000

let cache: { expiresAt: number; snapshot: ComposerSourceSnapshot } | null = null
let cacheGeneration = 0
let inFlight: ComposerSourceLoadEntry | null = null

interface ComposerSourceLoadEntry {
  token: object
  controller: AbortController
  promise: Promise<ComposerSourceSnapshot>
}

export function invalidateComposerSourceCache(): void {
  cacheGeneration += 1
  cache = null
  const previous = inFlight
  inFlight = null
  previous?.controller.abort()
}

function createAbortError(): Error {
  const error = new Error('Composer source loading was aborted')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(createAbortError())
    }
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
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

function startComposerSourceLoad(loaders: ComposerSourceLoaders): ComposerSourceLoadEntry {
  const generation = cacheGeneration
  const controller = new AbortController()
  const token = {}
  const promise = (async () => {
    const loadOptional = async <T>(load: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        const value = await load()
        if (controller.signal.aborted) throw createAbortError()
        return value
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw error
        return fallback
      }
    }
    const [skills, documents, memories] = await Promise.all([
      loadOptional(loaders.loadSkills, []),
      loadOptional(() => loaders.loadDocuments(controller.signal), []),
      loadOptional(() => loaders.loadMemories(controller.signal), []),
    ])
    return { skills, documents, memories }
  })().then((snapshot) => {
    if (
      !controller.signal.aborted &&
      generation === cacheGeneration &&
      inFlight?.token === token
    ) {
      cache = { expiresAt: Date.now() + COMPOSER_SOURCE_CACHE_TTL_MS, snapshot }
    }
    return snapshot
  }).finally(() => {
    if (inFlight?.token === token) inFlight = null
  })
  const entry = { token, controller, promise }
  inFlight = entry
  return entry
}

export async function loadComposerSourceSnapshot(
  loaders: ComposerSourceLoaders,
  signal?: AbortSignal,
): Promise<ComposerSourceSnapshot> {
  if (signal?.aborted) throw createAbortError()
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.snapshot
  const entry = inFlight ?? startComposerSourceLoad(loaders)
  return awaitWithAbort(entry.promise, signal)
}
