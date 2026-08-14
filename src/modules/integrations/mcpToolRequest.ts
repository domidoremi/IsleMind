export const MCP_TOOL_CALL_TAG = 'islemind_mcp_call'

export const MCP_TOOL_REQUEST_LIMITS = Object.freeze({
  outputChars: 1_048_576,
  payloadChars: 524_288,
  identityChars: 4_096,
  argumentNodes: 8_192,
  argumentDepth: 32,
  argumentCollectionItems: 1_024,
  argumentStringChars: 262_144,
  argumentKeyChars: 1_024,
})

export interface McpToolRequest {
  serverId?: string
  toolName: string
  arguments: Record<string, unknown>
}

const MCP_TOOL_REQUEST_PATTERN = new RegExp(
  `<${MCP_TOOL_CALL_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${MCP_TOOL_CALL_TAG}>`,
  'i',
)
const UNSAFE_IDENTITY_CHARACTER_PATTERN = /[\u0000-\u001f\u007f:]/
const UNSAFE_ARGUMENT_KEY_PATTERN = /^(?:__proto__|constructor|prototype)$/

/** Admits provider-authored tagged MCP requests without performing side effects. */
export function parseMcpToolRequest(output: string): McpToolRequest | null {
  if (output.length > MCP_TOOL_REQUEST_LIMITS.outputChars) return null
  const text = output.trim()
  if (!text) return null

  const match = text.match(MCP_TOOL_REQUEST_PATTERN)
  const raw = match?.[1] ?? (looksLikeMcpRequestJson(text) ? text : '')
  if (!raw || raw.length > MCP_TOOL_REQUEST_LIMITS.payloadChars) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed)) return null

    const toolValue = typeof parsed.tool === 'string'
      ? parsed.tool
      : typeof parsed.toolName === 'string'
        ? parsed.toolName
        : typeof parsed.name === 'string'
          ? parsed.name
          : ''
    if (!toolValue.trim()) return null

    const split = splitToolReference(toolValue)
    if (!split || !isSafeIdentity(split.toolName)) return null

    const explicitServerId = typeof parsed.serverId === 'string' && parsed.serverId.trim()
      ? parsed.serverId.trim()
      : undefined
    const serverId = explicitServerId ?? split.serverId
    if (serverId !== undefined && !isSafeIdentity(serverId)) return null

    const normalizedArguments = normalizeMcpArguments(
      parsed.arguments ?? parsed.args ?? parsed.input,
    )
    if (!normalizedArguments) return null

    return {
      serverId,
      toolName: split.toolName,
      arguments: normalizedArguments,
    }
  } catch {
    return null
  }
}

function looksLikeMcpRequestJson(text: string): boolean {
  return text.startsWith('{')
    && /"(tool|toolName|name)"\s*:/.test(text)
    && /"(arguments|args|input)"\s*:/.test(text)
}

function splitToolReference(value: string): { serverId?: string; toolName: string } | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MCP_TOOL_REQUEST_LIMITS.identityChars * 2 + 1) return null
  const separator = trimmed.includes('/') ? '/' : trimmed.includes(':') ? ':' : ''
  if (!separator) return { toolName: trimmed }

  const [serverId, ...rest] = trimmed.split(separator)
  const normalizedServerId = serverId.trim()
  const toolName = rest.join(separator).trim()
  if (!toolName) return null
  return normalizedServerId ? { serverId: normalizedServerId, toolName } : { toolName }
}

function isSafeIdentity(value: string): boolean {
  return value.length > 0
    && value.length <= MCP_TOOL_REQUEST_LIMITS.identityChars
    && value === value.trim()
    && !UNSAFE_IDENTITY_CHARACTER_PATTERN.test(value)
}

function normalizeMcpArguments(value: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return {}
  return isBoundedMcpArgument(value) ? value : null
}

function isBoundedMcpArgument(value: Record<string, unknown>): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0

  while (pending.length) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > MCP_TOOL_REQUEST_LIMITS.argumentNodes) return false

    if (typeof current.value === 'string') {
      if (current.value.length > MCP_TOOL_REQUEST_LIMITS.argumentStringChars) return false
      continue
    }
    if (
      current.value === null
      || typeof current.value === 'boolean'
      || (typeof current.value === 'number' && Number.isFinite(current.value))
    ) {
      continue
    }
    if (current.depth >= MCP_TOOL_REQUEST_LIMITS.argumentDepth) return false

    if (Array.isArray(current.value)) {
      if (current.value.length > MCP_TOOL_REQUEST_LIMITS.argumentCollectionItems) return false
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 })
      continue
    }
    if (!isPlainRecord(current.value)) return false

    const entries = Object.entries(current.value)
    if (entries.length > MCP_TOOL_REQUEST_LIMITS.argumentCollectionItems) return false
    for (const [key, item] of entries) {
      if (
        !key
        || key.length > MCP_TOOL_REQUEST_LIMITS.argumentKeyChars
        || UNSAFE_ARGUMENT_KEY_PATTERN.test(key)
        || /[\u0000-\u001f\u007f]/.test(key)
      ) {
        return false
      }
      pending.push({ value: item, depth: current.depth + 1 })
    }
  }

  return true
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
