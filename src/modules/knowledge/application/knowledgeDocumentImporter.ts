import { systemClock, type IdGenerator } from '@/core'
import {
  KNOWLEDGE_CHUNK_RECORD_SCHEMA,
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  type KnowledgeChunkRecord,
  type KnowledgeDocumentImportPort,
  type KnowledgeDocumentImporterDependencies,
  type KnowledgeDocumentRecord,
} from '../contracts'
import { KnowledgeDocumentImportCancelledError, KnowledgeDocumentImportDataError } from './knowledgeDocumentImport'

const DEFAULT_TARGET_CHUNK_LENGTH = 1_200
const MAX_CHUNK_LENGTH = 1_600
const OVERLAP_SENTENCES = 2

/**
 * Target-owned import pipeline. Canonical records are committed before
 * secondary index work begins, and their status makes an interrupted or
 * failed synchronization recoverable and observable.
 */
export function createKnowledgeDocumentImporter(
  dependencies: KnowledgeDocumentImporterDependencies,
): KnowledgeDocumentImportPort {
  const clock = dependencies.clock ?? systemClock
  const ids = dependencies.ids ?? createSystemIdGenerator(clock.now)
  const targetChunkLength = dependencies.targetChunkLength ?? DEFAULT_TARGET_CHUNK_LENGTH
  if (!Number.isSafeInteger(targetChunkLength) || targetChunkLength <= 0 || targetChunkLength > MAX_CHUNK_LENGTH) {
    throw new KnowledgeDocumentImportDataError('The knowledge chunk target length is invalid.')
  }

  return {
    async import(input, options) {
      throwIfAborted(options.signal)
      const now = clock.now()
      const documentId = ids.next('knowledge-document')
      const drafts = splitText(input.text, targetChunkLength)
      if (!drafts.length) throw new KnowledgeDocumentImportDataError('The document contains no indexable text.')
      const sourceUri = normalizeKnowledgeSourceLabel(input.sourceUri)
        ?? normalizeKnowledgeSourceLabel(input.rawPath)
        ?? normalizeKnowledgeSourceLabel(input.title)
      const chunks = drafts.map((draft, ordinal): KnowledgeChunkRecord => {
        const metadata = buildChunkMetadata(draft.content, input.title)
        return {
          schema: KNOWLEDGE_CHUNK_RECORD_SCHEMA,
          id: ids.next('knowledge-chunk'),
          documentId,
          title: input.title,
          content: draft.content,
          ordinal,
          chunkIndex: ordinal,
          sentenceStart: draft.sentenceStart,
          sentenceEnd: draft.sentenceEnd,
          ...metadata,
          embeddingProvider: 'hash',
          createdAt: now,
        }
      })
      const document: KnowledgeDocumentRecord = {
        schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
        id: documentId,
        title: input.title,
        mimeType: input.mimeType,
        size: input.size,
        chunkCount: chunks.length,
        status: dependencies.index ? 'extracting' : 'ready',
        ...(sourceUri === undefined ? {} : { sourceUri }),
        ...(input.rawPath === undefined ? {} : { rawPath: input.rawPath }),
        contentHash: hashText(input.text),
        createdAt: now,
        updatedAt: now,
      }

      await dependencies.repository.saveDocument(document, chunks, { signal: options.signal })
      if (dependencies.index) {
        try {
          await dependencies.index.synchronize({ ...document, status: 'ready' }, chunks, options)
          throwIfAborted(options.signal)
          await dependencies.repository.updateDocumentStatus(documentId, 'ready', undefined, { signal: options.signal })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Knowledge index synchronization failed.'
          await dependencies.repository.updateDocumentStatus(documentId, 'error', message).catch(() => undefined)
          throw error
        }
      }

      return {
        documentId,
        title: input.title,
        chunkCount: chunks.length,
        ...(sourceUri === undefined ? {} : { sourceUri }),
        ...(input.rawPath === undefined ? {} : { rawPath: input.rawPath }),
        contentHash: document.contentHash,
      }
    },
  }
}

interface ChunkDraft {
  content: string
  sentenceStart: number
  sentenceEnd: number
}

