import type { McpServerConfig, McpToolManifest, McpToolPermission, ProcessTrace, ToolContentBlock } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { st } from '@/i18n/service'
import { redactSensitiveText } from '@/services/agent/agentTrace'
import { buildAgentToolCallTraceMetadata } from '@/services/agent/agentToolCallTrace'
import { BUILTIN_SERVER_ID, callBuiltinTool, listBuiltinToolManifests } from '@/services/builtinToolRegistry'
import { isAllowedMcpServerUrl, normalizeMcpServerUrl } from '@/services/mcpUrlPolicy'
import { logMcpOperation } from '@/services/runtimeHealthLog'

export interface McpCallResult {
  ok: boolean
  content: ToolContentBlock[]
  trace: ProcessTrace
  error?: string
}

export interface McpApprovalRequest {
  server: McpServerConfig
  tool: McpToolManifest
  arguments: Record<string, unknown>
}

export interface McpCallOptions {
  signal?: AbortSignal
}

type McpTraceErrorCode = 'tool_unavailable' | 'permission_required' | 'execution_failed' | 'cancelled'

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

export async function listMcpServers(): Promise<McpServerConfig[]> {
  const saved = await loadData<McpServerConfig[]>('MCP_SERVERS')
  return [builtinMcpServer(), ...(saved ?? []).map(normalizeServer).filter((server): server is McpServerConfig => !!server)]
}

export async function saveMcpServers(servers: McpServerConfig[]): Promise<void> {
  await saveData('MCP_SERVERS', servers.filter((server) => server.id !== BUILTIN_SERVER_ID).map(normalizeServer).filter(Boolean))
}

export async function upsertMcpServer(server: McpServerConfig): Promise<McpServerConfig> {
  const normalized = requireServer(server)
  const servers = await listMcpServers()
  const updated = [normalized, ...servers.filter((item) => item.id !== normalized.id && item.id !== BUILTIN_SERVER_ID)]
  await saveMcpServers(updated)
  return normalized
}

export async function refreshMcpManifest(server: McpServerConfig): Promise<McpServerConfig> {
  if (server.id === BUILTIN_SERVER_ID) return builtinMcpServer()
  if (!server.enabled) return { ...server, status: 'disconnected' }
  if (!isAllowedMcpServerUrl(server)) {
    const next = { ...server, status: 'error' as const, lastError: st('mcpRuntime.explicitHttpOnly'), updatedAt: Date.now() }
    await logMcpOperation({
      phase: 'manifest_refresh',
      server: next,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'non_http_server_url',
      error: new Error(next.lastError),
    })
    await saveMcpServers((await listMcpServers()).filter((item) => item.id !== server.id))
    return next
  }
  if (server.transport !== 'sse') {
    const next = { ...server, status: 'error' as const, lastError: 'WebSocket transport is reserved but not enabled in this build.' }
    await logMcpOperation({
      phase: 'manifest_refresh',
      server: next,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'unsupported_transport',
      error: new Error(next.lastError),
    })
    return next
  }
  try {
    const [tools, resources, prompts, version] = await Promise.all([
      callMcpList(server, 'tools/list'),
      callMcpList(server, 'resources/list'),
      callMcpList(server, 'prompts/list'),
      callMcpVersion(server),
    ])
    const next: McpServerConfig = {
      ...server,
      version,
      status: 'connected',
      lastError: undefined,
      manifestCachedAt: Date.now(),
      tools: normalizeTools(tools, server.id),
      resources: normalizeResources(resources, server.id),
      prompts: normalizePrompts(prompts, server.id),
      updatedAt: Date.now(),
    }
    await upsertMcpServer(next)
    await logMcpOperation({
      phase: 'manifest_refresh',
      server: next,
      status: 'done',
      method: 'tools/list,resources/list,prompts/list,initialize',
      resultCount: [tools, resources, prompts].reduce((sum, items) => sum + items.length, 0),
    })
    return next
  } catch (error) {
    const next = { ...server, status: 'error' as const, lastError: error instanceof Error ? error.message : 'MCP manifest refresh failed', updatedAt: Date.now() }
    await upsertMcpServer(next)
    await logMcpOperation({
      phase: 'manifest_refresh',
      server: next,
      status: 'error',
      method: 'tools/list,resources/list,prompts/list,initialize',
      error,
      detail: 'refresh_failed',
    })
    return next
  }
}

