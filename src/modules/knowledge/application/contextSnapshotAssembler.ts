import {
  createContextSnapshotId,
  err,
  ok,
  type ContextSnapshotId,
} from '@/core'
import type { ContextSnapshot } from '@/modules/assistant-runtime'
import type {
  AssembledContext,
  ContextAssemblyInput,
  ContextSnapshotAssembler,
  ContextSnapshotAssemblerDependencies,
  ContextSourceKind,
  ContextSourceReference,
  ContextCitation,
  KnowledgeRetrievalResult,
} from '../contracts'
import { KNOWLEDGE_CONTEXT_SNAPSHOT_RECORD_SCHEMA } from '../contracts'

const DEFAULT_MAX_PROVIDER_CONTEXT_CHARS = 24_000
const MAX_CONTEXT_SOURCES = 64

export function createContextSnapshotAssembler(
  dependencies: ContextSnapshotAssemblerDependencies,
): ContextSnapshotAssembler {
  const maxProviderContextChars = normalizeMaxProviderContextChars(dependencies.maxProviderContextChars)

  return {
    async assemble(input) {
      const normalizedInput = normalizeInput(input)
      if (!normalizedInput) {
        return err('invalid_input', 'The context assembly input is invalid.', { retryable: false })
      }
      if (input.cancellationSignal?.aborted) {
        return err('cancelled', 'Context assembly was cancelled.', { retryable: true })
      }

      let retrieval: KnowledgeRetrievalResult = { providerContext: '', sources: [] }
      if (dependencies.retriever && normalizedInput.requestText) {
        try {
          retrieval = await dependencies.retriever.retrieve({
            conversationId: normalizedInput.conversationId,
            ...(normalizedInput.requestMessageId ? { requestMessageId: normalizedInput.requestMessageId } : {}),
            requestText: normalizedInput.requestText,
          }, { signal: input.cancellationSignal ?? new AbortController().signal })
        } catch {
          if (input.cancellationSignal?.aborted) {
            return err('cancelled', 'Context assembly was cancelled.', { retryable: true })
          }
          return err('retrieval_failed', 'Context retrieval failed.', { retryable: true })
        }
      }

      if (input.cancellationSignal?.aborted) {
        return err('cancelled', 'Context assembly was cancelled.', { retryable: true })
      }

      const normalizedRetrieval = normalizeRetrieval(retrieval, maxProviderContextChars)
      if (!normalizedRetrieval) {
        return err('retrieval_invalid', 'Context retrieval returned an invalid result.', { retryable: false })
      }

      const snapshot = createSnapshot(
        dependencies.ids,
        dependencies.clock.now(),
        normalizedInput.conversationMessageIds,
        normalizedRetrieval.sources,
      )
      const assembled: AssembledContext = {
        snapshot,
        providerContext: normalizedRetrieval.providerContext,
        sources: normalizedRetrieval.sources,
        citations: normalizedRetrieval.citations,
      }

      try {
        await dependencies.repository.save({
          schema: KNOWLEDGE_CONTEXT_SNAPSHOT_RECORD_SCHEMA,
          snapshot,
          conversationId: normalizedInput.conversationId,
          ...(normalizedInput.requestMessageId ? { requestMessageId: normalizedInput.requestMessageId } : {}),
          providerContext: assembled.providerContext,
          sources: assembled.sources,
          citations: assembled.citations,
        })
      } catch {
        return err('persistence_failed', 'The context snapshot could not be persisted.', { retryable: true })
      }

      return ok(assembled)
    },
  }
}

export function appendProviderContext(
  systemPrompt: string | undefined,
  providerContext: string,
): string | undefined {
  const base = systemPrompt?.trim()
  const context = providerContext.trim()
  if (!base && !context) return undefined
  if (!base) return context
  if (!context) return base
  return `${base}\n\n${context}`
}

function normalizeInput(input: ContextAssemblyInput): NormalizedInput | undefined {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return undefined
  const conversationMessageIds = uniqueNonEmptyStrings(input.conversationMessageIds)
  if (!conversationMessageIds.length) return undefined
  const requestMessageId = input.requestMessageId?.trim() || undefined
  return {
    conversationId,
    conversationMessageIds,
    ...(requestMessageId ? { requestMessageId } : {}),
    requestText: input.requestText.trim(),
  }
}

interface NormalizedInput {
  conversationId: string
  conversationMessageIds: readonly string[]
  requestMessageId?: string
  requestText: string
}

