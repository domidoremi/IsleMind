import { normalizeMcpTools } from './mcpProtocol'

export const MCP_CATALOG_DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

export type McpCatalogTransport = 'sse' | 'streamable-http' | 'websocket'
export type McpCatalogConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type McpCatalogToolPermission = 'read-only' | 'read-write' | 'destructive'

export interface McpCatalogTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  permission: McpCatalogToolPermission
  serverId: string
  enabled: boolean
}

export interface McpCatalogResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
  serverId: string
}

export interface McpCatalogPrompt {
  name: string
  description?: string
  arguments?: Record<string, unknown>[]
  serverId: string
}

/** Structural catalog contract; application-specific server types can use the policy without a legacy type import. */
export interface McpCatalogServer {
  id: string
  name: string
  url: string
  transport: McpCatalogTransport
  enabled: boolean
  status: McpCatalogConnectionStatus
  version?: string
  manifestTtlMs: number
  manifestCachedAt?: number
  manifestExpiresAt?: number
  tools: McpCatalogTool[]
  resources: McpCatalogResource[]
  prompts: McpCatalogPrompt[]
  approvedToolNames: string[]
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface McpCatalogDiscovery {
  version?: string
  tools: unknown[]
  resources: unknown[]
  prompts: unknown[]
  ttlMs?: number
}

export interface McpCatalogOperationOptions {
  signal?: AbortSignal
}

export interface McpCatalogMutationOptions extends McpCatalogOperationOptions {
  expectedServer?: McpCatalogServer | null
}

export class McpCatalogConflictError extends Error {
  constructor(readonly serverId: string) {
    super('mcp_catalog_conflict')
    this.name = 'McpCatalogConflictError'
  }
}

export class McpCatalogRecordDataError extends Error {
  constructor() {
    super('Invalid persisted MCP server record')
    this.name = 'McpCatalogRecordDataError'
  }
}

export interface McpCatalogOperationLog<TServer extends McpCatalogServer> {
  phase: 'manifest_refresh'
  server: Pick<TServer, 'id' | 'name' | 'transport' | 'status' | 'url'>
  method?: string
  status: 'done' | 'error' | 'skipped' | 'cancelled'
  reason?: string
  error?: unknown
  detail?: string
  resultCount?: number
}

export interface McpCatalogPolicyDependencies<TServer extends McpCatalogServer> {
  builtinServerId: string
  loadServers(options?: McpCatalogOperationOptions): Promise<unknown>
  saveServers(servers: readonly TServer[], options?: McpCatalogOperationOptions): Promise<void>
  builtinServer(): TServer
  discover(server: TServer, options?: McpCatalogOperationOptions): Promise<McpCatalogDiscovery>
  invalidateSession(server: Pick<TServer, 'id'>): void
  reconcileSessions(servers: readonly TServer[]): void
  normalizeServerUrl(server: Pick<McpCatalogServer, 'id' | 'url'>): string | null
  isAllowedServerUrl(server: Pick<McpCatalogServer, 'id' | 'url'>): boolean
  explicitHttpOnlyErrorText(): string
  logOperation(input: McpCatalogOperationLog<TServer>): Promise<void>
  now(): number
}

export interface McpCatalogPolicy<TServer extends McpCatalogServer> {
  listServers(options?: McpCatalogOperationOptions): Promise<TServer[]>
  saveServers(servers: readonly TServer[], options?: McpCatalogOperationOptions): Promise<void>
  upsertServer(server: TServer, options?: McpCatalogMutationOptions): Promise<TServer>
  removeServer(serverId: string, options?: McpCatalogMutationOptions): Promise<boolean>
  refreshManifest(server: TServer, options?: McpCatalogOperationOptions): Promise<TServer>
  needsManifestRefresh(server: TServer): boolean
}

/** Owns persisted MCP catalog admission, normalization, and manifest-refresh state transitions. */
export function createMcpCatalogPolicy<TServer extends McpCatalogServer>(
  dependencies: McpCatalogPolicyDependencies<TServer>,
): McpCatalogPolicy<TServer> {
  let mutationTail: Promise<unknown> = Promise.resolve()
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(operation)
    mutationTail = result.catch(() => undefined)
    return result
  }

