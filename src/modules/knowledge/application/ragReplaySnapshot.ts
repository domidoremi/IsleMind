export const KNOWLEDGE_RAG_REPLAY_SNAPSHOT_SCHEMA = 'islemind.knowledge-rag-replay-snapshot.v1'
export const KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST = {
  id: 'rag:context_pack',
  source: 'rag',
  name: 'rag.context_pack',
  description: 'Plan, retrieve, rerank, pack, and evaluate local RAG context with citations.',
  permission: 'read-only',
  enabled: true,
  requiresRuntimeContext: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      profile: { type: 'string', enum: ['fast', 'balanced', 'deep', 'offline'] },
      profileReason: { type: 'string' },
    },
    required: ['query'],
  },
} as const

const MAX_QUERY_CHARS = 4_096
const MAX_PROFILE_REASON_CHARS = 2_048
const MAX_CONTEXT_PROMPT_CHARS = 48_000
const MAX_CITATIONS = 64
const MAX_MESSAGES = 32
const MAX_SNAPSHOT_JSON_CHARS = 128_000
const SNAPSHOT_KEYS = new Set([
  'schema',
  'createdAt',
  'query',
  'profile',
  'profileSource',
  'profileReason',
  'sourceCount',
  'citationCount',
  'confidence',
  'missingEvidence',
  'ragTraceCount',
  'outputCharLimit',
  'visibleOutput',
  'warnings',
  'fallbackReasons',
  'contextPrompt',
  'citations',
])
const CITATION_KEYS = new Set([
  'id',
  'label',
  'type',
  'title',
  'excerpt',
  'url',
  'score',
  'rerankScore',
])

export type KnowledgeRagReplayProfile = 'fast' | 'balanced' | 'deep' | 'offline'
export type KnowledgeRagReplayProfileSource = 'settings' | 'tool-request' | 'rag-mode'
export type KnowledgeRagReplayCitationType = 'memory' | 'knowledge' | 'web'

export interface KnowledgeRagReplayCitation {
  id: string
  label: string
  type: KnowledgeRagReplayCitationType
  title: string
  excerpt?: string
  url?: string
  score?: number
  rerankScore?: number
}

export interface KnowledgeRagReplaySnapshot {
  schema: typeof KNOWLEDGE_RAG_REPLAY_SNAPSHOT_SCHEMA
  createdAt: number
  query: string
  profile: KnowledgeRagReplayProfile
  profileSource: KnowledgeRagReplayProfileSource
  profileReason?: string
  sourceCount: number
  citationCount: number
  confidence: number
  missingEvidence: boolean
  ragTraceCount: number
  outputCharLimit: number
  visibleOutput: string
  warnings: readonly string[]
  fallbackReasons: readonly string[]
  contextPrompt: string
  citations: readonly KnowledgeRagReplayCitation[]
}

export type KnowledgeRagReplaySnapshotInput = Omit<KnowledgeRagReplaySnapshot, 'schema'>

export function createKnowledgeRagReplaySnapshot(
  input: KnowledgeRagReplaySnapshotInput,
): KnowledgeRagReplaySnapshot | undefined {
  return parseKnowledgeRagReplaySnapshot({
    schema: KNOWLEDGE_RAG_REPLAY_SNAPSHOT_SCHEMA,
    ...input,
  })
}

export function createKnowledgeRagReplaySnapshotFromContextPack(
  value: unknown,
  createdAt: number,
  options: {
    outputCharLimit: number
    sanitizeOutput?: (output: string) => string
  },
): KnowledgeRagReplaySnapshot | undefined {
  if (!isRecord(value) || !isRecord(value.plan) || !isRecord(value.quality) ||
    !Array.isArray(value.sources) || !Array.isArray(value.citations) || !Array.isArray(value.trace)) return undefined
  const citations = value.citations.map(toReplayCitation)
  if (citations.some((citation) => !citation)) return undefined
  const input = {
    createdAt,
    query: value.plan.query as string,
    profile: value.plan.profile as KnowledgeRagReplayProfile,
    profileSource: value.plan.profileSource as KnowledgeRagReplayProfileSource,
    ...(value.plan.profileReason === undefined ? {} : { profileReason: value.plan.profileReason as string }),
    sourceCount: value.sources.length,
    citationCount: citations.length,
    confidence: value.quality.confidence as number,
    missingEvidence: value.quality.missingEvidence as boolean,
    ragTraceCount: value.trace.length,
    outputCharLimit: normalizeOutputCharLimit(options.outputCharLimit),
    warnings: value.quality.warnings as string[],
    fallbackReasons: (value.quality.fallbackReasons ?? []) as string[],
    contextPrompt: value.contextPrompt as string,
    citations: citations as KnowledgeRagReplayCitation[],
  }
  const canonicalOutput = formatReplayProjection(input)
  const sanitizedOutput = options.sanitizeOutput ? options.sanitizeOutput(canonicalOutput) : canonicalOutput
  return createKnowledgeRagReplaySnapshot({
    ...input,
    visibleOutput: clampVisibleOutput(sanitizedOutput, input.outputCharLimit),
  })
}

