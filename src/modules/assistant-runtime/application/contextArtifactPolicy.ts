import { redactSensitiveText, sha256Hex } from '@/core'

/**
 * Bounded, session-only payloads kept outside the model prefix. Artifacts are
 * deliberately scoped to the canonical conversation ledger: a pointer is
 * diagnostic/retrieval metadata, never an authority to read another chat.
 */
export const CONTEXT_ARTIFACT_SCHEMA = 'islemind.context-artifact.v1' as const
export const CONTEXT_ARTIFACT_POINTER_SCHEMA = 'islemind.context-pointer.v1' as const

export type ContextArtifactAuthority =
  | 'user-private'
  | 'external-public'
  | 'permissioned-tool'
  | 'conversation'
  | 'local-state'

export interface ContextArtifact {
  readonly schema: typeof CONTEXT_ARTIFACT_SCHEMA
  readonly id: string
  readonly conversationId: string
  readonly sourceMessageId?: string
  readonly authority: ContextArtifactAuthority
  readonly contentHash: string
  readonly byteLength: number
  readonly originalByteLength: number
  readonly truncated: boolean
  readonly retention: 'session'
  readonly tokenCount: number
  readonly uri: string
  readonly createdAt: number
  readonly expiresAt: number
  /** Small, redacted-adjacent preview for a model-visible pointer. */
  readonly preview: string
}

export interface ContextArtifactPointer {
  readonly schema: typeof CONTEXT_ARTIFACT_POINTER_SCHEMA
  readonly artifactId: string
  readonly conversationId: string
  readonly authority: ContextArtifactAuthority
  readonly contentHash: string
  readonly byteLength: number
  readonly originalByteLength: number
  readonly truncated: boolean
  readonly retention: 'session'
  readonly uri: string
  readonly expiresAt: number
  readonly preview: string
}

export interface ContextArtifactStore {
  put(input: { artifact: ContextArtifact; content: string }): void
  get(id: string): { artifact: ContextArtifact; content: string } | undefined
  delete(id: string): void
  prune(now: number): void
}

export interface ContextArtifactPolicyDependencies {
  readonly store: ContextArtifactStore
  readonly estimateTextTokens: (text: string) => number
  readonly now: () => number
  readonly id?: () => string
}

export interface CreateContextArtifactInput {
  readonly conversationId: string
  readonly content: string
  readonly authority: ContextArtifactAuthority
  readonly sourceMessageId?: string
  readonly ttlMs?: number
  readonly previewChars?: number
}

export interface ResolveContextArtifactInput {
  readonly pointer: ContextArtifactPointer
  readonly conversationId: string
  readonly authority?: ContextArtifactAuthority
}

export interface ContextArtifactPolicy {
  createContextArtifact(input: CreateContextArtifactInput): ContextArtifactPointer
  materializeContextPointer(pointer: ContextArtifactPointer): string
  resolveContextArtifact(input: ResolveContextArtifactInput): ContextArtifact | undefined
  readContextArtifact(input: ResolveContextArtifactInput): string | undefined
}

const DEFAULT_TTL_MS = 30 * 60 * 1000
const MAX_PREVIEW_CHARS = 320
const MAX_ARTIFACT_BYTES = 512 * 1024

export const CONTEXT_ARTIFACT_DEFAULT_TTL_MS = DEFAULT_TTL_MS
export const CONTEXT_ARTIFACT_MAX_PREVIEW_CHARS = MAX_PREVIEW_CHARS
export const CONTEXT_ARTIFACT_MAX_BYTES = MAX_ARTIFACT_BYTES