  const normalizeServer = (value: unknown): TServer | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Partial<McpCatalogServer>
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.url !== 'string') return null
    const url = dependencies.normalizeServerUrl({ id: item.id, url: item.url })
    if (!url) return null

    const timestamp = dependencies.now()
    const rawTools = Array.isArray(item.tools) ? item.tools : []
    const enabledToolNames = new Set(rawTools.flatMap((tool) => (
      tool && typeof tool === 'object' && typeof (tool as { name?: unknown }).name === 'string' &&
        (tool as { enabled?: unknown }).enabled === true
        ? [(tool as { name: string }).name]
        : []
    )))

    return JSON.parse(JSON.stringify({
      id: item.id,
      name: item.name,
      url,
      transport: item.transport === 'streamable-http' || item.transport === 'websocket' ? item.transport : 'sse',
      enabled: item.enabled === true,
      status: item.status === 'connecting' || item.status === 'connected' || item.status === 'error'
        ? item.status
        : 'disconnected',
      version: typeof item.version === 'string' ? item.version : undefined,
      manifestTtlMs: typeof item.manifestTtlMs === 'number' && Number.isFinite(item.manifestTtlMs) && item.manifestTtlMs > 0
        ? item.manifestTtlMs
        : MCP_CATALOG_DEFAULT_TTL_MS,
      manifestCachedAt: typeof item.manifestCachedAt === 'number' && Number.isFinite(item.manifestCachedAt)
        ? item.manifestCachedAt
        : undefined,
      manifestExpiresAt: typeof item.manifestExpiresAt === 'number' && Number.isFinite(item.manifestExpiresAt)
        ? item.manifestExpiresAt
        : undefined,
      tools: [...normalizeMcpTools(rawTools, { serverId: item.id, enabledToolNames }).items],
      resources: normalizeResources(Array.isArray(item.resources) ? item.resources : [], item.id),
      prompts: normalizePrompts(Array.isArray(item.prompts) ? item.prompts : [], item.id),
      approvedToolNames: Array.isArray(item.approvedToolNames)
        ? [...new Set(item.approvedToolNames.filter((name): name is string => typeof name === 'string'))]
        : [],
      lastError: typeof item.lastError === 'string' ? item.lastError : undefined,
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : timestamp,
      updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : timestamp,
    })) as TServer
  }

  const requireServer = (value: TServer): TServer => {
    const server = normalizeServer(value)
    if (!server) throw new Error('Invalid MCP server')
    if (!dependencies.isAllowedServerUrl(server)) {
      throw new Error(dependencies.explicitHttpOnlyErrorText())
    }
    return server
  }

  const listServers = async (options: McpCatalogOperationOptions = {}): Promise<TServer[]> => {
    throwIfAborted(options.signal)
    const saved = await dependencies.loadServers(options)
    throwIfAborted(options.signal)
    // An unsupported record must not become an empty, writable catalog.
    if (saved !== null && !Array.isArray(saved)) throw new McpCatalogRecordDataError()
    const persisted = saved ?? []
    return [
      dependencies.builtinServer(),
      ...persisted.map(normalizeServer).filter(isServer),
    ]
  }

  const persistServers = async (
    servers: readonly TServer[],
    options: McpCatalogOperationOptions = {},
  ): Promise<void> => {
    throwIfAborted(options.signal)
    const normalized = servers
      .filter((server) => server.id !== dependencies.builtinServerId)
      .map(normalizeServer)
      .filter(isServer)

    await dependencies.saveServers(normalized, options)
    dependencies.reconcileSessions(normalized)
    throwIfAborted(options.signal)
  }

  const saveServers = async (
    servers: readonly TServer[],
    options: McpCatalogOperationOptions = {},
  ): Promise<void> => {
    const signal = options.signal
    throwIfAborted(signal)
    const snapshot = servers.map(normalizeServer).filter(isServer)
    return mutate(() => persistServers(snapshot, { signal }))
  }

  const assertExpected = (servers: readonly TServer[], id: string, expected: McpCatalogServer | null) => {
    const current = servers.find(item => item.id === id)
    const version = (value: McpCatalogServer) => {
      const normalized = normalizeServer(value)
      // Clock-only changes do not replace configuration or approval state.
      return normalized ? JSON.stringify({ ...normalized, createdAt: undefined, updatedAt: undefined }) : null
    }
    if (expected === null ? current !== undefined
      : !current || expected.id !== id || version(current) !== version(expected)) {
      throw new McpCatalogConflictError(id)
    }
  }

  const captureExpectedServer = (value: Readonly<McpCatalogServer> | null | undefined) => {
    if (value == null) return value
    const snapshot = normalizeServer(value)
    if (!snapshot) throw new McpCatalogConflictError(value.id)
    return snapshot
  }

  const upsertServer = async (
    server: TServer,
    options: McpCatalogMutationOptions = {},
  ): Promise<TServer> => {
    const signal = options.signal
    throwIfAborted(signal)
    // Capture portable values and consent before waiting on another mutation.
    const normalized = requireServer(server)
    const expectedServer = captureExpectedServer(options.expectedServer)
    return mutate(async () => {
      throwIfAborted(signal)
      const servers = await listServers({ signal })
      if (expectedServer !== undefined) assertExpected(servers, normalized.id, expectedServer)
      await persistServers([
        normalized,
        ...servers.filter((item) => item.id !== normalized.id && item.id !== dependencies.builtinServerId),
      ], { signal })
      return normalized
    })
  }

  const removeServer = async (
    serverId: string,
    options: McpCatalogMutationOptions = {},
  ): Promise<boolean> => {
    const signal = options.signal
    const expectedServer = captureExpectedServer(options.expectedServer)
    return mutate(async () => {
      throwIfAborted(signal)
      if (serverId === dependencies.builtinServerId) return false
      if (typeof serverId !== 'string' || !serverId || serverId.trim() !== serverId) {
        throw new Error('Invalid MCP server id')
      }
      const servers = (await listServers({ signal }))
        .filter((server) => server.id !== dependencies.builtinServerId)
      if (expectedServer !== undefined) assertExpected(servers, serverId, expectedServer)
      const next = servers.filter((server) => server.id !== serverId)
      if (next.length === servers.length) return false
      await persistServers(next, { signal })
      return true
    })
  }

  const refreshManifest = async (
    server: TServer,
    options: McpCatalogOperationOptions = {},
  ): Promise<TServer> => {
    options = { signal: options.signal }
    throwIfAborted(options.signal)
    if (server.id === dependencies.builtinServerId) return dependencies.builtinServer()
    const captured = normalizeServer(server)
    if (!captured) throw new McpCatalogConflictError(server.id)
    server = captured
    if (!server.enabled) return patchServer(server, { status: 'disconnected' })
    if (!dependencies.isAllowedServerUrl(server)) {
      const next = patchServer(server, {
        status: 'error',
        lastError: dependencies.explicitHttpOnlyErrorText(),
        updatedAt: dependencies.now(),
      })
      await dependencies.logOperation({
        phase: 'manifest_refresh',
        server: next,
        status: 'skipped',
        reason: 'tool_unavailable',
        detail: 'non_http_server_url',
        error: new Error(next.lastError),
      })
      throwIfAborted(options.signal)
      return next
    }
    if (server.transport !== 'sse' && server.transport !== 'streamable-http') {
      const next = patchServer(server, {
        status: 'error',
        lastError: 'Only SSE and Streamable HTTP transports are enabled in this build.',
      })
      await dependencies.logOperation({
        phase: 'manifest_refresh',
        server: next,
        status: 'skipped',
        reason: 'tool_unavailable',
        detail: 'unsupported_transport',
        error: new Error(next.lastError),
      })
      throwIfAborted(options.signal)
      return next
    }

    const baseline = normalizeServer(server)
    if (!baseline) throw new McpCatalogConflictError(server.id)
    assertExpected(await listServers(options), server.id, baseline)
    let discovery: McpCatalogDiscovery
    try {
      discovery = await dependencies.discover(server, options)
      throwIfAborted(options.signal)
    } catch (error) {
      throwIfAborted(options.signal)
      if (isAbortError(error)) throw error
      const next = patchServer(server, {
        status: 'error',
        lastError: error instanceof Error ? error.message : 'MCP manifest refresh failed',
        updatedAt: dependencies.now(),
      })
      await upsertServer(next, { ...options, expectedServer: baseline })
      dependencies.invalidateSession(server)
      await dependencies.logOperation({
        phase: 'manifest_refresh',
        server: next,
        status: 'error',
        method: 'tools/list,resources/list,prompts/list,initialize',
        error,
        detail: 'refresh_failed',
      })
      throwIfAborted(options.signal)
      return next
    }
    const enabledToolNames = new Set(server.tools.filter((tool) => tool.enabled).map((tool) => tool.name))
    const next = patchServer(server, {
      version: discovery.version,
      status: 'connected',
      lastError: undefined,
      manifestCachedAt: dependencies.now(),
      manifestExpiresAt: discovery.ttlMs === undefined ? undefined
        : dependencies.now() + Math.max(0, Math.min(discovery.ttlMs, server.manifestTtlMs || MCP_CATALOG_DEFAULT_TTL_MS)),
      tools: [...normalizeMcpTools(discovery.tools, { serverId: server.id, enabledToolNames }).items],
      resources: normalizeResources(discovery.resources, server.id),
      prompts: normalizePrompts(discovery.prompts, server.id),
      updatedAt: dependencies.now(),
    })
    // Persistence/conflict failures are not connection failures and cannot
    // rewrite a newer configuration, approval or deletion with stale results.
    await upsertServer(next, { ...options, expectedServer: baseline })
    await dependencies.logOperation({
      phase: 'manifest_refresh',
      server: next,
      status: 'done',
      method: 'tools/list,resources/list,prompts/list,initialize',
      resultCount: discovery.tools.length + discovery.resources.length + discovery.prompts.length,
    })
    throwIfAborted(options.signal)
    return next
  }

  return {
    listServers,
    saveServers,
    upsertServer,
    removeServer,
    refreshManifest,
    needsManifestRefresh(server) {
      if (server.id === dependencies.builtinServerId) return false
      if (!server.manifestCachedAt) return true
      if (server.manifestExpiresAt !== undefined && dependencies.now() >= server.manifestExpiresAt) return true
      return dependencies.now() - server.manifestCachedAt >= (
        server.manifestTtlMs || MCP_CATALOG_DEFAULT_TTL_MS
      )
    },
  }
}

function normalizeResources(items: readonly unknown[], serverId: string): McpCatalogResource[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const value = item as Record<string, unknown>
    if (typeof value.uri !== 'string') return null
    return {
      uri: value.uri,
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
      serverId,
    }
  }).filter(isResource)
}

function normalizePrompts(items: readonly unknown[], serverId: string): McpCatalogPrompt[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const value = item as Record<string, unknown>
    if (typeof value.name !== 'string') return null
    return {
      name: value.name,
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(Array.isArray(value.arguments) ? { arguments: value.arguments as Record<string, unknown>[] } : {}),
      serverId,
    }
  }).filter(isPrompt)
}

function patchServer<TServer extends McpCatalogServer>(
  server: TServer,
  patch: Partial<McpCatalogServer>,
): TServer {
  return { ...server, ...patch } as TServer
}

function isServer<TServer extends McpCatalogServer>(server: TServer | null): server is TServer {
  return server !== null
}

function isResource(resource: McpCatalogResource | null): resource is McpCatalogResource {
  return resource !== null
}

function isPrompt(prompt: McpCatalogPrompt | null): prompt is McpCatalogPrompt {
  return prompt !== null
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
