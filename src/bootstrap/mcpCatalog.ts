import type { McpServerConfig } from '@/types/mcpContracts'
import {
  readApplicationDataRecord,
  writeApplicationDataRecord,
} from '@/bootstrap/applicationDataRecords'
import { createVNextTaskRuntime } from '@/bootstrap/vnextTaskRuntime'
import {
  createBuiltInCapabilityRuntimeBinding,
  createBuiltInCapabilityTaskAdmissionPort,
  type BuiltInCapabilityRuntimeBinding,
} from '@/bootstrap/builtInCapabilityRuntime'
import {
  builtInWorkspaceFileReadPort,
  builtInWritableWorkspaceFilePort,
} from '@/bootstrap/builtInWorkspaceFileRuntime'
import { androidTrustedWebFetchPorts } from '@/bootstrap/androidTrustedWebFetch'
import { createTavilyRemoteWebCrawlPort } from '@/bootstrap/tavilyRemoteWebCrawl'
import { builtInWebSearchPort } from '@/bootstrap/webSearchProviderRuntime'
import {
  BUILT_IN_CAPABILITY_SERVER_ID,
  createBuiltInCapabilityToolManifests,
  mergeBuiltInCapabilityToolDescriptors,
  listApplicationBuiltInToolDescriptors,
  createMcpCatalogPolicy,
  createMcpClientAdapter,
  MCP_CATALOG_DEFAULT_TTL_MS,
  type ExternalToolDescriptor,
  type McpCatalogOperationOptions,
  isAllowedMcpServerUrl,
  normalizeMcpServerUrl,
} from '@/modules/integrations'
import { logMcpOperation } from '@/services/runtimeHealthLog'
import { st } from '@/i18n/service'

/** Shared MCP client binding keeps catalog reconciliation and tool execution on the same sessions. */
export const mcpClient = createMcpClientAdapter()

const builtInTaskLookupRuntime = createVNextTaskRuntime({
  async evaluate() {
    return { outcome: 'denied', reasonCode: 'lookup_only' }
  },
})

const builtInCapabilityRuntime: BuiltInCapabilityRuntimeBinding = createBuiltInCapabilityRuntimeBinding({
  admission: createBuiltInCapabilityTaskAdmissionPort((taskId) => builtInTaskLookupRuntime.getTask(taskId)),
  webSearch: builtInWebSearchPort,
  ...androidTrustedWebFetchPorts,
  remoteWebCrawl: createTavilyRemoteWebCrawlPort(),
  workspaceFileRead: builtInWorkspaceFileReadPort,
  ...(builtInWritableWorkspaceFilePort ? { workspaceFiles: builtInWritableWorkspaceFilePort } : {}),
})

export const BUILTIN_SERVER_ID = BUILT_IN_CAPABILITY_SERVER_ID

export function resolveBuiltInCapabilityAdapter(toolId: string) {
  return builtInCapabilityRuntime.resolveAdapter(toolId)
}

export function listBuiltinToolDescriptors(): readonly ExternalToolDescriptor[] {
  const merged = mergeBuiltInCapabilityToolDescriptors(listApplicationBuiltInToolDescriptors(), {
    enabledToolNames: builtInCapabilityRuntime.enabledToolNames,
  })
  const targetByName = new Map(
    createBuiltInCapabilityToolManifests({
      enabledToolNames: builtInCapabilityRuntime.enabledToolNames,
    }).map((manifest) => [manifest.name, manifest] as const),
  )
  return merged.map((descriptor) => {
    const target = targetByName.get(descriptor.name)
    return target ? { ...descriptor, enabled: target.enabled } : descriptor
  })
}

export function listBuiltinToolManifests() {
  const descriptors = listBuiltinToolDescriptors()
  return descriptors.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    permission: tool.permission,
    serverId: BUILTIN_SERVER_ID,
    enabled: tool.enabled,
  }))
}

/** Concrete built-in catalog entry; its manifest is rebuilt from the active registry on every read. */
export function builtinMcpServer(): McpServerConfig {
  const now = Date.now()
  const tools = listBuiltinToolManifests()
  return {
    id: BUILTIN_SERVER_ID,
    name: 'IsleMind',
    url: 'islemind://builtin',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    version: '1',
    manifestTtlMs: MCP_CATALOG_DEFAULT_TTL_MS,
    manifestCachedAt: now,
    approvedToolNames: tools.filter((tool) => tool.enabled).map((tool) => tool.name),
    tools,
    resources: [],
    prompts: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** Application composition for persisted MCP catalog and remote-session lifecycle. */
export const mcpCatalog = createMcpCatalogPolicy<McpServerConfig>({
  builtinServerId: BUILTIN_SERVER_ID,
  loadServers: async (options) => {
    throwIfAborted(options?.signal)
    const servers = await readApplicationDataRecord<McpServerConfig[]>('MCP_SERVERS')
    throwIfAborted(options?.signal)
    return servers
  },
  saveServers: async (servers, options) => {
    throwIfAborted(options?.signal)
    await writeApplicationDataRecord('MCP_SERVERS', servers)
  },
  builtinServer: builtinMcpServer,
  discover: (server, options) => mcpClient.discover(server, options),
  invalidateSession: (server) => mcpClient.invalidate(server),
  reconcileSessions: (servers) => mcpClient.reconcile(servers),
  normalizeServerUrl: normalizeMcpServerUrl,
  isAllowedServerUrl: isAllowedMcpServerUrl,
  explicitHttpOnlyErrorText: () => st('mcpRuntime.explicitHttpOnly'),
  logOperation: logMcpOperation,
  now: Date.now,
})

export const listMcpServers = (options?: McpCatalogOperationOptions) => mcpCatalog.listServers(options)
export const saveMcpServers = (servers: McpServerConfig[], options?: McpCatalogOperationOptions) =>
  mcpCatalog.saveServers(servers, options)
export const upsertMcpServer = (server: McpServerConfig, options?: McpCatalogOperationOptions) =>
  mcpCatalog.upsertServer(server, options)
export const removeMcpServer = (serverId: string, options?: McpCatalogOperationOptions) =>
  mcpCatalog.removeServer(serverId, options)
export const refreshMcpManifest = (server: McpServerConfig, options?: McpCatalogOperationOptions) =>
  mcpCatalog.refreshManifest(server, options)
export const needsMcpManifestRefresh = (server: McpServerConfig) => mcpCatalog.needsManifestRefresh(server)

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
