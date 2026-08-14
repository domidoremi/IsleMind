import {
  BuiltInCapabilityPolicyError,
  type BuiltInWorkspaceFileReadPort,
} from '@/modules/integrations'
import type {
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  KnowledgeDocumentRepository,
} from '@/modules/knowledge'

const KNOWLEDGE_WORKSPACE_SCOPE_ID = 'knowledge-imports-v1'
const KNOWLEDGE_VIRTUAL_DIRECTORY = 'knowledge'
const KNOWLEDGE_VIRTUAL_EXTENSION = '.txt'

export interface KnowledgeWorkspaceFileReadPortDependencies {
  /** Optional only for composition tests; production resolves the bootstrap repository lazily. */
  repository?: Pick<KnowledgeDocumentRepository, 'listDocuments' | 'listChunks'>
}

/**
 * Projects only ready, durably imported Knowledge documents into a read-only
 * virtual workspace. It never exposes picker caches, source URIs, or database
 * paths, and intentionally does not implement the atomic write port.
 */
export function createKnowledgeWorkspaceFileReadPort(
  dependencies: KnowledgeWorkspaceFileReadPortDependencies = {},
): BuiltInWorkspaceFileReadPort {
  const resolveRepository: () => Promise<Pick<KnowledgeDocumentRepository, 'listDocuments' | 'listChunks'>> = dependencies.repository
    ? async () => dependencies.repository!
    : async () => (await import('@/bootstrap/knowledgeRepository')).knowledgeRepository

  return {
    workspaceScopeId: KNOWLEDGE_WORKSPACE_SCOPE_ID,
    async inspect(relativePath, options) {
      const documentId = parseKnowledgeVirtualPath(relativePath)
      const repository = await resolveRepository()
      throwIfAborted(options.signal)
      const document = await findReadyDocument(repository, documentId, options.signal)
      if (!document) return undefined
      const read = await readKnowledgeDocument(repository, document, relativePath, options.signal)
      return omitText(read)
    },
    async readText(relativePath, options) {
      const documentId = parseKnowledgeVirtualPath(relativePath)
      assertMaxBytes(options.maxBytes)
      const repository = await resolveRepository()
      throwIfAborted(options.signal)
      const document = await findReadyDocument(repository, documentId, options.signal)
      if (!document) {
        throw new BuiltInCapabilityPolicyError('execution_failed', 'The requested imported knowledge document is unavailable.')
      }
      const read = await readKnowledgeDocument(repository, document, relativePath, options.signal)
      if (read.byteLength > options.maxBytes) {
        throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The imported knowledge document exceeds the requested byte limit.')
      }
      return read
    },
  }
}

async function findReadyDocument(
  repository: Pick<KnowledgeDocumentRepository, 'listDocuments'>,
  documentId: string,
  signal: AbortSignal,
): Promise<KnowledgeDocumentRecord | undefined> {
  const documents = await repository.listDocuments({ signal })
  throwIfAborted(signal)
  return documents.find((document) =>
    document.id === documentId &&
    document.status === 'ready' &&
    isSafeContentHash(document.contentHash),
  )
}

async function readKnowledgeDocument(
  repository: Pick<KnowledgeDocumentRepository, 'listChunks'>,
  document: KnowledgeDocumentRecord,
  relativePath: string,
  signal: AbortSignal,
): Promise<{ relativePath: string; revision: string; byteLength: number; mimeType: string; text: string }> {
  const chunks = await repository.listChunks(document.id, { signal })
  throwIfAborted(signal)
  const ordered = validateOrderedDocumentChunks(document, chunks)
  const text = ordered.map((chunk) => chunk.content).join('\n\n')
  const byteLength = new TextEncoder().encode(text).byteLength
  if (!Number.isSafeInteger(byteLength)) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The imported knowledge document has an invalid byte length.')
  }
  return {
    relativePath,
    revision: normalizeContentHash(document.contentHash),
    byteLength,
    mimeType: 'text/plain',
    text,
  }
}

function validateOrderedDocumentChunks(
  document: KnowledgeDocumentRecord,
  chunks: readonly KnowledgeChunkRecord[],
): KnowledgeChunkRecord[] {
  if (chunks.length !== document.chunkCount || !Number.isSafeInteger(document.chunkCount) || document.chunkCount <= 0) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The imported knowledge document chunks are incomplete.')
  }
  const ordered = [...chunks].sort((left, right) => left.ordinal - right.ordinal)
  for (let ordinal = 0; ordinal < ordered.length; ordinal += 1) {
    const chunk = ordered[ordinal]
    if (
      chunk.documentId !== document.id ||
      chunk.ordinal !== ordinal ||
      typeof chunk.content !== 'string' ||
      !chunk.content ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(chunk.content)
    ) {
      throw new BuiltInCapabilityPolicyError('execution_failed', 'The imported knowledge document contains invalid chunk data.')
    }
  }
  return ordered
}

function parseKnowledgeVirtualPath(relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length > 512 || relativePath.trim() !== relativePath) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The path is outside the imported knowledge workspace.')
  }
  const prefix = `${KNOWLEDGE_VIRTUAL_DIRECTORY}/`
  if (!relativePath.startsWith(prefix) || !relativePath.endsWith(KNOWLEDGE_VIRTUAL_EXTENSION)) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The path is outside the imported knowledge workspace.')
  }
  const encodedId = relativePath.slice(prefix.length, -KNOWLEDGE_VIRTUAL_EXTENSION.length)
  if (!encodedId || encodedId.includes('/') || encodedId.includes('\\') || /%(?:2e|2f|5c)/i.test(encodedId)) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The path is outside the imported knowledge workspace.')
  }
  try {
    const documentId = decodeURIComponent(encodedId)
    if (
      !documentId ||
      documentId === '.' ||
      documentId === '..' ||
      documentId.includes('/') ||
      documentId.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(documentId) ||
      encodeURIComponent(documentId) !== encodedId
    ) throw new Error('non-canonical virtual path')
    return documentId
  } catch {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The path is outside the imported knowledge workspace.')
  }
}

function isSafeContentHash(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && /^[A-Za-z0-9._:-]{1,256}$/.test(value)
}

function normalizeContentHash(value: string | undefined): string {
  if (!isSafeContentHash(value)) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The imported knowledge document has no valid content revision.')
  }
  return value.padStart(8, '0')
}

function assertMaxBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The requested byte limit is invalid.')
  }
}

function omitText(input: { relativePath: string; revision: string; byteLength: number; mimeType: string; text: string }) {
  const { text: _text, ...info } = input
  return info
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Knowledge workspace file reading was cancelled.')
  error.name = 'AbortError'
  throw error
}
