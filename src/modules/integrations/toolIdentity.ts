export interface ToolManifestIdentity {
  id: string
  source: string
  name: string
  serverId?: string
}

export interface ToolRequestIdentity {
  toolId?: string
  source?: string
  name?: string
  serverId?: string
}

export function resolveUniqueToolManifest<T extends ToolManifestIdentity>(
  request: ToolRequestIdentity,
  manifests: readonly T[],
): T | null {
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

export function formatToolRequestIdentity(request: ToolRequestIdentity | undefined): string {
  if (!request) return ''
  if (request.toolId) return request.toolId
  if (request.serverId && request.name) return `${request.serverId}:${request.name}`
  return request.name ?? ''
}
