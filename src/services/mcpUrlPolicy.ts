import type { McpServerConfig } from '@/types'
import { safeHttpUrl } from '@/utils/networkUrlSafety'

const BUILTIN_MCP_SERVER_ID = 'islemind-builtins'

export function isBuiltinMcpServer(server: Pick<McpServerConfig, 'id'>): boolean {
  return server.id === BUILTIN_MCP_SERVER_ID
}

export function isAllowedMcpServerUrl(server: Pick<McpServerConfig, 'id' | 'url'>): boolean {
  return isBuiltinMcpServer(server) || !!safeHttpUrl(server.url)
}

export function normalizeMcpServerUrl(server: Pick<McpServerConfig, 'id' | 'url'>): string | null {
  if (isBuiltinMcpServer(server)) return server.url
  return safeHttpUrl(server.url)
}
