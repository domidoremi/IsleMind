import {
  isUsefulMemoryCandidate,
  normalizeMemoryCandidateKey,
  normalizeMemoryCandidateText,
} from '../domain/memoryCandidatePolicy'
import type {
  KnowledgeMemoryScope,
  KnowledgeMemorySensitivity,
  MemoryCandidateRepository,
  MemoryCandidateSourceKind,
} from '../contracts'

export interface MemoryCandidatePersistenceInput {
  conversationId: string
  scope?: KnowledgeMemoryScope
  candidates: readonly MemoryCandidateInput[]
  cancellationSignal?: AbortSignal
}

export interface MemoryCandidateInput {
  content: string
  subject?: string
  key?: string
  value?: string
  sourceKind: MemoryCandidateSourceKind
  sourceDetail: string
  sourceMessageIds?: readonly string[]
  confidence: number
  sensitivity?: KnowledgeMemorySensitivity
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
          const pendingCandidate = {
            conversationId: input.conversationId,
            content: candidate.content,
            ...(candidate.subject === undefined ? {} : { subject: candidate.subject }),
            ...(candidate.key === undefined ? {} : { key: candidate.key }),
            ...(candidate.value === undefined ? {} : { value: candidate.value }),
            sourceKind: candidate.sourceKind,
            sourceDetail: candidate.sourceDetail,
            confidence: candidate.confidence,
            ...(input.scope === undefined ? {} : { scope: input.scope }),
            ...(candidate.sourceMessageIds === undefined ? {} : { sourceMessageIds: candidate.sourceMessageIds }),
            ...(candidate.sensitivity === undefined ? {} : { sensitivity: candidate.sensitivity }),
          }
          const memory = await repository.addPending(pendingCandidate, { signal: input.cancellationSignal })
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
    if (!existing) {
      byKey.set(key, normalized)
      continue
    }
    const stronger = normalized.confidence > existing.confidence ? normalized : existing
    const mergedSourceMessageIds = Array.from(new Set([
      ...(existing.sourceMessageIds ?? []),
      ...(normalized.sourceMessageIds ?? []),
    ]))
    byKey.set(key, {
      ...stronger,
      ...(mergedSourceMessageIds.length ? { sourceMessageIds: mergedSourceMessageIds } : {}),
    })
  }
  return Array.from(byKey.values()).slice(0, 5)
}