export function needsMcpManifestRefresh(server: McpServerConfig): boolean {
  if (server.id === BUILTIN_SERVER_ID) return false
  if (!server.manifestCachedAt) return true
  return Date.now() - server.manifestCachedAt > (server.manifestTtlMs || DEFAULT_TTL_MS)
}

export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown> = {},
  approve?: (request: McpApprovalRequest) => Promise<boolean>,
  options: McpCallOptions = {}
): Promise<McpCallResult> {
  const tool = server.tools.find((item) => item.name === toolName)
  const startedAt = Date.now()
  if (options.signal?.aborted) {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'cancelled',
      method: 'tools/call',
      reason: 'cancelled',
      detail: 'signal_already_aborted',
    })
    return cancelledTrace(server, toolName, tool, startedAt)
  }
  if (!server.enabled) {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool: tool && tool.enabled ? tool : undefined,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'server_disabled',
      method: 'tools/call',
    })
    return failureTrace(toolName, st('mcpRuntime.disconnected'), startedAt, 'skipped', mcpTraceMetadata(server, toolName, tool, 'tool_unavailable'))
  }
  if (!tool || !tool.enabled) {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'tool_disabled',
      method: 'tools/call',
    })
    return failureTrace(toolName, st('mcpRuntime.toolNotEnabled'), startedAt, 'skipped', mcpTraceMetadata(server, toolName, tool, 'tool_unavailable'))
  }
  if (!isAllowedMcpServerUrl(server)) {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'non_http_server_url',
      method: 'tools/call',
      error: new Error(st('mcpRuntime.explicitHttpOnly')),
    })
    return failureTrace(toolName, st('mcpRuntime.explicitHttpOnly'), startedAt, 'skipped', mcpTraceMetadata(server, toolName, tool, 'tool_unavailable'))
  }
  if (tool.permission === 'destructive') {
    if (options.signal?.aborted) {
      return cancelledTrace(server, toolName, tool, startedAt)
    }
    const confirmed = await approve?.({ server, tool, arguments: args })
    if (options.signal?.aborted) {
      return cancelledTrace(server, toolName, tool, startedAt)
    }
    if (!confirmed) {
      await logMcpOperation({
        phase: 'tool_call',
        server,
        tool,
        status: 'skipped',
        reason: 'permission_required',
        detail: 'approval_denied',
        method: 'tools/call',
      })
      return failureTrace(toolName, st('mcpRuntime.notApproved'), startedAt, 'skipped', mcpTraceMetadata(server, toolName, tool, 'permission_required'))
    }
  }
  try {
    if (options.signal?.aborted) {
      return cancelledTrace(server, toolName, tool, startedAt)
    }
    if (server.id === BUILTIN_SERVER_ID) {
      const result = await callBuiltinTool(toolName, args, startedAt)
      await logMcpOperation({
        phase: 'tool_call',
        server,
        tool,
        status: result.ok ? 'done' : 'error',
        method: 'tools/call',
        resultCount: result.content.length,
        reason: result.ok ? undefined : 'execution_failed',
        detail: result.error,
      })
      return options.signal?.aborted ? cancelledTrace(server, toolName, tool, startedAt) : sanitizeMcpCallResult(result)
    }
    if (server.status === 'disconnected' || server.status === 'error') {
      await logMcpOperation({
        phase: 'tool_call',
        server,
        tool,
        status: 'skipped',
        reason: 'tool_unavailable',
        detail: 'server_unavailable',
        method: 'tools/call',
      })
      return failureTrace(toolName, st('mcpRuntime.disconnected'), startedAt, 'skipped', mcpTraceMetadata(server, toolName, tool, 'tool_unavailable'))
    }
    const response = await postMcp(server, 'tools/call', { name: toolName, arguments: args }, options.signal)
    if (options.signal?.aborted) {
      return cancelledTrace(server, toolName, tool, startedAt)
    }
    const content = sanitizeToolContentBlocks(normalizeContentBlocks(response.content))
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'done',
      method: 'tools/call',
      resultCount: content.length,
    })
    return {
      ok: true,
      content,
      trace: completeTrace({
        id: `mcp-${server.id}-${toolName}-${startedAt}`,
        type: 'tool',
        title: `MCP ${toolName}`,
        content: summarizeBlocks(content),
        status: 'done',
        startedAt,
        metadata: mcpTraceMetadata(server, toolName, tool),
      }),
    }
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      await logMcpOperation({
        phase: 'tool_call',
        server,
        tool,
        status: 'cancelled',
        method: 'tools/call',
        reason: 'cancelled',
        error,
      })
      return cancelledTrace(server, toolName, tool, startedAt)
    }
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'error',
      method: 'tools/call',
      reason: 'execution_failed',
      error,
    })
    return failureTrace(toolName, error instanceof Error ? error.message : st('mcpRuntime.callFailed'), startedAt, 'error', mcpTraceMetadata(server, toolName, tool, 'execution_failed'))
  }
}

