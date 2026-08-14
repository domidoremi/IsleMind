import type { JsonRecord } from '@/core'

import type {
  ExternalToolExecutionResult,
  ExternalToolObservationBlock,
  ExternalToolObservationErrorCode,
  ExternalToolObservationStatus,
  ToolAdapter,
  ToolDefinition,
  ToolRequest,
} from './contracts'
import {
  normalizeExternalToolExecutionResult,
  normalizeExternalToolObservationErrorCode,
} from './externalToolObservation'
import type { McpDiscoveredTool, McpToolPermission } from './mcpProtocol'

const MCP_CONTENT_BLOCK_LIMIT = 64
const MCP_BLOCK_TEXT_LIMIT = 12_000
const MCP_IMAGE_DATA_TOTAL_LIMIT = 2_000_000
const MCP_URI_LIMIT = 4_096
const MCP_NAME_LIMIT = 512
const MCP_MIME_LIMIT = 128
const MCP_OUTPUT_LIMIT = 12_000
const MCP_DIAGNOSTIC_ID_LIMIT = 512
const MCP_DIAGNOSTIC_TITLE_LIMIT = 1_024
const MCP_JSON_NODE_LIMIT = 2_048
const MCP_JSON_DEPTH_LIMIT = 12
const MCP_JSON_COLLECTION_LIMIT = 128
const MCP_JSON_STRING_LIMIT = 4_096
const MCP_JSON_KEY_LIMIT = 256
const MCP_TOOL_CALL_TRACE_CONTRACT = 'islemind.agent.tool-call-trace.v1'

