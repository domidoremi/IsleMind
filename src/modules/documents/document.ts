import type { Conversation, Message } from '@/types/chatContracts'
import type { MessageCitation } from '@/types/contextContracts'

export const SAVED_DOCUMENT_SCHEMA = 'islemind.saved-document.v1' as const
export const DOCUMENT_TITLE_LIMIT = 240
export const DOCUMENT_BODY_LIMIT = 1_000_000
export const SAVED_DOCUMENT_COUNT_LIMIT = 10_000

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

export interface DocumentDraft {
  title: string
  body: string
  origin?: DocumentOrigin
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
  save(id: string, revision: string, edit: Pick<DocumentDraft, 'title' | 'body'>): Promise<SavedDocument>
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
  }
}

export function parseSavedDocument(value: unknown): SavedDocument {
  const data = record(value)
  if (data.schema !== SAVED_DOCUMENT_SCHEMA) throw new TypeError('Unsupported saved document.')
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
