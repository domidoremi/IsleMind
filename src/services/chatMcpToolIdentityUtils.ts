import type { McpServerConfig, McpToolManifest } from '@/types'

export interface McpToolIdentityLike {
  server: Pick<McpServerConfig, 'id' | 'name'>
  tool: Pick<McpToolManifest, 'name'>
}

export function selectEnabledMcpTools<T extends McpToolIdentityLike>(tools: T[], enabledRefs: string[]): T[] {
  if (!enabledRefs.length) return tools
  const nameCounts = countMcpToolNames(tools)
  return tools.filter((item) => {
    if (enabledRefs.some((ref) => matchesExplicitMcpToolRef(item, ref))) return true
    return enabledRefs.includes(item.tool.name) && (nameCounts.get(item.tool.name) ?? 0) === 1
  })
}

export function resolveMcpToolIdentity<T extends McpToolIdentityLike>(
  tools: T[],
  request: { serverId?: string; toolName: string }
): T | undefined {
  const explicit = tools.find((item) => matchesRequestedMcpToolRef(item, request))
  if (explicit) return explicit
  if (request.serverId) return undefined
  return findUniqueBareMcpTool(tools, request.toolName)
}

function matchesRequestedMcpToolRef<T extends McpToolIdentityLike>(
  item: T,
  request: { serverId?: string; toolName: string }
): boolean {
  if (request.serverId) {
    return (item.server.id === request.serverId || item.server.name === request.serverId) && item.tool.name === request.toolName
  }
  return matchesExplicitMcpToolRef(item, request.toolName)
}

function matchesExplicitMcpToolRef<T extends McpToolIdentityLike>(item: T, ref: string): boolean {
  return ref === `${item.server.id}:${item.tool.name}` || ref === `${item.server.id}/${item.tool.name}`
}

function findUniqueBareMcpTool<T extends McpToolIdentityLike>(tools: T[], toolName: string): T | undefined {
  const matches = tools.filter((item) => item.tool.name === toolName)
  return matches.length === 1 ? matches[0] : undefined
}

function countMcpToolNames<T extends McpToolIdentityLike>(tools: T[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of tools) {
    counts.set(item.tool.name, (counts.get(item.tool.name) ?? 0) + 1)
  }
  return counts
}