function normalizeRetrieval(
  value: KnowledgeRetrievalResult,
  maxProviderContextChars: number,
): (KnowledgeRetrievalResult & { citations: readonly ContextCitation[] }) | undefined {
  if (!value || typeof value !== 'object' || typeof value.providerContext !== 'string' || !Array.isArray(value.sources)) {
    return undefined
  }
  const sources: ContextSourceReference[] = []
  const seen = new Set<string>()
  for (const source of value.sources) {
    const normalized = normalizeSource(source)
    if (!normalized) return undefined
    const key = `${normalized.kind}:${normalized.id}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push(normalized)
    if (sources.length >= MAX_CONTEXT_SOURCES) break
  }
  const citations: ContextCitation[] = []
  const seenCitations = new Set<string>()
  for (const citation of value.citations ?? []) {
    const normalized = normalizeCitation(citation)
    if (!normalized) return undefined
    if (seenCitations.has(normalized.id)) continue
    seenCitations.add(normalized.id)
    citations.push(normalized)
    if (citations.length >= MAX_CONTEXT_SOURCES) break
  }
  if (!citations.length) {
    for (const source of sources) {
      const citation = citationFromSource(source)
      if (!citation || seenCitations.has(citation.id)) continue
      seenCitations.add(citation.id)
      citations.push(citation)
    }
  }
  return {
    providerContext: truncate(value.providerContext.trim(), maxProviderContextChars),
    sources,
    citations,
  }
}

function normalizeSource(source: ContextSourceReference): ContextSourceReference | undefined {
  if (!source || typeof source !== 'object') return undefined
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (!id || !isContextSourceKind(source.kind)) return undefined
  const title = typeof source.title === 'string' ? truncate(source.title.trim(), 512) : undefined
  const sourceUri = typeof source.sourceUri === 'string' ? truncate(source.sourceUri.trim(), 2_048) : undefined
  const score = typeof source.score === 'number' && Number.isFinite(source.score) ? source.score : undefined
  return {
    id,
    kind: source.kind,
    ...(title ? { title } : {}),
    ...(sourceUri ? { sourceUri } : {}),
    ...(score === undefined ? {} : { score }),
  }
}

function normalizeCitation(citation: ContextCitation): ContextCitation | undefined {
  if (!citation || typeof citation !== 'object') return undefined
  const id = typeof citation.id === 'string' ? citation.id.trim() : ''
  const title = typeof citation.title === 'string' ? citation.title.trim() : ''
  if (!id || !title || !isCitationKind(citation.type)) return undefined
  const excerpt = typeof citation.excerpt === 'string' ? truncate(citation.excerpt.trim(), 1_200) : undefined
  const url = typeof citation.url === 'string' ? truncate(citation.url.trim(), 2_048) : undefined
  const documentId = typeof citation.documentId === 'string' ? truncate(citation.documentId.trim(), 512) : undefined
  const chunkId = typeof citation.chunkId === 'string' ? truncate(citation.chunkId.trim(), 512) : undefined
  const score = typeof citation.score === 'number' && Number.isFinite(citation.score) ? citation.score : undefined
  return {
    id,
    type: citation.type,
    title: truncate(title, 512),
    ...(excerpt ? { excerpt } : {}),
    ...(url ? { url } : {}),
    ...(documentId ? { documentId } : {}),
    ...(chunkId ? { chunkId } : {}),
    ...(score === undefined ? {} : { score }),
  }
}

function citationFromSource(source: ContextSourceReference): ContextCitation | undefined {
  if (!isCitationKind(source.kind)) return undefined
  return {
    id: source.id,
    type: source.kind,
    title: source.title ?? source.id,
    ...(source.sourceUri ? { url: source.sourceUri } : {}),
    ...(source.score === undefined ? {} : { score: source.score }),
  }
}

function createSnapshot(
  ids: ContextSnapshotAssemblerDependencies['ids'],
  createdAt: number,
  conversationMessageIds: readonly string[],
  sources: readonly ContextSourceReference[],
): ContextSnapshot {
  return {
    schema: 'islemind.context-snapshot.v1',
    id: createContextSnapshotId(ids),
    createdAt,
    conversationMessageIds,
    memoryIds: sourceIdsForKind(sources, 'memory'),
    knowledgeSourceIds: sourceIdsForKind(sources, 'knowledge'),
    attachmentIds: sourceIdsForKind(sources, 'attachment'),
    approvedToolContextIds: sourceIdsForKind(sources, 'tool'),
  }
}

function sourceIdsForKind(sources: readonly ContextSourceReference[], kind: ContextSourceKind): readonly string[] {
  return sources.filter((source) => source.kind === kind).map((source) => source.id)
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function isContextSourceKind(value: unknown): value is ContextSourceKind {
  return value === 'memory' || value === 'knowledge' || value === 'web' || value === 'attachment' || value === 'tool'
}

function isCitationKind(value: unknown): value is ContextCitation['type'] {
  return value === 'memory' || value === 'knowledge' || value === 'web'
}

function normalizeMaxProviderContextChars(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return DEFAULT_MAX_PROVIDER_CONTEXT_CHARS
  return Math.floor(value)
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit)
}
