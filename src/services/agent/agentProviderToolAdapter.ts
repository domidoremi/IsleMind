import type { ProviderType, ProviderWireProtocol } from '@/types'
import type { AgentToolManifest, AgentToolPermission, AgentToolSource } from '@/services/agent/agentToolTypes'
import { redactSensitiveText, sanitizeTraceMetadataValue } from '@/utils/traceSafety'

export type AgentProviderToolTarget = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google'

export interface ResolveAgentProviderToolTargetOptions {
  preferredEndpoint?: 'chat' | 'responses'
  assumeOpenAICompatibleTools?: boolean
  wireProtocol?: ProviderWireProtocol
}

export interface BuildAgentProviderToolAdapterInput {
  manifests: AgentToolManifest[]
  target: AgentProviderToolTarget
  permissionCeiling?: AgentToolPermission
  maxTools?: number
}

export interface AgentProviderToolNameMapEntry {
  providerName: string
  toolId: string
  toolName: string
  source: AgentToolSource
  permission: AgentToolPermission
  serverId?: string
}

export interface AgentProviderToolSkipped {
  toolId: string
  toolName: string
  reason: 'disabled' | 'permission-ceiling' | 'max-tools'
}

export interface AgentProviderToolAdapterResult {
  target: AgentProviderToolTarget
  tools: unknown[]
  toolNameMap: AgentProviderToolNameMapEntry[]
  skipped: AgentProviderToolSkipped[]
}

interface ProviderToolDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
  manifest: AgentToolManifest
}

const PROVIDER_TOOL_NAME_LIMIT = 64
const PROVIDER_TOOL_DESCRIPTION_LIMIT = 1024
const PROVIDER_TOOL_SCHEMA_CHAR_LIMIT = 6000
const DEFAULT_PROVIDER_TOOL_LIMIT = 64

export function resolveAgentProviderToolTarget(
  providerType: ProviderType,
  options: ResolveAgentProviderToolTargetOptions = {}
): AgentProviderToolTarget | undefined {
  if (providerType === 'openai') return options.preferredEndpoint === 'responses' ? 'openai-responses' : 'openai-chat'
  if (providerType === 'anthropic') return 'anthropic'
  if (providerType === 'google') return 'google'
  if (providerType === 'xiaomi-mimo') return options.wireProtocol === 'anthropic-compatible' ? 'anthropic' : 'openai-chat'
  if (providerType === 'openai-compatible' && options.assumeOpenAICompatibleTools) {
    return options.preferredEndpoint === 'responses' ? 'openai-responses' : 'openai-chat'
  }
  return undefined
}

export function buildAgentProviderToolAdapter(
  input: BuildAgentProviderToolAdapterInput
): AgentProviderToolAdapterResult {
  const permissionCeiling = input.permissionCeiling ?? 'read-write'
  const maxTools = Math.max(0, Math.floor(input.maxTools ?? DEFAULT_PROVIDER_TOOL_LIMIT))
  const usedNames = new Set<string>()
  const declarations: ProviderToolDeclaration[] = []
  const toolNameMap: AgentProviderToolNameMapEntry[] = []
  const skipped: AgentProviderToolSkipped[] = []

  for (const manifest of input.manifests) {
    if (!manifest.enabled) {
      skipped.push(skippedTool(manifest, 'disabled'))
      continue
    }
    if (!permissionWithinCeiling(manifest.permission, permissionCeiling)) {
      skipped.push(skippedTool(manifest, 'permission-ceiling'))
      continue
    }
    if (declarations.length >= maxTools) {
      skipped.push(skippedTool(manifest, 'max-tools'))
      continue
    }
    const providerName = uniqueProviderToolName(manifest, usedNames)
    declarations.push({
      name: providerName,
      description: buildProviderToolDescription(manifest),
      parameters: sanitizeProviderToolSchema(manifest.inputSchema),
      manifest,
    })
    toolNameMap.push({
      providerName,
      toolId: manifest.id,
      toolName: manifest.name,
      source: manifest.source,
      permission: manifest.permission,
      ...(manifest.serverId ? { serverId: manifest.serverId } : {}),
    })
  }

  return {
    target: input.target,
    tools: buildProviderTools(input.target, declarations),
    toolNameMap,
    skipped,
  }
}

