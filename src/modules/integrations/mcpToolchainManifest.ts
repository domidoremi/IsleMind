import { sanitizeMcpToolReference } from './toolchainManifestAdmission'
import { isLocalNetworkHost, normalizeScopeHost } from './scopePolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

const MCP_SERVER_LIMIT = 24
const MCP_TOOL_LIMIT = 80
const MCP_INPUT_LIMIT = 24
const TEXT_LIMIT = 420

export type McpToolchainPermission =
  | 'context.read'
  | 'files.read'
  | 'files.write'
  | 'network.local'
  | 'network.remote'
  | 'task.run'
  | 'task.cancel'
  | 'mcp.approve'
  | 'secrets.use'
  | 'git.commit'
  | 'git.push'
  | 'release.publish'

export type McpToolchainRuntimeCapability =
  | 'app-action'
  | 'cli'
  | 'mcp-gateway'
  | 'skills'
  | 'workflow'
  | 'context.read'
  | 'files.read'
  | 'files.write'
  | 'network.local'
  | 'network.remote'
  | 'task.run'
  | 'task.cancel'
  | 'logs.stream'
  | 'secrets'
  | 'git'
  | 'background-tasks'

export type McpToolchainRuntimeKind = 'android-app' | 'termux' | 'desktop' | 'remote'
export type McpToolchainRuntimeSupport = 'supported' | 'unsupported' | 'requires-companion'
export type McpToolchainTransport = 'stdio' | 'streamable-http' | 'http'

export interface McpToolchainRuntimeSupportMap extends Record<McpToolchainRuntimeKind, McpToolchainRuntimeSupport> {}

export interface McpToolchainManifest<TSchema extends string = string> {
  schema: TSchema
  id: string
  title: string
  kind: 'mcp'
  version: string
  description?: string
  runtimes: McpToolchainRuntimeSupportMap
  permissions: McpToolchainPermission[]
  entry: {
    type: 'mcp'
    executor: 'mcp'
    mcpToolName?: string
    transport: Extract<McpToolchainTransport, 'streamable-http' | 'http'>
    endpoint: string
  }
  requires: {
    capabilities: McpToolchainRuntimeCapability[]
    memoryMb: number
  }
  inputs?: Record<string, { type: 'string' | 'number' | 'boolean' | 'json'; required: boolean }>
  outputs: { result: { type: 'json' }; logs: { type: 'log' } }
  diagnosticHint: string
}

export interface McpToolchainToolInput {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  permission: string
  enabled: boolean
}

export interface McpToolchainServerInput {
  id: string
  name: string
  url: string
  transport: string
  enabled: boolean
  version?: string
  tools: McpToolchainToolInput[]
}

export interface McpToolchainManifestDependencies<TSchema extends string> {
  manifestSchema: TSchema
  createRuntimeSupport(
    input: Partial<Record<McpToolchainRuntimeKind, McpToolchainRuntimeSupport>>,
  ): McpToolchainRuntimeSupportMap
  stableIdentityHash(input: unknown): string
  sanitizeEndpointReference(input: unknown): string | undefined
  sanitizePayloadKey(input: unknown): string | undefined
  sanitizePublicText(input: unknown): string | undefined
}

export interface McpToolchainManifestAssembly<TSchema extends string> {
  createToolchainManifestFromMcpTool(
    server: McpToolchainServerInput,
    tool: McpToolchainToolInput,
  ): McpToolchainManifest<TSchema> | undefined
  createToolchainManifestsFromMcpServers(
    servers: readonly McpToolchainServerInput[],
  ): McpToolchainManifest<TSchema>[]
}