export function truncateToolBlocks(blocks: ToolContentBlock[], tokenBudget = 1200): ToolContentBlock[] {
  const charBudget = Math.max(200, tokenBudget * 4)
  let used = 0
  return blocks.map((block) => {
    if (block.type !== 'text' || !block.text) return block
    const safeText = redactSensitiveText(block.text)
    const remaining = Math.max(0, charBudget - used)
    used += Math.min(safeText.length, remaining)
    return {
      ...block,
      text: safeText.length > remaining ? `${safeText.slice(0, remaining)}\n${st('mcpRuntime.outputTruncated')}` : safeText,
    }
  })
}

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
    manifestTtlMs: DEFAULT_TTL_MS,
    manifestCachedAt: now,
    approvedToolNames: tools.map((tool) => tool.name),
    tools,
    resources: [],
    prompts: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function callMcpList(server: McpServerConfig, method: 'tools/list' | 'resources/list' | 'prompts/list'): Promise<unknown[]> {
  const response = await postMcp(server, method, {})
  const key = method.split('/')[0]
  const value = response[key]
  return Array.isArray(value) ? value : []
}

async function callMcpVersion(server: McpServerConfig): Promise<string | undefined> {
  try {
    const response = await postMcp(server, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'IsleMind', version: '1' } })
    return typeof response.serverInfo?.version === 'string' ? response.serverInfo.version : undefined
  } catch {
    return server.version
  }
}

async function postMcp(server: McpServerConfig, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, any>> {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, params }),
    signal,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`MCP ${method} failed: HTTP ${response.status}`)
  const payload = parseMcpResponse(text)
  if (payload.error) throw new Error(String(payload.error.message ?? payload.error.code ?? `MCP ${method} error`))
  return (payload.result && typeof payload.result === 'object') ? payload.result : {}
}

function parseMcpResponse(text: string): Record<string, any> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('data:')) {
    const dataLine = trimmed.split('\n').find((line) => line.startsWith('data:'))
    return dataLine ? JSON.parse(dataLine.replace(/^data:\s*/, '')) : {}
  }
  return JSON.parse(trimmed)
}

