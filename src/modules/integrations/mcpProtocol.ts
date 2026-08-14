export type McpToolPermission = 'read-only' | 'read-write' | 'destructive'

export interface McpDiscoveredTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  permission: McpToolPermission
  serverId: string
  enabled: boolean
}

export interface McpManifestNormalization<T> {
  items: readonly T[]
  invalidCount: number
}

export interface NormalizeMcpToolsInput {
  serverId: string
  enabledToolNames?: ReadonlySet<string>
}

/**
 * MCP discovery payloads cross an untrusted network boundary. The target
 * integration contract owns normalization and permission classification so
 * legacy callers cannot maintain divergent tool manifests.
 */
export function normalizeMcpTools(
  items: readonly unknown[],
  input: NormalizeMcpToolsInput,
): McpManifestNormalization<McpDiscoveredTool> {
  const output: McpDiscoveredTool[] = []
  let invalidCount = 0
  for (const item of items) {
    if (!isRecord(item) || typeof item.name !== 'string') {
      invalidCount += 1
      continue
    }
    const name = item.name
    output.push({
      name,
      description: optionalString(item.description),
      inputSchema: item.inputSchema && typeof item.inputSchema === 'object'
        ? item.inputSchema as Record<string, unknown>
        : undefined,
      permission: inferMcpToolPermission(name, optionalString(item.description)),
      serverId: input.serverId,
      enabled: input.enabledToolNames?.has(name) ?? false,
    })
  }
  return { items: output, invalidCount }
}

export function inferMcpToolPermission(name: string, description?: string): McpToolPermission {
  const nameText = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const descriptionText = (description ?? '').toLowerCase()
  if (/\b(?:delete|remove|shell|exec|execute|write\s+file|rm|drop|destroy|destructive)\b/.test(nameText)) return 'destructive'
  if (/\b(?:delete|remove|shell|drop|destroy|destructive)\b/.test(descriptionText)) return 'destructive'
  if (/\b(?:write|create|update|edit|post|upload|save|click|fill|navigate|press|select|type)\b/.test(nameText)) return 'read-write'
  if (/\b(?:write|create|update|edit|post|upload|save)\b/.test(descriptionText)) return 'read-write'
  return 'read-only'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
