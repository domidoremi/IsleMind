import type { AgentToolManifest, AgentToolRequest } from '@/services/agent/agentToolTypes'

export function resolveUniqueAgentTool(
  request: AgentToolRequest,
  manifests: AgentToolManifest[]
): AgentToolManifest | null {
  if (request.toolId) return manifests.find((tool) => tool.id === request.toolId) ?? null
  if (!request.name) return null
  const matches = manifests.filter((tool) => {
    if (tool.name !== request.name) return false
    if (request.source && tool.source !== request.source) return false
    if (request.serverId && tool.serverId !== request.serverId) return false
    return true
  })
  if (request.source || request.serverId) return matches[0] ?? null
  return matches.length === 1 ? matches[0] : null
}

export function formatAgentToolRequestIdentity(request: AgentToolRequest | undefined): string {
  if (!request) return ''
  if (request.toolId) return request.toolId
  if (request.serverId && request.name) return `${request.serverId}:${request.name}`
  return request.name ?? ''
}
