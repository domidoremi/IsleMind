import type { McpToolPermission, ProcessTrace, ProcessTraceStatus } from '@/types'
import { redactSensitiveText, sanitizeTraceMetadataValue } from '@/utils/traceSafety'

export const AGENT_TOOL_CALL_TRACE_CONTRACT = 'islemind.agent.tool-call-trace.v1'

export type AgentToolCallMode = 'native-provider' | 'tagged-json-fallback' | 'mcp-runtime'

export interface AgentToolCallTraceMetadataInput {
  mode: AgentToolCallMode
  source: string
  toolName?: string
  toolId?: string
  serverId?: string
  permission?: McpToolPermission
  status?: ProcessTraceStatus
  errorCode?: string
  providerType?: string
}

export interface AgentToolCallTraceContractResult {
  ok: boolean
  errors: string[]
}

export interface AgentToolCallTraceShape {
  contract: typeof AGENT_TOOL_CALL_TRACE_CONTRACT
  type: 'tool'
  toolName: string
  source: string
  status: ProcessTraceStatus
  mode: AgentToolCallMode
  hasPermission: boolean
  hasServerId: boolean
  hasErrorCode: boolean
}

export function buildAgentToolCallTraceMetadata(input: AgentToolCallTraceMetadataInput): Record<string, unknown> {
  const toolName = sanitizeToolTraceText(input.toolName || 'tool')
  const source = sanitizeToolTraceText(input.source || 'tool')
  const metadata: Record<string, unknown> = {
    toolCallContract: AGENT_TOOL_CALL_TRACE_CONTRACT,
    toolCallMode: input.mode,
    toolCallSource: source,
    source,
    toolName,
  }
  if (input.toolId) metadata.toolId = sanitizeToolTraceText(input.toolId)
  if (input.serverId) metadata.serverId = sanitizeToolTraceText(input.serverId)
  if (input.permission) metadata.permission = input.permission
  if (input.status) metadata.toolCallStatus = input.status
  if (input.errorCode) metadata.errorCode = sanitizeToolTraceText(input.errorCode)
  if (input.providerType) metadata.providerType = sanitizeToolTraceText(input.providerType)
  return sanitizeTraceMetadataValue(metadata) as Record<string, unknown>
}

export function inferAgentToolNameFromTraceContent(title: string, content: string): string {
  const candidates = [
    content.match(/(?:tool|function|name|工具|関数|名称|名前)[^\n:：]*[:：]\s*([A-Za-z0-9_.:-]+)/i)?.[1],
    title.match(/(?:tool|function|工具|関数|名称|名前)[^\w.-]*([A-Za-z0-9_.:-]+)/i)?.[1],
  ].filter(Boolean) as string[]
  return candidates.find((item) => item.trim())?.trim() || 'provider_tool'
}

export function validateAgentToolCallTraceContract(trace: ProcessTrace): AgentToolCallTraceContractResult {
  const errors: string[] = []
  const metadata = trace.metadata ?? {}
  if (trace.type !== 'tool') errors.push('Agent tool-call trace contract applies only to tool traces.')
  if (metadata.toolCallContract !== AGENT_TOOL_CALL_TRACE_CONTRACT) {
    errors.push('Agent tool-call traces must record the contract id.')
  }
  if (!isAgentToolCallMode(metadata.toolCallMode)) {
    errors.push('Agent tool-call traces must record a known toolCallMode.')
  }
  if (typeof metadata.toolName !== 'string' || !metadata.toolName.trim()) {
    errors.push('Agent tool-call traces must record toolName.')
  }
  if (typeof metadata.toolCallSource !== 'string' || !metadata.toolCallSource.trim()) {
    errors.push('Agent tool-call traces must record toolCallSource.')
  }
  if (metadata.source !== metadata.toolCallSource) {
    errors.push('Agent tool-call trace source must match toolCallSource.')
  }
  if (metadata.toolCallStatus !== undefined && !isProcessTraceStatus(metadata.toolCallStatus)) {
    errors.push('Agent tool-call trace toolCallStatus must be a known trace status.')
  }
  if (metadata.toolCallIndex !== undefined && !isNonNegativeInteger(metadata.toolCallIndex)) {
    errors.push('Agent tool-call trace toolCallIndex must be a non-negative integer.')
  }
  if (metadata.maxToolCallsPerStep !== undefined && !isBoundedInteger(metadata.maxToolCallsPerStep, 1, 3)) {
    errors.push('Agent tool-call trace maxToolCallsPerStep must be an integer from 1 to 3.')
  }
  if (metadata.requestedToolCallCount !== undefined && !isPositiveInteger(metadata.requestedToolCallCount)) {
    errors.push('Agent tool-call trace requestedToolCallCount must be a positive integer.')
  }
  return {
    ok: errors.length === 0,
    errors,
  }
}

