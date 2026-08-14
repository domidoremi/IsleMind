import type { JsonRecord, JsonValue } from '@/core'

import type {
  ExternalToolDiagnostic,
  ExternalToolExecutionResult,
  ExternalToolObservationBlock,
  ExternalToolObservationErrorCode,
  ExternalToolObservationStatus,
} from './contracts'

const OBSERVATION_OUTPUT_LIMIT = 12_000
const OBSERVATION_BLOCK_LIMIT = 64
const OBSERVATION_BLOCK_TEXT_LIMIT = 12_000
const OBSERVATION_IMAGE_DATA_TOTAL_LIMIT = 2_000_000
const OBSERVATION_URI_LIMIT = 4_096
const OBSERVATION_NAME_LIMIT = 512
const OBSERVATION_MIME_LIMIT = 128
const OBSERVATION_JSON_STRING_LIMIT = 4_096
const OBSERVATION_JSON_KEY_LIMIT = 256
const OBSERVATION_JSON_NODE_LIMIT = 2_048
const OBSERVATION_JSON_TOTAL_STRING_LIMIT = 65_536
const OBSERVATION_DIAGNOSTIC_ID_LIMIT = 512
const OBSERVATION_DIAGNOSTIC_TITLE_LIMIT = 1_024

export interface ExternalToolObservationInput {
  toolId: string
  source: string
  name: string
  ok: boolean
  status?: unknown
  output?: unknown
  blocks?: unknown
  diagnostic?: unknown
  error?: unknown
  errorCode?: unknown
  metadata?: unknown
}

/** Validates and normalizes source-specific visible results at integration ownership. */
export function normalizeExternalToolExecutionResult(
  input: ExternalToolObservationInput,
): ExternalToolExecutionResult {
  const diagnosticInput = isRecord(input.diagnostic) ? input.diagnostic : {}
  const blocks = normalizeExternalToolObservationBlocks(input.blocks)
  const visibleOutput = blocks.map((block) => block.text ?? block.uri ?? block.name ?? block.type).join('\n')
  const output = truncate(typeof input.output === 'string'
    ? input.output
    : visibleOutput || (typeof input.error === 'string' ? input.error : ''), OBSERVATION_OUTPUT_LIMIT)
  const inferredErrorCode = normalizeExternalToolObservationErrorCode(input.errorCode)
    ?? normalizeExternalToolObservationErrorCode(isRecord(diagnosticInput.metadata) ? diagnosticInput.metadata.errorCode : undefined)
    ?? inferErrorCode(input.ok, diagnosticInput.status)
  const errorCode = input.ok ? undefined : inferredErrorCode
  const status = normalizeObservationStatus(input.status, input.ok, diagnosticInput.status)
  const metadata = normalizeObservationMetadata(input, isRecord(input.metadata) ? input.metadata : {})
  return {
    summary: output,
    observation: {
      ok: input.ok,
      status,
      output,
      blocks: blocks.length ? blocks : [{ type: 'text', text: output }],
      diagnostic: normalizeDiagnostic(input, diagnosticInput, output, status, errorCode),
      ...(errorCode ? { errorCode } : {}),
      metadata,
    },
  }
}

export function normalizeExternalToolObservationBlocks(value: unknown): ExternalToolObservationBlock[] {
  if (!Array.isArray(value)) return []
  const output: ExternalToolObservationBlock[] = []
  let remainingImageData = OBSERVATION_IMAGE_DATA_TOTAL_LIMIT
  for (const entry of value.slice(0, OBSERVATION_BLOCK_LIMIT)) {
    if (!isRecord(entry)) continue
    if (entry.type !== 'text' && entry.type !== 'image' && entry.type !== 'resource') continue
    const imageData = typeof entry.data === 'string' && entry.data.length <= remainingImageData
      ? entry.data
      : typeof entry.data === 'string'
        ? ''
        : undefined
    if (imageData !== undefined) remainingImageData -= imageData.length
    output.push({
      type: entry.type,
      ...(typeof entry.text === 'string' ? { text: truncate(entry.text, OBSERVATION_BLOCK_TEXT_LIMIT) } : {}),
      ...(typeof entry.mimeType === 'string' ? { mimeType: truncate(entry.mimeType, OBSERVATION_MIME_LIMIT) } : {}),
      ...(typeof entry.uri === 'string' ? { uri: truncate(entry.uri, OBSERVATION_URI_LIMIT) } : {}),
      ...(imageData !== undefined ? { data: imageData } : {}),
      ...(typeof entry.name === 'string' ? { name: truncate(entry.name, OBSERVATION_NAME_LIMIT) } : {}),
    })
  }
  return output
}

