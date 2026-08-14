import type { IntegrationSource } from './contracts'

export interface IntegrationToolManifest {
  id: string
  source: IntegrationSource | 'app-action'
  name: string
  description: string
  permission: 'read-only' | 'read-write' | 'destructive'
  inputSchema?: Record<string, unknown>
  enabled: boolean
  serverId?: string
  serverName?: string
  metadata?: Record<string, unknown>
}

export interface ExternalToolDescriptor {
  name: string
  description?: string
  permission: IntegrationToolManifest['permission']
  inputSchema?: Record<string, unknown>
  enabled: boolean
}

export function createServerToolManifests(input: {
  source: Extract<IntegrationSource, 'mcp' | 'builtin'>
  serverId: string
  serverName: string
  transport?: string
  status: string
  enabled: boolean
  tools: readonly ExternalToolDescriptor[]
}): IntegrationToolManifest[] {
  return input.tools.map((tool) => ({
    id: `${input.source}:${input.serverId}:${tool.name}`,
    source: input.source,
    name: tool.name,
    description: tool.description ?? tool.name,
    permission: tool.permission,
    inputSchema: tool.inputSchema,
    enabled: input.enabled && tool.enabled && (input.source === 'builtin' || input.status === 'connected'),
    serverId: input.serverId,
    serverName: input.serverName,
    metadata: { transport: input.transport, status: input.status },
  }))
}

export function createAppActionToolManifest(input: Omit<IntegrationToolManifest, 'id' | 'source' | 'enabled'>): IntegrationToolManifest {
  return { ...input, id: `app-action:${input.name}`, source: 'app-action', enabled: true }
}
