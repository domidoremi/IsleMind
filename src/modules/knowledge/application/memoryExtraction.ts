import type { MemoryCandidateMessage } from '../domain/memoryCandidatePolicy'
import {
  extractDeterministicStructuredMemoryCandidates,
  isUsefulMemoryCandidate,
  normalizeMemoryCandidateText,
  parseMemoryCandidateFact,
} from '../domain/memoryCandidatePolicy'
import { LOCAL_USER_MEMORY_SCOPE_ID } from '../contracts'
import type { MemoryCandidatePersistenceUseCase } from './memoryCandidatePersistence'

export interface MemoryExtractionInput {
  conversationId: string
  messages: readonly MemoryCandidateMessage[]
  memoryEnabled: boolean
  modelExtraction?: {
    generate(recentTranscript: string, signal?: AbortSignal): Promise<string>
    onFailure?(error: unknown): Promise<void>
  }
  sourceDetails: {
    deterministic: string
    model: string
  }
  signal?: AbortSignal
}

export interface MemoryExtractionUseCase {
  extract(input: MemoryExtractionInput): Promise<string[]>
}

export function createMemoryExtractionUseCase(
  persistence: MemoryCandidatePersistenceUseCase,
): MemoryExtractionUseCase {
  return {
    async extract(input) {
      throwIfMemoryExtractionAborted(input.signal)
      if (!input.memoryEnabled) return []

      const recent = input.messages
        .filter((message) => message.status === 'done' && message.content.trim())
        .slice(-6)
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')
      if (!recent) return []

      const deterministicItems = extractDeterministicStructuredMemoryCandidates(input.messages)
      let modelItems: string[] = []
      if (input.modelExtraction) {
        try {
          modelItems = parseMemoryExtractionItems(await input.modelExtraction.generate(recent, input.signal))
        } catch (error) {
          if (isMemoryExtractionCancellation(error, input.signal)) throw toMemoryExtractionAbortError(error)
          try {
            await input.modelExtraction.onFailure?.(error)
          } catch {
            // Runtime telemetry must never suppress deterministic extraction.
          }
        }
      }

      throwIfMemoryExtractionAborted(input.signal)
      const modelSourceMessageIds = input.messages
        .filter((message) => message.role === 'user' && message.status === 'done' && message.id?.trim())
        .slice(-6)
        .map((message) => message.id!.trim())
      return persistence.persist({
        conversationId: input.conversationId,
        scope: { kind: 'user', id: LOCAL_USER_MEMORY_SCOPE_ID },
        candidates: [
          ...deterministicItems.map((candidate) => ({
            ...candidate,
            sourceKind: 'deterministic' as const,
            sourceDetail: input.sourceDetails.deterministic,
            confidence: 0.82,
            sensitivity: 'normal' as const,
          })),
          ...modelItems.map((content) => ({
            content,
            ...parseMemoryCandidateFact(content),
            sourceKind: 'model' as const,
            sourceDetail: input.sourceDetails.model,
            sourceMessageIds: modelSourceMessageIds,
            confidence: 0.68,
            sensitivity: 'normal' as const,
          })),
        ],
        cancellationSignal: input.signal,
      })
    },
  }
}

export function parseMemoryExtractionItems(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const jsonCandidates = [
    cleaned,
    cleaned.match(/\[[\s\S]*\]/)?.[0] ?? '',
  ].filter(Boolean)

  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object') {
              const value = item as Record<string, unknown>
              return [value.memory, value.content, value.text, value.preference, value.fact]
                .find((field): field is string => typeof field === 'string')
            }
            return ''
          })
          .filter((item): item is string => typeof item === 'string')
          .map(normalizeMemoryCandidateText)
          .filter(isUsefulMemoryCandidate)
          .slice(0, 5)
      }
    } catch {}
  }

  return cleaned
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .map(normalizeMemoryCandidateText)
    .filter(isUsefulMemoryCandidate)
    .slice(0, 5)
}

function throwIfMemoryExtractionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw toMemoryExtractionAbortError(signal.reason)
}

function isMemoryExtractionCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function toMemoryExtractionAbortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error('Memory extraction was cancelled.')
  error.name = 'AbortError'
  return error
}