export function createMcpToolchainManifestAssembly<TSchema extends string>(
  dependencies: McpToolchainManifestDependencies<TSchema>,
): McpToolchainManifestAssembly<TSchema> {
  function createToolchainManifestFromMcpTool(
    server: McpToolchainServerInput,
    tool: McpToolchainToolInput,
  ): McpToolchainManifest<TSchema> | undefined {
    const endpoint = dependencies.sanitizeEndpointReference(server?.url)
    const transport = mapMcpTransport(server?.transport)
    if (!endpoint || !transport || server?.enabled !== true || tool?.enabled !== true) return undefined
    const serverToken = mcpTokenSource(server.id) ?? mcpTokenSource(server.name) ?? 'mcp-server'
    const toolToken = mcpTokenSource(tool.name)
    if (!toolToken) return undefined
    const networkPermission = resolveEndpointNetworkPermission(endpoint)
    return {
      schema: dependencies.manifestSchema,
      id: `islemind.mcp.${serverToken}.${toolToken}-${dependencies.stableIdentityHash({
        serverId: cleanText(server.id),
        toolName: cleanText(tool.name),
        endpoint,
        transport,
      })}`.slice(0, 128).replace(/[-.:]+$/g, ''),
      title: createMcpToolTitle(server.name, tool.name, dependencies.sanitizePublicText),
      kind: 'mcp',
      version: sanitizeMcpToolVersion(server.version),
      description: dependencies.sanitizePublicText(tool.description),
      runtimes: dependencies.createRuntimeSupport(networkPermission === 'network.local'
        ? { termux: 'supported', desktop: 'supported' }
        : { desktop: 'supported', remote: 'supported' }),
      permissions: createMcpToolPermissions(networkPermission, tool.permission),
      entry: {
        type: 'mcp',
        executor: 'mcp',
        mcpToolName: sanitizeMcpToolReference(tool.name),
        transport,
        endpoint,
      },
      requires: {
        capabilities: createMcpToolCapabilities(networkPermission),
        memoryMb: 128,
      },
      inputs: createMcpInputSchema(tool.inputSchema, dependencies.sanitizePayloadKey),
      outputs: { result: { type: 'json' }, logs: { type: 'log' } },
      diagnosticHint: tool.permission === 'destructive'
        ? 'Destructive MCP tools require visible approval before the paired runtime calls the server.'
        : 'MCP tools run through a paired runtime gateway; Android does not host MCP stdio.',
    }
  }

  function createToolchainManifestsFromMcpServers(
    servers: readonly McpToolchainServerInput[],
  ): McpToolchainManifest<TSchema>[] {
    if (!Array.isArray(servers)) return []
    const manifests: McpToolchainManifest<TSchema>[] = []
    for (const server of servers.slice(0, MCP_SERVER_LIMIT)) {
      if (!server || typeof server !== 'object' || !Array.isArray(server.tools)) continue
      for (const tool of server.tools.slice(0, MCP_TOOL_LIMIT)) {
        const manifest = createToolchainManifestFromMcpTool(server, tool)
        if (manifest) manifests.push(manifest)
      }
    }
    return manifests.slice(0, MCP_TOOL_LIMIT)
  }

  return {
    createToolchainManifestFromMcpTool,
    createToolchainManifestsFromMcpServers,
  }
}

function createMcpToolPermissions(
  networkPermission: Extract<McpToolchainPermission, 'network.local' | 'network.remote'>,
  permission: string,
): McpToolchainPermission[] {
  const permissions: McpToolchainPermission[] = [networkPermission, 'task.run']
  if (permission === 'destructive') permissions.push('mcp.approve')
  return permissions
}

function createMcpToolCapabilities(
  networkPermission: Extract<McpToolchainPermission, 'network.local' | 'network.remote'>,
): McpToolchainRuntimeCapability[] {
  return ['mcp-gateway', networkPermission, 'task.run']
}

function mapMcpTransport(transport: string | undefined): Extract<McpToolchainTransport, 'streamable-http' | 'http'> | undefined {
  if (transport === 'streamable-http') return 'streamable-http'
  if (transport === 'sse') return 'http'
  return undefined
}

function resolveEndpointNetworkPermission(
  endpoint: string,
): Extract<McpToolchainPermission, 'network.local' | 'network.remote'> {
  try {
    const host = normalizeScopeHost(new URL(endpoint).hostname)
    return host && isLocalNetworkHost(host) ? 'network.local' : 'network.remote'
  } catch {
    return 'network.remote'
  }
}

function createMcpToolTitle(
  serverName: unknown,
  toolName: unknown,
  sanitizePublicText: (input: unknown) => string | undefined,
): string {
  return [sanitizePublicText(serverName), sanitizePublicText(toolName)].filter(Boolean).join(': ') || 'MCP Tool'
}

function createMcpInputSchema(
  inputSchema: unknown,
  sanitizePayloadKey: (input: unknown) => string | undefined,
): McpToolchainManifest['inputs'] | undefined {
  const record = asRecord(inputSchema)
  const properties = asRecord(record?.properties)
  if (!properties) return undefined
  const required = Array.isArray(record?.required)
    ? new Set(record.required.filter((item): item is string => typeof item === 'string' && item.trim() === item))
    : new Set<string>()
  const entries = Object.entries(properties).slice(0, MCP_INPUT_LIMIT).flatMap(([key, value]) => {
    const safeKey = sanitizePayloadKey(key)
    const property = asRecord(value)
    if (!safeKey || !property) return []
    return [[safeKey, { type: mapMcpJsonSchemaType(property.type), required: required.has(key) }] as const]
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function mapMcpJsonSchemaType(type: unknown): 'string' | 'number' | 'boolean' | 'json' {
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'object' || type === 'array') return 'json'
  return 'string'
}

function sanitizeMcpToolVersion(input: unknown): string {
  const version = cleanText(input)
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) && !isUnsafeRuntimePairingText(version)
    ? version
    : '1.0.0'
}

function mcpTokenSource(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input || !input || isUnsafeRuntimePairingText(input)) return undefined
  const token = cleanTaskItemToken(input).toLowerCase()
  if (!token || token !== input.toLowerCase() || isUnsafeRuntimePairingText(token)) return undefined
  return token.slice(0, 48).replace(/[-.:]+$/g, '') || undefined
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

function cleanTaskItemToken(input: string | undefined): string {
  return cleanText(input).replace(/[^a-z0-9_.:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 128).replace(/^-+|-+$/g, '')
}
