import type { Conversation, Message } from '@/types/chatContracts'
import type { MessageCitation } from '@/types/contextContracts'

export const SAVED_DOCUMENT_SCHEMA = 'islemind.saved-document.v2' as const
export const DOCUMENT_TITLE_LIMIT = 240
export const DOCUMENT_BODY_LIMIT = 1_000_000
export const SAVED_DOCUMENT_COUNT_LIMIT = 10_000
export const DOCUMENT_REVIEW_TEXT_LIMIT = 24_000
export const DOCUMENT_REVIEW_SOURCE_LIMIT = 12

/** Captured references, not copied source documents or permission to retrieve them. */
export type DocumentCitation = Pick<MessageCitation, 'id' | 'type' | 'title' | 'excerpt' | 'url' | 'documentId' | 'chunkId'>

export interface DocumentOrigin {
  conversationId: string
  conversationTitle: string
  messageId: string
  messageStatus: 'done' | 'error' | 'cancelled'
  messageTimestamp: number
  providerId?: string
  model?: string
  originalText: string
  citations: DocumentCitation[]
}

/** Exact retained sections reviewed for a proposal, not live retrieval authority. */
export interface DocumentRevisionSource {
  citationId: string
  type: 'knowledge' | 'memory'
  documentId?: string
  title: string
  updatedAt: number
  text: string
}

/** At most one explicitly retained review, bound to its accepted title/body. */
export interface DocumentReviewContext {
  acceptedAt: number
  title: string
  body: string
  /** Selection order defines S1, S2, etc. It is not a claim-support mapping. */
  sources: DocumentRevisionSource[]
}

export interface DocumentDraft {
  title: string
  body: string
  origin?: DocumentOrigin
  reviewContext?: DocumentReviewContext
}

export interface SavedDocument extends DocumentDraft {
  schema: typeof SAVED_DOCUMENT_SCHEMA
  id: string
  /** An opaque write identity, not an importable execution or recovery authority. */
  revision: string
  createdAt: number
  updatedAt: number
}

export type DocumentSummary = Pick<SavedDocument, 'id' | 'title' | 'createdAt' | 'updatedAt'>
export interface DocumentRepository {
  list(options?: { signal?: AbortSignal }): Promise<DocumentSummary[]>
  get(id: string, options?: { signal?: AbortSignal }): Promise<SavedDocument | undefined>
  create(draft: DocumentDraft): Promise<SavedDocument>
  /** Omitted reviewContext preserves it; null explicitly removes it. */
  save(id: string, revision: string, edit: Pick<DocumentDraft, 'title' | 'body'> & { reviewContext?: DocumentReviewContext | null }): Promise<SavedDocument>
  remove(id: string, revision: string): Promise<void>
  loadSnapshot(options?: { signal?: AbortSignal }): Promise<SavedDocument[]>
  /** Atomic, fenced replacement used only by portable import/rollback. */
  replaceSnapshot(documents: readonly SavedDocument[], expected: readonly (readonly SavedDocument[])[], options?: { signal?: AbortSignal }): Promise<void>
  clear(): Promise<void>
}

export class DocumentConflictError extends Error {
  constructor() {
    super('The saved document changed or was removed. Your edit has not been saved.')
    this.name = 'DocumentConflictError'
  }
}

export function documentDraftFromMessage(conversation: Pick<Conversation, 'id' | 'title'>, message: Message): DocumentDraft {
  if (message.role !== 'assistant' || message.status === 'sending' || message.status === 'streaming') {
    throw new TypeError('Only a terminal assistant answer can become a document.')
  }
  const body = message.responseText ?? message.content
  if (!body.trim()) throw new TypeError('The answer has no text to retain.')
  return parseDocumentDraft({
    title: (conversation.title || body.split(/\r?\n/, 1)[0]).slice(0, DOCUMENT_TITLE_LIMIT),
    body,
    origin: {
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      messageId: message.id,
      messageStatus: message.status,
      messageTimestamp: message.timestamp,
      providerId: message.providerId,
      model: message.model,
      originalText: body,
      citations: message.citations ?? [],
    },
  })
}

export function parseDocumentDraft(value: unknown): DocumentDraft {
  const data = record(value)
  const title = text(data.title, DOCUMENT_TITLE_LIMIT)
  if (!title.trim()) throw new TypeError('A document title is required.')
  return {
    title,
    body: text(data.body, DOCUMENT_BODY_LIMIT),
    ...(data.origin === undefined ? {} : { origin: parseOrigin(data.origin) }),
    ...(data.reviewContext === undefined ? {} : { reviewContext: parseDocumentReviewContext(data.reviewContext) }),
  }
}