const MCP_SECRET_PATTERNS: RegExp[] = [
  /\b(?:proxy-)?authorization\s*[:=]\s*["']?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}["']?(?=$|[^A-Za-z0-9._~+/=-])/gi,
  /(api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]\s*["']?[^"'\s,}]+/gi,
  /\b(sk|tp)-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
]

const SAFE_TOKEN_METADATA_KEYS = new Set([
  'estimatedtokens',
  'inputtoken',
  'inputtokens',
  'maxtokens',
  'outputtoken',
  'outputtokens',
  'tokencount',
  'tokencounts',
  'tokenbudget',
  'tokenlimit',
])

export type McpToolContentBlock = ExternalToolObservationBlock
export type McpToolObservationSource = 'mcp' | 'builtin'

export interface McpToolClient {
  callTool(input: {
    serverId: string
    toolName: string
    arguments: JsonRecord
  }, options: { signal: AbortSignal }): Promise<unknown>
}

export interface McpToolAdapter extends ToolAdapter {
  execute(request: ToolRequest, options: { signal: AbortSignal }): Promise<ExternalToolExecutionResult>
}

export interface McpToolAdapterContext {
  connectionStatus?: string
  startedAt?: number
}

export interface McpToolExecutionIdentity {
  serverId: string
  name: string
  permission?: McpToolPermission
}

export interface NormalizeMcpToolExecutionResultInput {
  tool: McpToolExecutionIdentity
  source: McpToolObservationSource
  connectionStatus?: string
  ok: boolean
  status?: unknown
  output?: unknown
  blocks?: unknown
  diagnostic?: unknown
  error?: unknown
  errorCode?: unknown
  metadata?: unknown
  startedAt?: number
  completedAt?: number
}

/** Creates the source-specific adapter without granting it a task lifecycle. */
export function createMcpToolAdapter(
  tool: McpDiscoveredTool,
  client: McpToolClient,
  context: McpToolAdapterContext = {},
): McpToolAdapter {
  if (!tool.enabled) throw new Error(`MCP tool ${tool.name} is disabled.`)
  if (!isCanonicalMcpIdentityComponent(tool.serverId) || !isCanonicalMcpIdentityComponent(tool.name)) {
    throw new Error('MCP tools require canonical server and tool identities.')
  }
  const definition: ToolDefinition = {
    id: `mcp:${tool.serverId}:${tool.name}`,
    source: 'mcp',
    capabilityScope: [
      `server:${tool.serverId}`,
      `tool:${tool.name}`,
      `permission:${tool.permission}`,
    ],
    requiresConfirmation: tool.permission === 'destructive',
  }
  return {
    definition,
    async execute(request, options) {
      const startedAt = context.startedAt ?? Date.now()
      const payload = await client.callTool({
        serverId: tool.serverId,
        toolName: tool.name,
        arguments: request.arguments,
      }, options)
      return normalizeMcpToolExecutionResult({
        tool,
        source: 'mcp',
        connectionStatus: context.connectionStatus,
        ok: true,
        status: 'done',
        blocks: payload,
        startedAt,
        completedAt: Date.now(),
      })
    },
  }
}

/**
 * Owns the bounded, redacted MCP observation shape. Callers may add transport
 * and admission semantics, but raw remote or built-in output must cross this
 * boundary before it is persisted or projected to Chat/Agent/Tavern.
 */
export function normalizeMcpToolExecutionResult(
  input: NormalizeMcpToolExecutionResultInput,
): ExternalToolExecutionResult {
  const diagnosticInput = isRecord(input.diagnostic) ? input.diagnostic : {}
  const source = input.source
  const safeServerId = sanitizeMcpText(input.tool.serverId, MCP_JSON_STRING_LIMIT)
  const safeToolName = sanitizeMcpText(input.tool.name, MCP_JSON_STRING_LIMIT)
  const safeToolId = `${source}:${safeServerId}:${safeToolName}`
  const startedAt = finiteNumber(input.startedAt)
    ?? finiteNumber(diagnosticInput.startedAt)
    ?? Date.now()
  const completedAt = finiteNumber(input.completedAt)
    ?? finiteNumber(diagnosticInput.completedAt)
    ?? Date.now()
  const blocks = normalizeMcpToolContent(input.blocks)
  const visibleOutput = summarizeMcpToolContent(blocks)
  const output = sanitizeMcpText(
    typeof input.output === 'string'
      ? input.output
      : visibleOutput || (typeof input.error === 'string' ? input.error : ''),
    MCP_OUTPUT_LIMIT,
  )
  const errorCode = resolveMcpErrorCode(input, diagnosticInput)
  const status = resolveMcpObservationStatus(input.ok, input.status, diagnosticInput.status)
  const diagnosticStatus = resolveMcpDiagnosticStatus(input.ok, status, errorCode, diagnosticInput.status)
  const canonicalMetadata: Record<string, unknown> = {
    toolCallContract: MCP_TOOL_CALL_TRACE_CONTRACT,
    toolCallMode: 'mcp-runtime',
    toolCallSource: source,
    source,
    toolName: safeToolName,
    toolId: safeToolId,
    serverId: safeServerId,
    ...(input.tool.permission ? { permission: input.tool.permission } : {}),
    ...(typeof input.connectionStatus === 'string'
      ? { connectionStatus: sanitizeMcpText(input.connectionStatus, 160) }
      : {}),
    toolCallStatus: status,
    ...(errorCode ? { errorCode } : {}),
    ...(errorCode === 'cancelled' ? { status: 'cancelled', failureCode: 'cancelled' } : {}),
  }
  const metadata = sanitizeMcpMetadata({
    ...(isRecord(diagnosticInput.metadata) ? diagnosticInput.metadata : {}),
    ...(isRecord(input.metadata) ? input.metadata : {}),
    ...canonicalMetadata,
  })
  const diagnosticId = typeof diagnosticInput.id === 'string'
    ? sanitizeMcpTraceId(diagnosticInput.id)
    : sanitizeMcpTraceId(`mcp-${safeServerId}-${safeToolName}-${startedAt}`)
  const diagnosticTitle = sanitizeMcpText(
    typeof diagnosticInput.title === 'string' ? diagnosticInput.title : `MCP ${safeToolName}`,
    MCP_DIAGNOSTIC_TITLE_LIMIT,
  )
  const diagnosticContent = sanitizeMcpText(
    typeof diagnosticInput.content === 'string' ? diagnosticInput.content : output,
    MCP_OUTPUT_LIMIT,
  )
  const normalized = normalizeExternalToolExecutionResult({
    toolId: safeToolId,
    source,
    name: safeToolName,
    ok: input.ok,
    status,
    output,
    blocks,
    diagnostic: {
      status: diagnosticStatus,
      startedAt,
      completedAt,
      metadata,
    },
    error: typeof input.error === 'string' ? sanitizeMcpText(input.error, MCP_OUTPUT_LIMIT) : undefined,
    errorCode,
    metadata,
  })
  return {
    ...normalized,
    observation: {
      ...normalized.observation,
      diagnostic: {
        ...normalized.observation.diagnostic,
        id: diagnosticId,
        title: diagnosticTitle,
        content: diagnosticContent,
        status: diagnosticStatus,
        startedAt,
        completedAt,
      },
    },
  }
}

function isCanonicalMcpIdentityComponent(value: string): boolean {
  return Boolean(value) && value === value.trim() && !value.includes(':') && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Normalizes and redacts the untrusted `tools/call` content payload at MCP ownership. */
export function normalizeMcpToolContent(value: unknown): McpToolContentBlock[] {
  if (!Array.isArray(value)) {
    return typeof value === 'string'
      ? [{ type: 'text', text: sanitizeMcpText(value, MCP_BLOCK_TEXT_LIMIT) }]
      : []
  }
  const output: McpToolContentBlock[] = []
  let remainingImageData = MCP_IMAGE_DATA_TOTAL_LIMIT
  for (const item of value.slice(0, MCP_CONTENT_BLOCK_LIMIT)) {
    if (typeof item === 'string') {
      output.push({ type: 'text', text: sanitizeMcpText(item, MCP_BLOCK_TEXT_LIMIT) })
      continue
    }
    if (!isRecord(item)) continue
    if (item.type === 'image') {
      const rawData = typeof item.data === 'string' ? item.data : String(item.data ?? '')
      const data = rawData.slice(0, remainingImageData)
      remainingImageData = Math.max(0, remainingImageData - data.length)
      output.push({
        type: 'image',
        data,
        ...(typeof item.mimeType === 'string'
          ? { mimeType: sanitizeMcpText(item.mimeType, MCP_MIME_LIMIT) }
          : {}),
        ...(typeof item.text === 'string'
          ? { text: sanitizeMcpText(item.text, MCP_BLOCK_TEXT_LIMIT) }
          : {}),
        ...(typeof item.uri === 'string'
          ? { uri: sanitizeMcpText(item.uri, MCP_URI_LIMIT) }
          : {}),
        ...(typeof item.name === 'string'
          ? { name: sanitizeMcpText(item.name, MCP_NAME_LIMIT) }
          : {}),
      })
      continue
    }
    if (item.type === 'resource') {
      output.push({
        type: 'resource',
        ...(typeof item.uri === 'string'
          ? { uri: sanitizeMcpText(item.uri, MCP_URI_LIMIT) }
          : {}),
        ...(typeof item.text === 'string'
          ? { text: sanitizeMcpText(item.text, MCP_BLOCK_TEXT_LIMIT) }
          : {}),
        ...(typeof item.mimeType === 'string'
          ? { mimeType: sanitizeMcpText(item.mimeType, MCP_MIME_LIMIT) }
          : {}),
        ...(typeof item.name === 'string'
          ? { name: sanitizeMcpText(item.name, MCP_NAME_LIMIT) }
          : {}),
      })
      continue
    }
    output.push({
      type: 'text',
      text: typeof item.text === 'string'
        ? sanitizeMcpText(item.text, MCP_BLOCK_TEXT_LIMIT)
        : safeStringify(item),
    })
  }
  return output
}

function summarizeMcpToolContent(content: readonly McpToolContentBlock[]): string {
  return sanitizeMcpText(
    content.map((block) => block.text ?? block.uri ?? block.name ?? block.type).join('\n'),
    MCP_OUTPUT_LIMIT,
  )
}

function resolveMcpErrorCode(
  input: NormalizeMcpToolExecutionResultInput,
  diagnostic: Record<string, unknown>,
): ExternalToolObservationErrorCode | undefined {
  if (input.ok) return undefined
  return normalizeExternalToolObservationErrorCode(input.errorCode)
    ?? normalizeExternalToolObservationErrorCode(
      isRecord(diagnostic.metadata) ? diagnostic.metadata.errorCode : undefined,
    )
    ?? (diagnostic.status === 'cancelled'
      ? 'cancelled'
      : diagnostic.status === 'skipped' || input.status === 'skipped'
        ? 'tool_unavailable'
        : 'execution_failed')
}

function resolveMcpObservationStatus(
  ok: boolean,
  status: unknown,
  diagnosticStatus: unknown,
): ExternalToolObservationStatus {
  if (ok) return 'done'
  if (status === 'error' || status === 'skipped') return status
  return diagnosticStatus === 'skipped' || diagnosticStatus === 'cancelled' ? 'skipped' : 'error'
}

function resolveMcpDiagnosticStatus(
  ok: boolean,
  status: ExternalToolObservationStatus,
  errorCode: ExternalToolObservationErrorCode | undefined,
  diagnosticStatus: unknown,
): 'done' | 'error' | 'skipped' | 'cancelled' {
  if (ok) return 'done'
  if (errorCode === 'cancelled') return 'cancelled'
  if (diagnosticStatus === 'error' || diagnosticStatus === 'skipped' || diagnosticStatus === 'cancelled') {
    return diagnosticStatus
  }
  return status === 'skipped' ? 'skipped' : 'error'
}

function sanitizeMcpMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeMcpJsonValue(
    value,
    0,
    new WeakSet<object>(),
    { nodes: MCP_JSON_NODE_LIMIT },
  )
  return isRecord(sanitized) ? sanitized : {}
}

function sanitizeMcpJsonValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: { nodes: number; invalid?: boolean },
): unknown {
  if (budget.nodes <= 0) return '[node-limit]'
  budget.nodes -= 1
  if (depth > MCP_JSON_DEPTH_LIMIT) return '[depth-limit]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return sanitizeMcpText(value, MCP_JSON_STRING_LIMIT)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (!value || typeof value !== 'object') return undefined
  if (ancestors.has(value)) {
    if (budget.invalid !== undefined) budget.invalid = true
    return '[circular]'
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.slice(0, MCP_JSON_COLLECTION_LIMIT)
        .map((entry) => sanitizeMcpJsonValue(entry, depth + 1, ancestors, budget) ?? null)
    }
    const output: Record<string, unknown> = {}
    let count = 0
    for (const key in value as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      const safeKey = sanitizeMcpText(key, MCP_JSON_KEY_LIMIT)
      output[safeKey] = isSensitiveMetadataKey(key)
        ? '[redacted]'
        : sanitizeMcpJsonValue(
            (value as Record<string, unknown>)[key],
            depth + 1,
            ancestors,
            budget,
          )
      count += 1
      if (count >= MCP_JSON_COLLECTION_LIMIT) break
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!normalized || SAFE_TOKEN_METADATA_KEYS.has(normalized)) return false
  return normalized.includes('apikey')
    || normalized.includes('authorization')
    || normalized.includes('bearer')
    || normalized.includes('credential')
    || normalized.includes('password')
    || normalized.includes('privatekey')
    || normalized.includes('secret')
    || normalized === 'token'
    || normalized.endsWith('token')
}

function sanitizeMcpTraceId(value: string): string {
  const sanitized = sanitizeMcpText(value, MCP_DIAGNOSTIC_ID_LIMIT)
  if (sanitized === value) return sanitized
  return sanitized.replace(/\[redacted\]/g, 'redacted').replace(/[^A-Za-z0-9_.:-]+/g, '-')
}

function sanitizeMcpText(value: string, limit: number): string {
  const bounded = value.length <= limit
    ? value
    : `${value.slice(0, Math.max(0, limit - 1))}…`
  return MCP_SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[redacted]'), bounded)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeStringify(value: Record<string, unknown>): string {
  try {
    const budget = { nodes: MCP_JSON_NODE_LIMIT, invalid: false }
    const normalized = sanitizeMcpJsonValue(
      value,
      0,
      new WeakSet<object>(),
      budget,
    )
    return budget.invalid ? '[invalid MCP content]' : JSON.stringify(normalized)
  } catch {
    return '[invalid MCP content]'
  }
}