/** Validates untrusted persisted replay data and returns a detached snapshot. */
export function parseKnowledgeRagReplaySnapshot(value: unknown): KnowledgeRagReplaySnapshot | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, SNAPSHOT_KEYS) || value.schema !== KNOWLEDGE_RAG_REPLAY_SNAPSHOT_SCHEMA) return undefined
  if (!isSafeTimestamp(value.createdAt)) return undefined
  const query = boundedRequiredText(value.query, MAX_QUERY_CHARS)
  if (!query || !isReplayProfile(value.profile) || !isReplayProfileSource(value.profileSource)) return undefined
  const profileReason = boundedOptionalText(value.profileReason, MAX_PROFILE_REASON_CHARS)
  if (value.profileReason !== undefined && profileReason === undefined) return undefined
  if (!isBoundedCount(value.sourceCount) || !isBoundedCount(value.citationCount)) return undefined
  if (!isConfidence(value.confidence) || typeof value.missingEvidence !== 'boolean' || !isBoundedCount(value.ragTraceCount)) return undefined
  if (!isNormalizedOutputCharLimit(value.outputCharLimit)) return undefined
  const visibleOutput = boundedText(value.visibleOutput, value.outputCharLimit)
  if (visibleOutput === undefined) return undefined
  const warnings = parseTextList(value.warnings, MAX_MESSAGES, 512)
  const fallbackReasons = parseTextList(value.fallbackReasons, MAX_MESSAGES, 256)
  const contextPrompt = boundedText(value.contextPrompt, MAX_CONTEXT_PROMPT_CHARS)
  if (!warnings || !fallbackReasons || contextPrompt === undefined || !Array.isArray(value.citations)) return undefined
  if (value.citations.length > MAX_CITATIONS || value.citationCount !== value.citations.length) return undefined

  const citations: KnowledgeRagReplayCitation[] = []
  const citationIds = new Set<string>()
  for (const candidate of value.citations) {
    const citation = parseCitation(candidate)
    if (!citation || citationIds.has(citation.id)) return undefined
    citationIds.add(citation.id)
    citations.push(citation)
  }

  const snapshot: KnowledgeRagReplaySnapshot = {
    schema: KNOWLEDGE_RAG_REPLAY_SNAPSHOT_SCHEMA,
    createdAt: value.createdAt,
    query,
    profile: value.profile,
    profileSource: value.profileSource,
    ...(profileReason ? { profileReason } : {}),
    sourceCount: value.sourceCount,
    citationCount: value.citationCount,
    confidence: value.confidence,
    missingEvidence: value.missingEvidence,
    ragTraceCount: value.ragTraceCount,
    outputCharLimit: value.outputCharLimit,
    visibleOutput,
    warnings,
    fallbackReasons,
    contextPrompt,
    citations,
  }
  return JSON.stringify(snapshot).length <= MAX_SNAPSHOT_JSON_CHARS ? snapshot : undefined
}

function toReplayCitation(value: unknown): KnowledgeRagReplayCitation | undefined {
  if (!isRecord(value)) return undefined
  return parseCitation({
    id: value.id,
    label: value.label,
    type: value.type,
    title: value.title,
    ...(value.excerpt === undefined ? {} : { excerpt: value.excerpt }),
    ...(value.url === undefined ? {} : { url: value.url }),
    ...(value.score === undefined ? {} : { score: value.score }),
    ...(value.rerankScore === undefined ? {} : { rerankScore: value.rerankScore }),
  })
}

/**
 * With no limit, rebuilds the exact valid legacy observation JSON projection
 * deterministically for durable replay. A supplied limit mirrors the legacy
 * visible-output clamp, including its non-JSON truncation marker; that bounded
 * display form must not be persisted in place of the validated snapshot.
 */
