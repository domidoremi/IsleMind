export const MCP_TOOL_CALL_TAG = 'islemind_mcp_call'

export interface McpToolRequest {
  serverId?: string
  toolName: string
  arguments: Record<string, unknown>
}

export function parseMcpToolRequest(output: string): McpToolRequest | null {
  const text = output.trim()
  if (!text) return null
  const match = text.match(new RegExp(`<${MCP_TOOL_CALL_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${MCP_TOOL_CALL_TAG}>`, 'i'))
  const raw = match?.[1] ?? (looksLikeMcpRequestJson(text) ? text : '')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const toolValue = typeof parsed.tool === 'string'
      ? parsed.tool
      : typeof parsed.toolName === 'string'
        ? parsed.toolName
        : typeof parsed.name === 'string'
          ? parsed.name
          : ''
    if (!toolValue.trim()) return null
    const split = splitToolReference(toolValue)
    const serverId = typeof parsed.serverId === 'string' && parsed.serverId.trim()
      ? parsed.serverId.trim()
      : split.serverId
    return {
      serverId,
      toolName: split.toolName,
      arguments: normalizeMcpArguments(parsed.arguments ?? parsed.args ?? parsed.input),
    }
  } catch {
    return null
  }
}

function looksLikeMcpRequestJson(text: string): boolean {
  return text.startsWith('{') && /"(tool|toolName|name)"\s*:/.test(text) && /"(arguments|args|input)"\s*:/.test(text)
}

function splitToolReference(value: string): { serverId?: string; toolName: string } {
  const trimmed = value.trim()
  const separator = trimmed.includes('/') ? '/' : trimmed.includes(':') ? ':' : ''
  if (!separator) return { toolName: trimmed }
  const [serverId, ...rest] = trimmed.split(separator)
  const toolName = rest.join(separator).trim()
  return toolName ? { serverId: serverId.trim(), toolName } : { toolName: trimmed }
}

function normalizeMcpArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
