import * as v from 'valibot'
import type {
  KnowledgeDocumentImportDependencies,
  KnowledgeDocumentImportInput,
  KnowledgeDocumentImportResult,
  KnowledgeDocumentImportUseCase,
} from '../contracts'

const DEFAULT_MAX_TEXT_CHARS = 20 * 1024 * 1024

const importResultSchema = v.object({
  documentId: v.string(),
  title: v.string(),
  chunkCount: v.number(),
  sourceUri: v.nullish(v.string()),
  rawPath: v.nullish(v.string()),
  contentHash: v.nullish(v.string()),
})

export class KnowledgeDocumentImportDataError extends Error {
  constructor(message = 'The knowledge document import data is invalid.') {
    super(message)
    this.name = 'KnowledgeDocumentImportDataError'
  }
}

export class KnowledgeDocumentImportCancelledError extends Error {
  constructor() {
    super('The knowledge document import was cancelled.')
    this.name = 'KnowledgeDocumentImportCancelledError'
  }
}

/**
 * Owns import-boundary validation and cancellation. Concrete extraction and
 * index synchronization remain ports so they can migrate independently.
 */
export function createKnowledgeDocumentImportUseCase(
  dependencies: KnowledgeDocumentImportDependencies,
): KnowledgeDocumentImportUseCase {
  const maxTextChars = dependencies.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS
  if (!Number.isSafeInteger(maxTextChars) || maxTextChars <= 0) {
    throw new KnowledgeDocumentImportDataError('The knowledge import text limit is invalid.')
  }

  return {
    async import(input, options) {
      throwIfAborted(options.signal)
      const normalized = normalizeInput(input, maxTextChars)
      const raw = await raceWithAbort(
        dependencies.port.import(normalized, options),
        options.signal,
      )
      return normalizeResult(raw, normalized)
    },
  }
}

function normalizeInput(
  input: KnowledgeDocumentImportInput,
  maxTextChars: number,
): KnowledgeDocumentImportInput {
  const title = normalizeRequiredText(input.title, 'document title', 512)
  const mimeType = normalizeRequiredText(input.mimeType, 'document MIME type', 256)
  if (!Number.isSafeInteger(input.size) || input.size < 0) {
    throw new KnowledgeDocumentImportDataError('The document size is invalid.')
  }
  const text = input.text.trim()
  if (!text || text.length > maxTextChars) {
    throw new KnowledgeDocumentImportDataError('The document text is invalid.')
  }
  const sourceUri = normalizeOptionalText(input.sourceUri, 'document source URI', 2_048)
  const rawPath = normalizeOptionalText(input.rawPath, 'document raw path', 2_048)
  return {
    title,
    mimeType,
    size: input.size,
    text,
    ...(sourceUri === undefined ? {} : { sourceUri }),
    ...(rawPath === undefined ? {} : { rawPath }),
  }
}

function normalizeResult(
  value: unknown,
  input: KnowledgeDocumentImportInput,
): KnowledgeDocumentImportResult {
  const parsed = v.safeParse(importResultSchema, value)
  if (!parsed.success) throw new KnowledgeDocumentImportDataError('The knowledge import port returned an invalid result.')
  const result = parsed.output
  const documentId = normalizeRequiredText(result.documentId, 'imported document id', 512)
  const title = normalizeRequiredText(result.title, 'imported document title', 512)
  if (title !== input.title || !Number.isSafeInteger(result.chunkCount) || result.chunkCount < 0) {
    throw new KnowledgeDocumentImportDataError('The knowledge import result is inconsistent.')
  }
  const sourceUri = normalizeOptionalText(result.sourceUri, 'imported document source URI', 2_048) ?? input.sourceUri
  const rawPath = normalizeOptionalText(result.rawPath, 'imported document raw path', 2_048) ?? input.rawPath
  const contentHash = normalizeOptionalText(result.contentHash, 'imported document content hash', 512)
  return {
    documentId,
    title,
    chunkCount: result.chunkCount,
    ...(sourceUri === undefined ? {} : { sourceUri }),
    ...(rawPath === undefined ? {} : { rawPath }),
    ...(contentHash === undefined ? {} : { contentHash }),
  }
}

function normalizeRequiredText(value: string, label: string, limit: number): string {
  const text = value.trim()
  if (!text || text.length > limit) throw new KnowledgeDocumentImportDataError(`The ${label} is invalid.`)
  return text
}

function normalizeOptionalText(value: string | undefined | null, label: string, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = value.trim()
  if (!text) return undefined
  if (text.length > limit) throw new KnowledgeDocumentImportDataError(`The ${label} is invalid.`)
  return text
}

function raceWithAbort<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) return Promise.reject(new KnowledgeDocumentImportCancelledError())
  return new Promise<Value>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new KnowledgeDocumentImportCancelledError())
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new KnowledgeDocumentImportCancelledError()
}
