import { asTaskId } from '@/core'

import { parseToolArguments, type ExternalToolExecutionResult } from './contracts'
import type {
  McpCatalogDiscovery,
  McpCatalogOperationOptions,
  McpCatalogServer,
  McpCatalogTool,
} from './mcpCatalogPolicy'
import {
  createMcpHttpClient,
  createMcpHttpToolClient,
  createMcpToolRequestHeaders,
  type McpHttpClient,
  type McpNegotiatedProtocolVersion,
  validateMcpToolRequestHeaderSchema,
} from './mcpHttpClient'
import { createMcpToolAdapter } from './mcpToolAdapter'

export type McpClientServer = Pick<
  McpCatalogServer,
  'id' | 'url' | 'transport' | 'status' | 'version'
>

export type McpClientTool = Pick<
  McpCatalogTool,
  'name' | 'description' | 'inputSchema' | 'permission' | 'serverId' | 'enabled'
>

export type McpClientDiscovery = McpCatalogDiscovery & {
  protocolVersion?: McpNegotiatedProtocolVersion
}
export type McpClientOperationOptions = McpCatalogOperationOptions

export interface McpClientToolExecutionInput {
  server: McpClientServer
  tool: McpClientTool
  arguments: Record<string, unknown>
  signal: AbortSignal
  taskId: string
  startedAt: number
}

export interface McpClientAdapter {
  discover(server: McpClientServer, options?: McpClientOperationOptions): Promise<McpClientDiscovery>
  executeTool(input: McpClientToolExecutionInput): Promise<ExternalToolExecutionResult>
  invalidate(server: Pick<McpClientServer, 'id'>): void
  reconcile(servers: readonly McpClientServer[]): void
}

/** Owns reusable MCP HTTP clients, Streamable HTTP sessions, and remote protocol dispatch. */
export function createMcpClientAdapter(): McpClientAdapter {
  const clients = new Map<string, {
    url: string
    transport: McpClientServer['transport']
    client: McpHttpClient
  }>()

  const invalidate = (server: Pick<McpClientServer, 'id'>): void => {
    clients.get(server.id)?.client.clearSession()
    clients.delete(server.id)
  }

  const reconcile = (servers: readonly McpClientServer[]): void => {
    for (const [serverId, entry] of clients) {
      const server = servers.find((item) => item.id === serverId)
      if (!server || server.url !== entry.url || server.transport !== entry.transport) {
        invalidate({ id: serverId })
      }
    }
  }

  const getClient = (server: McpClientServer): McpHttpClient => {
    const existing = clients.get(server.id)
    if (server.transport === 'sse') {
      existing?.client.clearSession()
      clients.delete(server.id)
      return createMcpHttpClient({ id: server.id, url: server.url, transport: 'sse' })
    }
    if (existing?.url === server.url && existing.transport === server.transport) return existing.client
    existing?.client.clearSession()
    if (server.transport !== 'streamable-http') {
      throw new Error(`MCP transport ${server.transport} is not HTTP-capable.`)
    }
    const client = createMcpHttpClient({ id: server.id, url: server.url, transport: server.transport })
    clients.set(server.id, { url: server.url, transport: server.transport, client })
    return client
  }

  const ensureSession = async (
    server: McpClientServer,
    signal?: AbortSignal,
  ): Promise<{
    version?: string
    protocolVersion?: McpNegotiatedProtocolVersion
    capabilities?: Readonly<Record<string, unknown>>
  }> => {
    throwIfAborted(signal)
    if (server.transport !== 'streamable-http') return { version: server.version }
    const client = getClient(server)
    const version = (await client.initialize({ signal })) ?? server.version
    throwIfAborted(signal)
    return {
      version,
      protocolVersion: client.getNegotiatedProtocolVersion(),
      capabilities: client.getServerCapabilities(),
    }
  }

  const request = async (
    server: McpClientServer,
    method: string,
    params: Parameters<McpHttpClient['request']>[1],
    signal?: AbortSignal,
  ) => {
    throwIfAborted(signal)
    const response = await getClient(server).request(method, params, { signal })
    throwIfAborted(signal)
    return response
  }

  const list = async (
    server: McpClientServer,
    method: 'tools/list' | 'resources/list' | 'prompts/list',
    signal?: AbortSignal,
  ): Promise<unknown[]> => {
    const response = await request(server, method, {}, signal)
    const value = response.result[method.split('/')[0]]
    return Array.isArray(value) ? value : []
  }

  return {
    async discover(server, options = {}) {
      throwIfAborted(options.signal)
      const negotiation = await ensureSession(server, options.signal)
      throwIfAborted(options.signal)
      const shouldList = (capability: 'tools' | 'resources' | 'prompts') => (
        negotiation.capabilities === undefined || capability in negotiation.capabilities
      )
      const [tools, resources, prompts] = await Promise.all([
        shouldList('tools') ? list(server, 'tools/list', options.signal) : [],
        shouldList('resources') ? list(server, 'resources/list', options.signal) : [],
        shouldList('prompts') ? list(server, 'prompts/list', options.signal) : [],
      ])
      throwIfAborted(options.signal)
      let compatibleTools = tools
      if (negotiation.protocolVersion === '2026-07-28') {
        compatibleTools = tools.filter((tool) => {
          if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return true
          try {
            validateMcpToolRequestHeaderSchema((tool as { inputSchema?: unknown }).inputSchema)
            return true
          } catch {
            return false
          }
        })
      }
      return {
        version: negotiation.version,
        protocolVersion: negotiation.protocolVersion,
        tools: compatibleTools,
        resources,
        prompts,
      }
    },

    async executeTool(input) {
      throwIfAborted(input.signal)
      await ensureSession(input.server, input.signal)
      throwIfAborted(input.signal)
      const httpClient = getClient(input.server)
      const httpServer = {
        id: input.server.id,
        url: input.server.url,
        transport: input.server.transport === 'streamable-http' ? 'streamable-http' as const : 'sse' as const,
      }
      const adapter = createMcpToolAdapter(
        input.tool,
        createMcpHttpToolClient(
          httpServer,
          httpClient,
          httpClient.getNegotiatedProtocolVersion() === '2026-07-28'
            ? (argumentsValue) => createMcpToolRequestHeaders(input.tool.inputSchema, argumentsValue)
            : undefined,
        ),
        {
          connectionStatus: input.server.status,
          startedAt: input.startedAt,
        },
      )
      const result = await adapter.execute({
        taskId: asTaskId(input.taskId),
        tool: adapter.definition,
        arguments: parseToolArguments(input.arguments),
      }, { signal: input.signal })
      throwIfAborted(input.signal)
      return result
    },

    invalidate,
    reconcile,
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