function normalizeTools(items: unknown[], serverId: string): McpToolManifest[] {
  return items.map((item): McpToolManifest | null => {
    if (!item || typeof item !== 'object') return null
    const value = item as Record<string, unknown>
    if (typeof value.name !== 'string') return null
    return {
      name: value.name,
      description: typeof value.description === 'string' ? value.description : undefined,
      inputSchema: value.inputSchema && typeof value.inputSchema === 'object' ? value.inputSchema as Record<string, unknown> : undefined,
      permission: inferPermission(value.name, value.description),
      serverId,
      enabled: false,
    }
  }).filter((item): item is McpToolManifest => !!item)
}

function normalizeResources(items: unknown[], serverId: string) {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return null
    const value = item as Record<string, unknown>
    if (typeof value.uri !== 'string') return null
    return {
      uri: value.uri,
      name: typeof value.name === 'string' ? value.name : undefined,
      description: typeof value.description === 'string' ? value.description : undefined,
      mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined,
      serverId,
    }
  }).filter(Boolean) as McpServerConfig['resources']
}

function normalizePrompts(items: unknown[], serverId: string) {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return null
    const value = item as Record<string, unknown>
    if (typeof value.name !== 'string') return null
    return {
      name: value.name,
      description: typeof value.description === 'string' ? value.description : undefined,
      arguments: Array.isArray(value.arguments) ? value.arguments as Record<string, unknown>[] : undefined,
      serverId,
    }
  }).filter(Boolean) as McpServerConfig['prompts']
}

function normalizeContentBlocks(value: unknown): ToolContentBlock[] {
  if (!Array.isArray(value)) {
    return typeof value === 'string' ? [{ type: 'text', text: value }] : []
  }
  return value.map((item): ToolContentBlock | null => {
    if (typeof item === 'string') return { type: 'text', text: item }
    if (!item || typeof item !== 'object') return null
    const block = item as Record<string, unknown>
    if (block.type === 'image') return { type: 'image', data: String(block.data ?? ''), mimeType: typeof block.mimeType === 'string' ? block.mimeType : undefined }
    if (block.type === 'resource') return { type: 'resource', uri: typeof block.uri === 'string' ? block.uri : undefined, text: typeof block.text === 'string' ? block.text : undefined, mimeType: typeof block.mimeType === 'string' ? block.mimeType : undefined }
    return { type: 'text', text: typeof block.text === 'string' ? block.text : JSON.stringify(block) }
  }).filter((item): item is ToolContentBlock => !!item)
}

function inferPermission(name: unknown, description: unknown): McpToolPermission {
  const text = `${String(name ?? '')} ${String(description ?? '')}`.toLowerCase()
  if (/(delete|remove|shell|exec|write_file|rm|drop|destroy|destructive)/.test(text)) return 'destructive'
  if (/(write|create|update|edit|post|upload|save)/.test(text)) return 'read-write'
  return 'read-only'
}

function normalizeServer(value: unknown): McpServerConfig | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<McpServerConfig>
  if (!item.id || !item.name || !item.url) return null
  const url = normalizeMcpServerUrl({ id: item.id, url: item.url })
  if (!url) return null
  const now = Date.now()
  return {
    id: item.id,
    name: item.name,
    url,
    transport: item.transport === 'websocket' ? 'websocket' : 'sse',
    enabled: !!item.enabled,
    status: item.status ?? 'disconnected',
    version: item.version,
    manifestTtlMs: item.manifestTtlMs ?? DEFAULT_TTL_MS,
    manifestCachedAt: item.manifestCachedAt,
    tools: item.tools ?? [],
    resources: item.resources ?? [],
    prompts: item.prompts ?? [],
    approvedToolNames: item.approvedToolNames ?? [],
    lastError: item.lastError,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  }
}

function requireServer(value: McpServerConfig): McpServerConfig {
  const server = normalizeServer(value)
  if (!server) throw new Error('Invalid MCP server')
  if (!isAllowedMcpServerUrl(server)) {
    throw new Error(st('mcpRuntime.explicitHttpOnly'))
  }
  return server
}

