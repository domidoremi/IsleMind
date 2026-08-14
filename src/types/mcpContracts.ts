export type McpTransport = 'sse' | 'streamable-http' | 'websocket'
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type McpToolPermission = 'read-only' | 'read-write' | 'destructive'

export interface McpToolManifest {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  permission: McpToolPermission
  serverId: string
  enabled: boolean
}

export interface McpResourceManifest {
  uri: string
  name?: string
  description?: string
  mimeType?: string
  serverId: string
}

export interface McpPromptManifest {
  name: string
  description?: string
  arguments?: Record<string, unknown>[]
  serverId: string
}

export interface McpServerConfig {
  id: string
  name: string
  url: string
  transport: McpTransport
  enabled: boolean
  status: McpConnectionStatus
  version?: string
  manifestTtlMs: number
  manifestCachedAt?: number
  tools: McpToolManifest[]
  resources: McpResourceManifest[]
  prompts: McpPromptManifest[]
  approvedToolNames: string[]
  lastError?: string
  createdAt: number
  updatedAt: number
}