export function extractAgentToolCallTraceShape(trace: ProcessTrace): AgentToolCallTraceShape | undefined {
  const audit = validateAgentToolCallTraceContract(trace)
  if (!audit.ok) return undefined
  const metadata = trace.metadata ?? {}
  return {
    contract: AGENT_TOOL_CALL_TRACE_CONTRACT,
    type: 'tool',
    toolName: String(metadata.toolName),
    source: String(metadata.toolCallSource),
    status: (metadata.toolCallStatus as ProcessTraceStatus | undefined) ?? trace.status,
    mode: metadata.toolCallMode as AgentToolCallMode,
    hasPermission: typeof metadata.permission === 'string',
    hasServerId: typeof metadata.serverId === 'string' && metadata.serverId.trim().length > 0,
    hasErrorCode: typeof metadata.errorCode === 'string' && metadata.errorCode.trim().length > 0,
  }
}

export function equivalentAgentToolCallTraceShape(left: ProcessTrace, right: ProcessTrace): boolean {
  const leftShape = extractAgentToolCallTraceShape(left)
  const rightShape = extractAgentToolCallTraceShape(right)
  if (!leftShape || !rightShape) return false
  return leftShape.contract === rightShape.contract &&
    leftShape.type === rightShape.type &&
    leftShape.toolName === rightShape.toolName &&
    leftShape.status === rightShape.status &&
    leftShape.hasPermission === rightShape.hasPermission &&
    leftShape.hasServerId === rightShape.hasServerId &&
    leftShape.hasErrorCode === rightShape.hasErrorCode
}

export function stripAgentToolRequestBlocks(output: string, tagName = 'islemind_mcp_call'): string {
  const escaped = escapeRegExp(tagName)
  const withoutTaggedBlocks = output.replace(new RegExp(`<${escaped}>[\\s\\S]*?</${escaped}>`, 'gi'), '').trim()
  return looksLikeRawAgentToolRequestJson(withoutTaggedBlocks) ? '' : withoutTaggedBlocks
}

export function containsRawAgentToolRequestJson(output: string, tagName = 'islemind_mcp_call'): boolean {
  const text = output.trim()
  if (!text) return false
  const escaped = escapeRegExp(tagName)
  if (new RegExp(`<${escaped}>[\\s\\S]*?</${escaped}>`, 'i').test(text)) return true
  return looksLikeRawAgentToolRequestJson(text)
}

function looksLikeRawAgentToolRequestJson(text: string): boolean {
  if (!text.startsWith('{') || !text.endsWith('}')) return false
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const hasToolName = typeof parsed.tool === 'string' ||
      typeof parsed.toolName === 'string' ||
      typeof parsed.name === 'string'
    const hasArguments = parsed.arguments !== undefined ||
      parsed.args !== undefined ||
      parsed.input !== undefined
    return hasToolName && hasArguments
  } catch {
    return false
  }
}

function isAgentToolCallMode(value: unknown): value is AgentToolCallMode {
  return value === 'native-provider' || value === 'tagged-json-fallback' || value === 'mcp-runtime'
}

function isProcessTraceStatus(value: unknown): value is ProcessTraceStatus {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'error' || value === 'skipped' || value === 'cancelled'
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function sanitizeToolTraceText(value: string): string {
  return redactSensitiveText(value).trim().slice(0, 160) || 'tool'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