export function formatKnowledgeRagReplayOutput(
  snapshot: KnowledgeRagReplaySnapshot,
  outputCharLimit?: number,
): string | undefined {
  const validated = parseKnowledgeRagReplaySnapshot(snapshot)
  if (!validated) return undefined
  const output = formatReplayProjection(validated)
  if (outputCharLimit === undefined) return output
  if (!Number.isFinite(outputCharLimit)) return undefined
  return clampVisibleOutput(output, normalizeOutputCharLimit(outputCharLimit))
}

/** Returns the exact sanitized and bounded output captured by the original run. */
export function replayKnowledgeRagSnapshotOutput(snapshot: KnowledgeRagReplaySnapshot): string | undefined {
  return parseKnowledgeRagReplaySnapshot(snapshot)?.visibleOutput
}

export function knowledgeRagReplaySnapshotChecksum(snapshot: KnowledgeRagReplaySnapshot): string | undefined {
  const validated = parseKnowledgeRagReplaySnapshot(snapshot)
  if (!validated) return undefined
  const value = JSON.stringify(validated)
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function formatReplayProjection(snapshot: Omit<KnowledgeRagReplaySnapshot, 'schema' | 'createdAt' | 'ragTraceCount' | 'outputCharLimit' | 'visibleOutput'>): string {
  return JSON.stringify({
    query: snapshot.query,
    profile: snapshot.profile,
    profileSource: snapshot.profileSource,
    profileReason: snapshot.profileReason,
    sourceCount: snapshot.sourceCount,
    citationCount: snapshot.citationCount,
    confidence: snapshot.confidence,
    missingEvidence: snapshot.missingEvidence,
    warnings: snapshot.warnings,
    fallbackReasons: snapshot.fallbackReasons,
    contextPrompt: snapshot.contextPrompt,
    citations: snapshot.citations.map((citation) => ({ ...citation })),
  }, null, 2)
}

function normalizeOutputCharLimit(value: number): number {
  return Math.max(512, Math.min(12_000, Math.trunc(value)))
}

function isNormalizedOutputCharLimit(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 512 && (value as number) <= 12_000
}

function clampVisibleOutput(output: string, limit: number): string {
  if (output.length <= limit) return output
  return `${output.slice(0, Math.max(0, limit - 32)).trimEnd()}\n[output truncated]`
}

function parseCitation(value: unknown): KnowledgeRagReplayCitation | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, CITATION_KEYS)) return undefined
  const id = boundedRequiredText(value.id, 512)
  const label = boundedRequiredText(value.label, 512)
  const title = boundedRequiredText(value.title, 512)
  if (!id || !label || !title || !isCitationType(value.type)) return undefined
  const excerpt = boundedOptionalText(value.excerpt, 1_200)
  const url = boundedOptionalText(value.url, 2_048)
  if ((value.excerpt !== undefined && excerpt === undefined) || (value.url !== undefined && url === undefined)) return undefined
  const score = optionalFiniteNumber(value.score)
  const rerankScore = optionalFiniteNumber(value.rerankScore)
  if ((value.score !== undefined && score === undefined) || (value.rerankScore !== undefined && rerankScore === undefined)) return undefined
  return {
    id,
    label,
    type: value.type,
    title,
    ...(excerpt ? { excerpt } : {}),
    ...(url ? { url } : {}),
    ...(score === undefined ? {} : { score }),
    ...(rerankScore === undefined ? {} : { rerankScore }),
  }
}

function parseTextList(value: unknown, maxItems: number, maxChars: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined
  const result: string[] = []
  for (const item of value) {
    const text = boundedRequiredText(item, maxChars)
    if (!text) return undefined
    result.push(text)
  }
  return result
}

function boundedRequiredText(value: unknown, maxChars: number): string | undefined {
  const text = boundedText(value, maxChars)
  return text?.trim() ? text : undefined
}

function boundedOptionalText(value: unknown, maxChars: number): string | undefined {
  if (value === undefined) return undefined
  return boundedRequiredText(value, maxChars)
}

function boundedText(value: unknown, maxChars: number): string | undefined {
  return typeof value === 'string' && value.length <= maxChars ? value : undefined
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isBoundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000
}

function isSafeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isReplayProfile(value: unknown): value is KnowledgeRagReplayProfile {
  return value === 'fast' || value === 'balanced' || value === 'deep' || value === 'offline'
}

function isReplayProfileSource(value: unknown): value is KnowledgeRagReplayProfileSource {
  return value === 'settings' || value === 'tool-request' || value === 'rag-mode'
}

function isCitationType(value: unknown): value is KnowledgeRagReplayCitationType {
  return value === 'memory' || value === 'knowledge' || value === 'web'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}