function buildProviderTools(target: AgentProviderToolTarget, tools: ProviderToolDeclaration[]): unknown[] {
  switch (target) {
    case 'openai-chat':
      return tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    case 'openai-responses':
      return tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }))
    case 'anthropic':
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }))
    case 'google':
      return tools.length
        ? [{
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          }]
        : []
  }
}

function skippedTool(manifest: AgentToolManifest, reason: AgentProviderToolSkipped['reason']): AgentProviderToolSkipped {
  return {
    toolId: manifest.id,
    toolName: manifest.name,
    reason,
  }
}

function uniqueProviderToolName(manifest: AgentToolManifest, usedNames: Set<string>): string {
  const base = sanitizeProviderToolName(manifest.name || manifest.id)
  if (!usedNames.has(base)) {
    usedNames.add(base)
    return base
  }
  const suffix = `_${hashString(manifest.id).toString(36)}`
  const truncated = base.slice(0, Math.max(1, PROVIDER_TOOL_NAME_LIMIT - suffix.length))
  const withSuffix = `${truncated}${suffix}`
  usedNames.add(withSuffix)
  return withSuffix
}

function sanitizeProviderToolName(value: string): string {
  const normalized = redactSensitiveText(value)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, PROVIDER_TOOL_NAME_LIMIT)
    .replace(/^_+|_+$/g, '')
  if (!normalized) return 'tool'
  return /^[A-Za-z_]/.test(normalized) ? normalized : `tool_${normalized}`.slice(0, PROVIDER_TOOL_NAME_LIMIT)
}

function buildProviderToolDescription(manifest: AgentToolManifest): string {
  const base = redactSensitiveText(manifest.description || manifest.name || manifest.id)
    .replace(/\s+/g, ' ')
    .trim()
  const permission = manifest.permission === 'destructive'
    ? 'Permission: destructive. Execution must pause for explicit visible user confirmation before any destructive action.'
    : manifest.permission === 'read-write'
      ? 'Permission: read-write. Execution must stay visible in IsleMind before state changes.'
      : 'Permission: read-only.'
  const source = [
    `Source: ${manifest.source}.`,
    manifest.serverName ? `Server: ${redactSensitiveText(manifest.serverName).trim()}.` : '',
    manifest.requiresRuntimeContext ? 'Requires IsleMind runtime context.' : '',
  ].filter(Boolean).join(' ')
  return clampText([base || 'IsleMind agent tool.', permission, source].filter(Boolean).join(' '), PROVIDER_TOOL_DESCRIPTION_LIMIT)
}

function sanitizeProviderToolSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const safeValue = sanitizeTraceMetadataValue(schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {})
  const safe = safeValue && typeof safeValue === 'object' && !Array.isArray(safeValue)
    ? { ...(safeValue as Record<string, unknown>) }
    : {}
  if (safe.type !== 'object') safe.type = 'object'
  if (!safe.properties || typeof safe.properties !== 'object' || Array.isArray(safe.properties)) safe.properties = {}
  if (JSON.stringify(safe).length <= PROVIDER_TOOL_SCHEMA_CHAR_LIMIT) return safe
  return {
    type: 'object',
    properties: {},
    additionalProperties: true,
    description: 'Original tool schema exceeded the provider declaration budget and was replaced by an open object schema.',
  }
}

function permissionWithinCeiling(permission: AgentToolPermission, ceiling: AgentToolPermission): boolean {
  return permissionRank(permission) <= permissionRank(ceiling)
}

function permissionRank(permission: AgentToolPermission): number {
  if (permission === 'destructive') return 2
  if (permission === 'read-write') return 1
  return 0
}

function clampText(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit).trimEnd() : value
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
