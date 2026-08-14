import type { IntegrationSource } from './contracts'
import {
  annotateManifestExecutionPolicy,
  type ManifestOutputBoundary,
  type ManifestRiskLevel,
} from './toolPermissionPolicy'
import { createServerToolManifests, type ExternalToolDescriptor } from './toolManifest'

export type ConversationToolCatalogSource = IntegrationSource | 'app-action' | 'rag' | 'search' | 'work-artifact'

export interface ConversationToolCatalogManifest {
  id: string
  source: ConversationToolCatalogSource
  name: string
  description: string
  permission: 'read-only' | 'read-write' | 'destructive'
  riskLevel?: ManifestRiskLevel
  requiresConfirmation?: boolean
  outputBoundary?: ManifestOutputBoundary
  inputSchema?: Record<string, unknown>
  enabled: boolean
  serverId?: string
  serverName?: string
  requiresRuntimeContext?: boolean
  metadata?: Record<string, unknown>
}

export interface ConversationToolCatalogServer {
  id: string
  name: string
  transport?: string
  status: string
  enabled: boolean
  tools: readonly ExternalToolDescriptor[]
}

export interface AppActionToolDescriptor {
  name: string
  description: string
  permission: ConversationToolCatalogManifest['permission']
  inputSchema?: Record<string, unknown>
}

export interface ConversationToolCatalogSourcePorts {
  builtinServerId: string
  listMcpServers(): Promise<readonly ConversationToolCatalogServer[]>
  getBuiltinServer(): ConversationToolCatalogServer
  listBuiltinTools(): readonly ExternalToolDescriptor[]
  listAppActionTools(): readonly AppActionToolDescriptor[]
  listAndroidTools(): readonly ConversationToolCatalogManifest[]
}

export interface ListConversationToolCatalogOptions {
  includeMcp?: boolean
  includeBuiltins?: boolean
  includeAppActions?: boolean
  includeInternalTools?: boolean
  includeAndroidTools?: boolean
  internalTools?: readonly ConversationToolCatalogManifest[]
}

export const APPLICATION_BUILT_IN_APP_INFO_TEXT = 'IsleMind mobile runtime. MCP stdio is disabled; Streamable HTTP/SSE is supported for user-configured servers.'

const APPLICATION_BUILT_IN_APP_INFO_DESCRIPTOR: ExternalToolDescriptor = {
  name: 'app_info',
  description: 'Read IsleMind app/runtime information.',
  permission: 'read-only',
  enabled: true,
}

const APP_ACTION_TOOLS: readonly AppActionToolDescriptor[] = [
  {
    name: 'get_settings',
    description: 'Read a human-readable IsleMind system capability and settings summary that is safe to show in chat.',
    permission: 'read-only',
  },
  {
    name: 'set_theme_mode',
    description: 'Set theme mode to light, dark, or system.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['light', 'dark', 'system'] } },
      required: ['mode'],
    },
  },
  {
    name: 'set_theme_family',
    description: 'Set theme family to minimal, lime-road, or markdown. Legacy cartoon/island requests map to lime-road and glass requests map to markdown.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: { themeId: { type: 'string', enum: ['minimal', 'lime-road', 'markdown', 'cartoon', 'glass', 'island'] } },
      required: ['themeId'],
    },
  },
  {
    name: 'set_theme_accent',
    description: 'Set or reset the shared application accent color using a 3- or 6-digit hexadecimal color.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: {
        color: { type: 'string', description: 'Hex color such as #4963A6, or default to restore the family accent.' },
      },
      required: ['color'],
    },
  },
  {
    name: 'set_language',
    description: 'Set app language to zh-CN, en, or ja.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['zh-CN', 'en', 'ja'] } },
      required: ['language'],
    },
  },
  {
    name: 'set_feature_flag',
    description: 'Enable or disable a safe reversible app feature flag.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: {
        flag: {
          type: 'string',
          enum: ['memory', 'knowledge', 'web_search', 'skills', 'mcp', 'command_palette', 'haptics'],
        },
        enabled: { type: 'boolean' },
      },
      required: ['flag', 'enabled'],
    },
  },
]

export function listAppActionToolDescriptors(): readonly AppActionToolDescriptor[] {
  return APP_ACTION_TOOLS.map(cloneAppActionToolDescriptor)
}

export function listApplicationBuiltInToolDescriptors(): readonly ExternalToolDescriptor[] {
  return [
    cloneExternalToolDescriptor(APPLICATION_BUILT_IN_APP_INFO_DESCRIPTOR),
    ...APP_ACTION_TOOLS.map((descriptor) => ({
      ...cloneAppActionToolDescriptor(descriptor),
      enabled: true,
    })),
  ]
}

export async function listConversationToolCatalog(
  sources: ConversationToolCatalogSourcePorts,
  options: ListConversationToolCatalogOptions = {},
): Promise<ConversationToolCatalogManifest[]> {
  const manifests: ConversationToolCatalogManifest[] = []

  if (options.includeMcp ?? true) {
    const servers = await sources.listMcpServers()
    for (const server of servers) {
      if (server.id === sources.builtinServerId) continue
      manifests.push(...fromServer(server, 'mcp'))
    }
  }

  if (options.includeBuiltins ?? true) {
    manifests.push(...fromServer({
      ...sources.getBuiltinServer(),
      tools: sources.listBuiltinTools(),
    }, 'builtin'))
  }

  // Settings actions are part of the canonical IsleMind built-in server. The
  // former app-action aliases made the same executor addressable by two IDs,
  // so model-visible catalogs now publish only builtin:<server>:<action>.

  if (options.includeInternalTools ?? true) {
    manifests.push(...(options.internalTools ?? []).map((tool) => ({ ...tool })))
  }

  if (options.includeAndroidTools ?? true) {
    manifests.push(...sources.listAndroidTools())
  }

  return annotateCatalog(manifests)
}

export function listStaticConversationToolCatalog(
  sources: ConversationToolCatalogSourcePorts,
  internalTools: readonly ConversationToolCatalogManifest[] = [],
): ConversationToolCatalogManifest[] {
  const manifests: ConversationToolCatalogManifest[] = [
    ...fromServer({
      ...sources.getBuiltinServer(),
      tools: sources.listBuiltinTools(),
    }, 'builtin'),
    ...internalTools.map((tool) => ({ ...tool })),
    ...sources.listAndroidTools(),
  ]
  return annotateCatalog(manifests)
}

function fromServer(
  server: ConversationToolCatalogServer,
  source: Extract<IntegrationSource, 'mcp' | 'builtin'>,
): ConversationToolCatalogManifest[] {
  return createServerToolManifests({
    source,
    serverId: server.id,
    serverName: server.name,
    transport: server.transport,
    status: server.status,
    enabled: server.enabled,
    tools: server.tools,
  })
}

function annotateCatalog(
  manifests: readonly ConversationToolCatalogManifest[],
): ConversationToolCatalogManifest[] {
  return manifests.map((manifest) => annotateManifestExecutionPolicy(manifest))
}

function cloneAppActionToolDescriptor(input: AppActionToolDescriptor): AppActionToolDescriptor {
  return {
    ...input,
    ...(input.inputSchema ? { inputSchema: cloneInputSchema(input.inputSchema) } : {}),
  }
}

function cloneExternalToolDescriptor(input: ExternalToolDescriptor): ExternalToolDescriptor {
  return {
    ...input,
    ...(input.inputSchema ? { inputSchema: cloneInputSchema(input.inputSchema) } : {}),
  }
}

function cloneInputSchema(input: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>
}