export function parseDocumentReviewContext(value: unknown): DocumentReviewContext {
  const data = record(value)
  if (!Array.isArray(data.sources) || !data.sources.length || data.sources.length > DOCUMENT_REVIEW_SOURCE_LIMIT) throw new TypeError('Invalid review sources.')
  const sources = data.sources.map((value): DocumentRevisionSource => {
    const source = record(value)
    if (source.type !== 'knowledge' && source.type !== 'memory') throw new TypeError('Invalid review source kind.')
    if (source.type === 'memory' && source.documentId !== undefined) throw new TypeError('Invalid memory review source.')
    return {
      citationId: identity(source.citationId),
      type: source.type,
      ...(source.type === 'knowledge' ? { documentId: identity(source.documentId) } : {}),
      title: text(source.title, 4_000),
      updatedAt: timestamp(source.updatedAt),
      text: text(source.text, DOCUMENT_REVIEW_TEXT_LIMIT),
    }
  })
  if (new Set(sources.map((source) => source.citationId)).size !== sources.length
    || new Set(sources.map((source) => `${source.type}:${source.documentId ?? source.citationId}`)).size !== sources.length) throw new TypeError('Duplicate review source.')
  if (sources.reduce((total, source) => total + source.title.length + source.text.length, 0) > DOCUMENT_REVIEW_TEXT_LIMIT) throw new TypeError('The review sources exceed the document limit.')
  const title = text(data.title, DOCUMENT_TITLE_LIMIT)
  const body = text(data.body, DOCUMENT_REVIEW_TEXT_LIMIT)
  if (!title.trim() || !body.trim()) throw new TypeError('Invalid reviewed proposal.')
  return { acceptedAt: timestamp(data.acceptedAt), title, body, sources }
}

export function parseSavedDocument(value: unknown): SavedDocument {
  const data = record(value)
  // Read-only v1 compatibility for existing rows/backups. Remove only when their
  // supported import/migration window ends; the repository tests cover conversion.
  // v2 prevents an older reader from silently stripping explicitly retained text.
  if (data.schema !== SAVED_DOCUMENT_SCHEMA && (data.schema !== 'islemind.saved-document.v1' || data.reviewContext !== undefined)) throw new TypeError('Unsupported saved document.')
  const createdAt = timestamp(data.createdAt)
  const updatedAt = timestamp(data.updatedAt)
  if (updatedAt < createdAt) throw new TypeError('Invalid document timestamps.')
  return {
    schema: SAVED_DOCUMENT_SCHEMA,
    id: identity(data.id),
    revision: identity(data.revision),
    ...parseDocumentDraft(data),
    createdAt,
    updatedAt,
  }
}

export function parseSavedDocuments(value: unknown): SavedDocument[] {
  if (!Array.isArray(value) || value.length > SAVED_DOCUMENT_COUNT_LIMIT) throw new TypeError('Invalid document snapshot.')
  const documents = value.map(parseSavedDocument).sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(documents.map((document) => document.id)).size !== documents.length) {
    throw new TypeError('Duplicate saved document identity.')
  }
  return documents
}

function parseOrigin(value: unknown): DocumentOrigin {
  const origin = record(value)
  if (typeof origin.messageStatus !== 'string' || !['done', 'error', 'cancelled'].includes(origin.messageStatus)) throw new TypeError('Invalid document origin status.')
  if (!Array.isArray(origin.citations) || origin.citations.length > 128) throw new TypeError('Invalid document citations.')
  if (origin.citations.reduce((total, citation) => total + text(record(citation).excerpt ?? '', DOCUMENT_BODY_LIMIT).length, 0) > DOCUMENT_BODY_LIMIT) {
    throw new TypeError('The captured citation excerpts exceed the document limit.')
  }
  return {
    conversationId: identity(origin.conversationId),
    conversationTitle: text(origin.conversationTitle, 4_000),
    messageId: identity(origin.messageId),
    messageStatus: origin.messageStatus as DocumentOrigin['messageStatus'],
    messageTimestamp: timestamp(origin.messageTimestamp),
    ...(origin.providerId === undefined ? {} : { providerId: identity(origin.providerId) }),
    ...(origin.model === undefined ? {} : { model: text(origin.model, 1_000) }),
    originalText: text(origin.originalText, DOCUMENT_BODY_LIMIT),
    citations: origin.citations.map((value) => {
      const citation = record(value)
      if (typeof citation.type !== 'string' || !['memory', 'knowledge', 'web'].includes(citation.type)) throw new TypeError('Invalid document citation kind.')
      return {
        id: identity(citation.id),
        type: citation.type as DocumentCitation['type'],
        title: text(citation.title, 4_000),
        ...(citation.excerpt === undefined ? {} : { excerpt: text(citation.excerpt, DOCUMENT_BODY_LIMIT) }),
        ...(citation.url === undefined ? {} : { url: text(citation.url, 8_192) }),
        ...(citation.documentId === undefined ? {} : { documentId: identity(citation.documentId) }),
        ...(citation.chunkId === undefined ? {} : { chunkId: identity(citation.chunkId) }),
      }
    }),
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid saved document.')
  return value as Record<string, unknown>
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new TypeError('Invalid or oversized document text.')
  return value
}

function identity(value: unknown): string {
  const id = text(value, 512)
  if (!id.trim()) throw new TypeError('Invalid document identity.')
  return id
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid document timestamp.')
  return value
}