export function normalizeExternalToolObservationErrorCode(
  value: unknown,
): ExternalToolObservationErrorCode | undefined {
  return value === 'tool_unavailable' || value === 'permission_required' || value === 'schema_invalid'
    || value === 'evidence_insufficient' || value === 'cancelled' || value === 'step_limit_reached'
    || value === 'policy_denied' || value === 'execution_failed'
    ? value
    : undefined
}

function normalizeObservationStatus(
  value: unknown,
  ok: boolean,
  diagnosticStatus: unknown,
): ExternalToolObservationStatus {
  if (ok) return 'done'
  if (value === 'error' || value === 'skipped') return value
  return diagnosticStatus === 'skipped' || diagnosticStatus === 'cancelled' ? 'skipped' : 'error'
}

function normalizeDiagnostic(
  input: ExternalToolObservationInput,
  value: Record<string, unknown>,
  output: string,
  status: ExternalToolObservationStatus,
  errorCode: ExternalToolObservationErrorCode | undefined,
): ExternalToolDiagnostic {
  return {
    id: truncate(`external-tool-${input.toolId}`, OBSERVATION_DIAGNOSTIC_ID_LIMIT),
    type: 'tool',
    title: truncate(`External tool ${input.name}`, OBSERVATION_DIAGNOSTIC_TITLE_LIMIT),
    content: truncate(typeof value.content === 'string' ? value.content : output, OBSERVATION_OUTPUT_LIMIT),
    status: input.ok
      ? 'done'
      : errorCode === 'cancelled'
        ? 'cancelled'
        : status === 'skipped'
          ? 'skipped'
          : 'error',
    ...(isFiniteNumber(value.startedAt) ? { startedAt: value.startedAt } : {}),
    ...(isFiniteNumber(value.completedAt) ? { completedAt: value.completedAt } : {}),
    metadata: normalizeObservationMetadata(input, isRecord(value.metadata) ? value.metadata : {}),
  }
}

function normalizeObservationMetadata(
  input: Pick<ExternalToolObservationInput, 'toolId' | 'source'>,
  value: Record<string, unknown>,
): JsonRecord {
  const toolId = truncate(input.toolId, OBSERVATION_JSON_STRING_LIMIT)
  const source = truncate(input.source, OBSERVATION_JSON_STRING_LIMIT)
  return {
    ...toJsonRecord(value, toolId.length + source.length),
    toolId,
    source,
  }
}

function inferErrorCode(ok: boolean, diagnosticStatus: unknown): ExternalToolObservationErrorCode | undefined {
  if (ok) return undefined
  if (diagnosticStatus === 'cancelled') return 'cancelled'
  if (diagnosticStatus === 'skipped') return 'tool_unavailable'
  return 'execution_failed'
}

function toJsonRecord(value: Record<string, unknown>, reservedStringChars = 0): JsonRecord {
  const budget = {
    nodes: OBSERVATION_JSON_NODE_LIMIT,
    stringChars: Math.max(0, OBSERVATION_JSON_TOTAL_STRING_LIMIT - reservedStringChars),
  }
  const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const [key, entry] of firstOwnEntries(value, 126)) {
    const normalized = toJsonValue(entry, 0, new WeakSet<object>(), budget)
    if (normalized !== undefined) output[truncate(key, OBSERVATION_JSON_KEY_LIMIT)] = normalized
  }
  return output
}

function toJsonValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: { nodes: number; stringChars: number },
): JsonValue | undefined {
  if (budget.nodes <= 0) return '[node-limit]'
  budget.nodes -= 1
  if (depth > 12) return '[depth-limit]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (budget.stringChars <= 0) return ''
    const normalized = truncate(value, Math.min(OBSERVATION_JSON_STRING_LIMIT, budget.stringChars))
    budget.stringChars = Math.max(0, budget.stringChars - normalized.length)
    return normalized
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (!value || typeof value !== 'object') return undefined
  if (ancestors.has(value)) return '[circular]'
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 128).map((entry) => toJsonValue(entry, depth + 1, ancestors, budget) ?? null)
    }
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    for (const [key, entry] of firstOwnEntries(value as Record<string, unknown>, 128)) {
      const normalized = toJsonValue(entry, depth + 1, ancestors, budget)
      if (normalized !== undefined) output[truncate(key, OBSERVATION_JSON_KEY_LIMIT)] = normalized
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function firstOwnEntries(value: Record<string, unknown>, limit: number): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = []
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    entries.push([key, value[key]])
    if (entries.length >= limit) break
  }
  return entries
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`
}
