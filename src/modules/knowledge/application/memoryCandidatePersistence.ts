import {
  isUsefulMemoryCandidate,
  normalizeMemoryCandidateKey,
  normalizeMemoryCandidateText,
} from '../domain/memoryCandidatePolicy'
import type {
  MemoryCandidateRepository,
  MemoryCandidateSourceKind,
} from '../contracts'

export interface MemoryCandidatePersistenceInput {
  conversationId: string
  candidates: readonly MemoryCandidateInput[]
  cancellationSignal?: AbortSignal
}

export interface MemoryCandidateInput {
  content: string
  sourceKind: MemoryCandidateSourceKind
  sourceDetail: string
  confidence: number
}

export interface MemoryCandidatePersistenceUseCase {
  persist(input: MemoryCandidatePersistenceInput): Promise<string[]>
}

export function createMemoryCandidatePersistenceUseCase(
  repository: MemoryCandidateRepository,
): MemoryCandidatePersistenceUseCase {
  return {
    async persist(input) {
      try {
        throwIfAborted(input.cancellationSignal)
        const existing = new Set(
          (await repository.listAll({ signal: input.cancellationSignal }))
            .map((item) => normalizeMemoryCandidateKey(item.content))
            .filter(Boolean),
        )
        const added: string[] = []
        for (const candidate of mergeCandidates(input.candidates)) {
          throwIfAborted(input.cancellationSignal)
          const key = normalizeMemoryCandidateKey(candidate.content)
          if (!key || existing.has(key)) continue
          const memory = await repository.addPending({
            conversationId: input.conversationId,
            content: candidate.content,
            sourceKind: candidate.sourceKind,
            sourceDetail: candidate.sourceDetail,
            confidence: candidate.confidence,
          }, { signal: input.cancellationSignal })
          throwIfAborted(input.cancellationSignal)
          if (!memory) continue
          existing.add(key)
          added.push(memory.content)
        }
        return added
      } catch (error) {
        if (input.cancellationSignal?.aborted) throw createMemoryPersistenceAbortError(input.cancellationSignal.reason)
        throw error
      }
    },
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw createMemoryPersistenceAbortError(signal.reason)
}

function createMemoryPersistenceAbortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error('Memory candidate persistence was cancelled.')
  error.name = 'AbortError'
  return error
}

function mergeCandidates(candidates: readonly MemoryCandidateInput[]): MemoryCandidateInput[] {
  const byKey = new Map<string, MemoryCandidateInput>()
  for (const candidate of candidates) {
    const content = normalizeMemoryCandidateText(candidate.content)
    if (!isUsefulMemoryCandidate(content)) continue
    const key = normalizeMemoryCandidateKey(content)
    if (!key) continue
    const normalized = { ...candidate, content }
    const existing = byKey.get(key)
    if (!existing || normalized.confidence > existing.confidence) byKey.set(key, normalized)
  }
  return Array.from(byKey.values()).slice(0, 5)
}