export function createContextArtifactPolicy(
  dependencies: ContextArtifactPolicyDependencies,
): ContextArtifactPolicy {
  let sequence = 0
  const nextId = () => dependencies.id?.() ?? `context-artifact-${dependencies.now()}-${++sequence}`

  function createContextArtifact(input: CreateContextArtifactInput): ContextArtifactPointer {
    const now = dependencies.now()
    dependencies.store.prune(now)
    const conversationId = requireIdentity(input.conversationId, 'conversationId')
    const authority = requireAuthority(input.authority)
    const content = boundedContent(input.content)
    const artifact: ContextArtifact = Object.freeze({
      schema: CONTEXT_ARTIFACT_SCHEMA,
      id: requireIdentity(nextId(), 'artifact id'),
      conversationId,
      ...(input.sourceMessageId ? { sourceMessageId: requireIdentity(input.sourceMessageId, 'sourceMessageId') } : {}),
      authority,
      contentHash: artifactContentHash(content),
      byteLength: utf8ByteLength(content),
      originalByteLength: utf8ByteLength(input.content),
      truncated: content !== input.content,
      retention: 'session',
      tokenCount: Math.max(0, Math.floor(dependencies.estimateTextTokens(content))),
      uri: '',
      createdAt: now,
      expiresAt: now + boundedTtl(input.ttlMs),
      preview: toPreview(content, input.previewChars),
    })
    const finalized: ContextArtifact = Object.freeze({
      ...artifact,
      uri: `islemind://context-artifacts/${encodeURIComponent(artifact.id)}`,
    })
    dependencies.store.put({ artifact: finalized, content })
    return Object.freeze({
      schema: CONTEXT_ARTIFACT_POINTER_SCHEMA,
      artifactId: finalized.id,
      conversationId: finalized.conversationId,
      authority: finalized.authority,
      contentHash: finalized.contentHash,
      byteLength: finalized.byteLength,
      originalByteLength: finalized.originalByteLength,
      truncated: finalized.truncated,
      retention: finalized.retention,
      uri: finalized.uri,
      expiresAt: finalized.expiresAt,
      preview: finalized.preview,
    })
  }

  function materializeContextPointer(pointer: ContextArtifactPointer): string {
    return [
      '[context artifact]',
      `uri: ${pointer.uri}`,
      `hash: ${pointer.contentHash}`,
      `expiresAt: ${pointer.expiresAt}`,
      'retention: session-only, evictable; not a model-readable URI',
      `storedBytes: ${pointer.byteLength}/${pointer.originalByteLength}${pointer.truncated ? ' (truncated)' : ''}`,
      `preview: ${pointer.preview}`,
    ].join('\n')
  }

  function resolveContextArtifact(input: ResolveContextArtifactInput): ContextArtifact | undefined {
    const now = dependencies.now()
    dependencies.store.prune(now)
    const pointer = input.pointer
    if (pointer.schema !== CONTEXT_ARTIFACT_POINTER_SCHEMA) return undefined
    if (pointer.conversationId !== input.conversationId) return undefined
    if (input.authority !== undefined && pointer.authority !== input.authority) return undefined
    if (pointer.expiresAt <= now) return undefined
    const stored = dependencies.store.get(pointer.artifactId)
    if (!stored || stored.artifact.expiresAt <= now) return undefined
    if (
      stored.artifact.conversationId !== input.conversationId
      || stored.artifact.authority !== pointer.authority
      || stored.artifact.contentHash !== pointer.contentHash
      || stored.artifact.uri !== pointer.uri
      || stored.artifact.expiresAt !== pointer.expiresAt
      || stored.artifact.truncated !== pointer.truncated
      || stored.artifact.retention !== pointer.retention
      || stored.artifact.byteLength !== pointer.byteLength
      || stored.artifact.originalByteLength !== pointer.originalByteLength
      || artifactContentHash(stored.content) !== stored.artifact.contentHash
    ) return undefined
    return stored.artifact
  }

  function readContextArtifact(input: ResolveContextArtifactInput): string | undefined {
    const artifact = resolveContextArtifact(input)
    if (!artifact) return undefined
    return dependencies.store.get(artifact.id)?.content
  }

  return { createContextArtifact, materializeContextPointer, resolveContextArtifact, readContextArtifact }
}

function artifactContentHash(content: string): string {
  // Integrity requires exact bytes, not NFKC/whitespace-normalized equivalence.
  return `sha256-exact-v1-${sha256Hex(content)}`
}

/** A deterministic bounded store for mobile sessions and tests. */
export function createInMemoryContextArtifactStore(options: {
  readonly maxEntries?: number
  readonly maxBytes?: number
} = {}): ContextArtifactStore {
  const entries = new Map<string, { artifact: ContextArtifact; content: string }>()
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 64))
  const maxBytes = Math.max(1_024, Math.floor(options.maxBytes ?? 4 * 1024 * 1024))

  function totalBytes(): number {
    return Array.from(entries.values()).reduce((sum, entry) => sum + entry.artifact.byteLength, 0)
  }

  function evict(): void {
    while (entries.size > maxEntries || totalBytes() > maxBytes) {
      const oldest = entries.keys().next().value as string | undefined
      if (!oldest) return
      entries.delete(oldest)
    }
  }

  return {
    put(entry) {
      entries.set(entry.artifact.id, Object.freeze({ artifact: entry.artifact, content: entry.content }))
      evict()
    },
    get(id) {
      const entry = entries.get(id)
      return entry ? { artifact: entry.artifact, content: entry.content } : undefined
    },
    delete(id) {
      entries.delete(id)
    },
    prune(now) {
      for (const [id, entry] of entries) {
        if (entry.artifact.expiresAt <= now) entries.delete(id)
      }
    },
  }
}

function requireIdentity(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`Invalid context artifact ${field}.`)
  }
  return normalized
}

function requireAuthority(value: ContextArtifactAuthority): ContextArtifactAuthority {
  if (
    value !== 'user-private'
    && value !== 'external-public'
    && value !== 'permissioned-tool'
    && value !== 'conversation'
    && value !== 'local-state'
  ) throw new TypeError('Invalid context artifact authority.')
  return value
}

function boundedContent(value: string): string {
  const source = String(value ?? '')
  if (utf8ByteLength(source) <= MAX_ARTIFACT_BYTES) return source
  let bytes = 0
  let end = 0
  for (const codePoint of source) {
    const nextBytes = utf8ByteLength(codePoint)
    if (bytes + nextBytes > MAX_ARTIFACT_BYTES) break
    bytes += nextBytes
    end += codePoint.length
  }
  return source.slice(0, end)
}

function boundedTtl(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_TTL_MS
  return Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Math.floor(value)))
}

function toPreview(value: string, previewChars: number | undefined): string {
  const limit = Math.max(32, Math.min(MAX_PREVIEW_CHARS, Math.floor(previewChars ?? 160)))
  // A preview is model-visible metadata.  Redact common credentials before
  // storing it so a pointer can safely appear in traces or a compacted prompt.
  const normalized = redactSensitiveText(value.replace(/\s+/g, ' ').trim())
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(1, limit - 3))}...`
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      bytes += next >= 0xdc00 && next <= 0xdfff ? (index += 1, 4) : 3
    } else bytes += 3
  }
  return bytes
}