function splitText(text: string, targetLength: number): ChunkDraft[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const sentences = segmentSentences(normalized)
  const chunks: ChunkDraft[] = []
  let current: string[] = []
  let currentStart = 0
  let index = 0
  const flush = (endIndex: number) => {
    const content = current.join('').trim()
    if (content) chunks.push({ content, sentenceStart: currentStart, sentenceEnd: Math.max(currentStart, endIndex) })
  }
  while (index < sentences.length) {
    const sentence = sentences[index]
    if (!current.length) currentStart = index
    const nextLength = current.join('').length + sentence.length
    if (current.length && (nextLength > targetLength || nextLength > MAX_CHUNK_LENGTH)) {
      flush(index - 1)
      current = current.length > OVERLAP_SENTENCES ? current.slice(-OVERLAP_SENTENCES) : []
      currentStart = Math.max(0, index - current.length)
      continue
    }
    current.push(sentence)
    index += 1
  }
  flush(sentences.length - 1)
  return chunks
}

function segmentSentences(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (
    locale?: string,
    options?: Record<string, string>,
  ) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter
  if (Segmenter) {
    try {
      const result = Array.from(new Segmenter(undefined, { granularity: 'sentence' }).segment(text))
        .map((item) => item.segment)
        .filter((item) => item.trim())
      if (result.length) return result
    } catch {}
  }
  return (text.match(/[^。！？!?;\n]+[。！？!?;；]?|\n+/g) ?? [text]).filter((item) => item.trim())
}

function buildChunkMetadata(content: string, title: string): Pick<
  KnowledgeChunkRecord,
  'semanticBoundary' | 'headingPath' | 'entities' | 'relations' | 'qualityScore' | 'rerankSignals'
> {
  const headingPath = [title, ...content.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .slice(0, 4)].filter(Boolean)
  const entities = extractEntities(content)
  const semanticBoundary = inferSemanticBoundary(content)
  const qualityScore = estimateQuality(content)
  return {
    semanticBoundary,
    headingPath,
    entities,
    relations: entities.slice(0, 9).flatMap((entity, index, values) =>
      index + 1 < values.length ? [`${entity}->${values[index + 1]}`] : []),
    qualityScore,
    rerankSignals: {
      length: Math.min(1, content.length / 1_200),
      structure: semanticBoundary === 'heading' || semanticBoundary === 'list' ? 1 : 0,
      entityDensity: Math.min(1, entities.length / 8),
      quality: qualityScore,
    },
  }
}

function inferSemanticBoundary(content: string): string {
  const firstLine = content.split('\n').map((line) => line.trim()).find(Boolean)
  if (!firstLine) return 'body'
  if (/^#{1,6}\s+/.test(firstLine)) return 'heading'
  if (/^[-*]\s+|\d+[.)]\s+/.test(firstLine)) return 'list'
  return 'sentence'
}

function extractEntities(content: string): string[] {
  const entities = new Set<string>()
  for (const match of content.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []) entities.add(match)
  for (const match of content.match(/[\u3400-\u9fff]{2,10}/g) ?? []) {
    if (!/^(这个|那个|我们|你们|他们|以及|或者|但是|因为|所以)$/.test(match)) entities.add(match)
  }
  return Array.from(entities).slice(0, 16)
}

function estimateQuality(content: string): number {
  const trimmed = content.trim()
  if (!trimmed) return 0
  const lengthScore = trimmed.length < 120
    ? trimmed.length / 120
    : trimmed.length <= 1_600 ? 1 : Math.max(0.4, 1 - (trimmed.length - 1_600) / 3_200)
  const structure = /(^|\n)#{1,6}\s|\n[-*]\s|\n\d+[.)]/.test(trimmed) ? 0.1 : 0
  const sentenceCount = (trimmed.match(/[。！？.!?]/g) ?? []).length
  return Number(Math.min(1, 0.78 * lengthScore + structure + Math.min(0.12, sentenceCount / 24)).toFixed(3))
}

function normalizeKnowledgeSourceLabel(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text || /^https?:\/\//i.test(text)) return text || undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const parsed = new URL(text)
      const segments = decodeURIComponent(parsed.pathname.replace(/\/+$/, '')).split('/').filter(Boolean)
      return segments.at(-1) ?? parsed.hostname ?? text
    } catch {
      return text
    }
  }
  return text
}

function hashText(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new KnowledgeDocumentImportCancelledError()
}

function createSystemIdGenerator(now: () => number): IdGenerator {
  let sequence = 0
  return {
    next(prefix) {
      sequence += 1
      return `${prefix}-${now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    },
  }
}
