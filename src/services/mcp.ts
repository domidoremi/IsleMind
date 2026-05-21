import type { McpServerConfig, McpToolManifest, McpToolPermission, ProcessTrace, ToolContentBlock } from '@/types'
import { loadData, saveData } from '@/services/storage'
import { searchExternalWeb } from '@/services/searchAdapters'
import { st } from '@/i18n/service'

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

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const BUILTIN_SERVER_ID = 'islemind-builtins'

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
  if (server.transport !== 'sse') {
    return { ...server, status: 'error', lastError: 'WebSocket transport is reserved but not enabled in this build.' }
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
    return next
  } catch (error) {
    const next = { ...server, status: 'error' as const, lastError: error instanceof Error ? error.message : 'MCP manifest refresh failed', updatedAt: Date.now() }
    await upsertMcpServer(next)
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
  approve?: (request: McpApprovalRequest) => Promise<boolean>
): Promise<McpCallResult> {
  const tool = server.tools.find((item) => item.name === toolName)
  const startedAt = Date.now()
  if (!tool || !tool.enabled) return failureTrace(toolName, st('mcpRuntime.toolNotEnabled'), startedAt)
  if (tool.permission === 'destructive') {
    const confirmed = await approve?.({ server, tool, arguments: args })
    if (!confirmed) return failureTrace(toolName, st('mcpRuntime.notApproved'), startedAt, 'skipped')
  }
  try {
    if (server.id === BUILTIN_SERVER_ID) {
      return await callBuiltinTool(toolName, args, startedAt)
    }
    if (server.status === 'disconnected' || server.status === 'error') {
      return failureTrace(toolName, st('mcpRuntime.disconnected'), startedAt, 'skipped')
    }
    const response = await postMcp(server, 'tools/call', { name: toolName, arguments: args })
    const content = normalizeContentBlocks(response.content)
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
        metadata: { serverId: server.id, permission: tool.permission },
      }),
    }
  } catch (error) {
    return failureTrace(toolName, error instanceof Error ? error.message : st('mcpRuntime.callFailed'), startedAt)
  }
}

export function truncateToolBlocks(blocks: ToolContentBlock[], tokenBudget = 1200): ToolContentBlock[] {
  const charBudget = Math.max(200, tokenBudget * 4)
  let used = 0
  return blocks.map((block) => {
    if (block.type !== 'text' || !block.text) return block
    const remaining = Math.max(0, charBudget - used)
    used += Math.min(block.text.length, remaining)
    return {
      ...block,
      text: block.text.length > remaining ? `${block.text.slice(0, remaining)}\n${st('mcpRuntime.outputTruncated')}` : block.text,
    }
  })
}

export function builtinMcpServer(): McpServerConfig {
  const now = Date.now()
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
    approvedToolNames: ['app_info', 'search_web'],
    tools: [
      { name: 'app_info', description: 'Read IsleMind app/runtime information.', permission: 'read-only', serverId: BUILTIN_SERVER_ID, enabled: true },
      { name: 'search_web', description: 'Search configured web provider adapters.', permission: 'read-only', serverId: BUILTIN_SERVER_ID, enabled: true },
    ],
    resources: [],
    prompts: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function callBuiltinTool(toolName: string, args: Record<string, unknown>, startedAt: number): Promise<McpCallResult> {
  if (toolName === 'app_info') {
    const content = [{ type: 'text' as const, text: 'IsleMind mobile runtime. MCP stdio is disabled; Streamable HTTP/SSE is supported for user-configured servers.' }]
    return { ok: true, content, trace: completeTrace({ id: `mcp-builtin-app-info-${startedAt}`, type: 'tool', title: 'MCP app_info', content: content[0].text, status: 'done', startedAt }) }
  }
  if (toolName === 'search_web') {
    const query = typeof args.query === 'string' ? args.query : ''
    const limit = typeof args.limit === 'number' ? args.limit : 5
    const result = await searchExternalWeb(query, limit)
    const content = truncateToolBlocks(result.sources.map((source) => ({
      type: 'text' as const,
      text: `${source.title}\n${source.url ?? ''}\n${source.excerpt ?? source.content}`,
    })))
    return { ok: true, content, trace: completeTrace({ id: `mcp-builtin-search-${startedAt}`, type: 'tool', title: 'MCP search_web', content: result.message, status: 'done', startedAt, metadata: { count: result.sources.length, mode: result.mode } }) }
  }
  return failureTrace(toolName, st('mcpRuntime.unknownBuiltinTool'), startedAt)
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

async function postMcp(server: McpServerConfig, method: string, params: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, params }),
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
  const now = Date.now()
  return {
    id: item.id,
    name: item.name,
    url: item.url,
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
  if (!/^https?:\/\//i.test(server.url) && server.id !== BUILTIN_SERVER_ID) {
    throw new Error(st('mcpRuntime.explicitHttpOnly'))
  }
  return server
}

function summarizeBlocks(blocks: ToolContentBlock[]): string {
  return blocks.map((block) => block.text || block.uri || block.name || block.type).join('\n').slice(0, 1200)
}

function failureTrace(toolName: string, message: string, startedAt: number, status: ProcessTrace['status'] = 'error'): McpCallResult {
  return {
    ok: false,
    content: [{ type: 'text', text: message }],
    error: message,
    trace: completeTrace({
      id: `mcp-failed-${toolName}-${startedAt}`,
      type: 'tool',
      title: `MCP ${toolName}`,
      content: message,
      status,
      startedAt,
    }),
  }
}

function completeTrace(trace: ProcessTrace): ProcessTrace {
  const completedAt = Date.now()
  return { ...trace, completedAt, durationMs: completedAt - (trace.startedAt ?? completedAt) }
}