function summarizeBlocks(blocks: ToolContentBlock[]): string {
  return redactSensitiveText(blocks.map((block) => block.text || block.uri || block.name || block.type).join('\n')).slice(0, 1200)
}

function sanitizeMcpCallResult(result: McpCallResult): McpCallResult {
  return {
    ...result,
    content: sanitizeToolContentBlocks(result.content),
    error: result.error ? redactSensitiveText(result.error) : undefined,
    trace: sanitizeMcpTrace(result.trace),
  }
}

function sanitizeToolContentBlocks(blocks: ToolContentBlock[]): ToolContentBlock[] {
  return blocks.map((block) => ({
    ...block,
    text: block.text ? redactSensitiveText(block.text) : block.text,
    uri: block.uri ? redactSensitiveText(block.uri) : block.uri,
    name: block.name ? redactSensitiveText(block.name) : block.name,
  }))
}

function sanitizeMcpTrace(trace: ProcessTrace): ProcessTrace {
  return {
    ...trace,
    id: sanitizeTraceId(trace.id),
    title: redactSensitiveText(trace.title),
    content: trace.content ? redactSensitiveText(trace.content) : undefined,
    metadata: sanitizeMcpTraceMetadata(trace.metadata),
  }
}

function sanitizeTraceId(id: string): string {
  const redacted = redactSensitiveText(id)
  if (redacted === id) return id
  return redacted.replace(/\[redacted\]/g, 'redacted').replace(/[^A-Za-z0-9_.:-]+/g, '-')
}

function sanitizeMcpTraceMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    output[key] = sanitizeMcpTraceMetadataValue(value)
  }
  return output
}

function sanitizeMcpTraceMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(sanitizeMcpTraceMetadataValue)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sanitizeMcpTraceMetadataValue(child)
    }
    return output
  }
  return value
}

function mcpTraceMetadata(
  server: McpServerConfig,
  toolName: string,
  tool?: McpToolManifest,
  errorCode?: McpTraceErrorCode
): Record<string, unknown> {
  const source = server.id === BUILTIN_SERVER_ID ? 'builtin' : 'mcp'
  const cancellationMetadata = errorCode === 'cancelled'
    ? { status: 'cancelled', failureCode: 'cancelled' }
    : {}
  return {
    ...buildAgentToolCallTraceMetadata({
      mode: 'mcp-runtime',
      source,
      serverId: server.id,
      toolName,
      permission: tool?.permission,
      status: errorCode ? (errorCode === 'execution_failed' ? 'error' : 'skipped') : 'done',
      errorCode,
    }),
    serverId: server.id,
    toolName,
    source,
    permission: tool?.permission,
    connectionStatus: server.status,
    errorCode,
    ...cancellationMetadata,
  }
}

function cancelledTrace(server: McpServerConfig, toolName: string, tool: McpToolManifest | undefined, startedAt: number): McpCallResult {
  return failureTrace(toolName, st('mcpRuntime.cancelled'), startedAt, 'skipped', mcpTraceMetadata(server, toolName, tool, 'cancelled'))
}

function failureTrace(
  toolName: string,
  message: string,
  startedAt: number,
  status: ProcessTrace['status'] = 'error',
  metadata?: Record<string, unknown>
): McpCallResult {
  const safeMessage = redactSensitiveText(message)
  return {
    ok: false,
    content: [{ type: 'text', text: safeMessage }],
    error: safeMessage,
    trace: completeTrace({
      id: `mcp-failed-${sanitizeTraceId(toolName)}-${startedAt}`,
      type: 'tool',
      title: `MCP ${redactSensitiveText(toolName)}`,
      content: safeMessage,
      status,
      startedAt,
      metadata,
    }),
  }
}

function completeTrace(trace: ProcessTrace): ProcessTrace {
  const completedAt = Date.now()
  return sanitizeMcpTrace({ ...trace, completedAt, durationMs: completedAt - (trace.startedAt ?? completedAt) })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
