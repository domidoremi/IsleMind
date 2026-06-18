import type { Conversation } from '@/types'
import { listMcpServers } from '@/services/mcp'
import { st } from '@/i18n/service'
import type { McpServerConfig, ProcessTrace } from '@/types'
import { selectEnabledMcpTools } from '@/services/chatMcpToolIdentityUtils'

export interface ResolvedMcpTool {
  server: McpServerConfig
  tool: McpServerConfig['tools'][number]
}

export interface McpContextResolution {
  prompt: string
  traces: ProcessTrace[]
  tools: ResolvedMcpTool[]
}

export function collectResolvedMcpTools(servers: McpServerConfig[], enabledTools: string[]): ResolvedMcpTool[] {
  const tools = servers
    .filter((server) => server.enabled)
    .flatMap((server) => server.tools.filter((tool) => tool.enabled).map((tool) => ({ server, tool })))
  return selectEnabledMcpTools(tools, enabledTools)
}

export function buildMcpContextPrompt(connected: ResolvedMcpTool[], toolCallTag: string): string {
  if (!connected.length) return ''
  return [
    '当前可用 MCP 工具清单。普通回答不需要调用工具时请直接回答。',
    `如果必须调用工具，请只输出一个 <${toolCallTag}>JSON</${toolCallTag}> 块，不要输出其它正文。`,
    'JSON 格式：{"serverId":"server-id","tool":"tool-name","arguments":{}}。',
    '工具执行后，系统会把工具结果交给你生成最终回复。',
    ...connected.map(({ server, tool }) => `- ${server.id}/${tool.name} (${server.name}) [${tool.permission}]: ${tool.description ?? 'No description'}${tool.inputSchema ? `\n  inputSchema: ${JSON.stringify(tool.inputSchema).slice(0, 600)}` : ''}`),
  ].join('\n')
}

export function buildMcpManifestTrace(
  connected: ResolvedMcpTool[],
  offline: ResolvedMcpTool[],
  startedAt: number,
  completeTrace: (trace: ProcessTrace) => ProcessTrace,
  traceId: (prefix: string) => string,
): ProcessTrace {
  return completeTrace({
    id: traceId('mcp-manifest'),
    type: 'tool',
    title: st('chatRunner.trace.mcpManifestTitle'),
    content: [
      connected.length ? st('chatRunner.trace.mcpConnectedTools', { count: connected.length, tools: connected.map((item) => `${item.server.name}/${item.tool.name}`).join(', ') }) : st('chatRunner.trace.mcpNoOnlineTools'),
      offline.length ? st('chatRunner.trace.mcpOfflineTools', { count: offline.length, tools: offline.map((item) => `${item.server.name}/${item.tool.name}`).join(', ') }) : '',
    ].filter(Boolean).join('\n'),
    status: connected.length ? 'done' : 'skipped',
    startedAt,
    metadata: { connected: connected.length, offline: offline.length },
  })
}

export async function resolveMcpContext(input: {
  conversation: Conversation
  mcpEnabled: boolean
  toolCallTag: string
  completeTrace: (trace: ProcessTrace) => ProcessTrace
  traceId: (prefix: string) => string
}): Promise<McpContextResolution> {
  const startedAt = Date.now()
  if (!input.mcpEnabled) {
    return {
      prompt: '',
      tools: [],
      traces: [input.completeTrace({
        id: input.traceId('mcp-disabled'),
        type: 'tool',
        title: st('chatRunner.trace.mcpTitle'),
        content: st('chatRunner.trace.mcpDisabled'),
        status: 'skipped',
        startedAt,
      })],
    }
  }
  const enabledTools = input.conversation.enabledTools ?? input.conversation.skillSnapshot?.enabledTools ?? []
  const servers = await listMcpServers()
  const selected = collectResolvedMcpTools(servers, enabledTools)
  if (!selected.length) {
    return {
      prompt: '',
      tools: [],
      traces: [input.completeTrace({
        id: input.traceId('mcp-empty'),
        type: 'tool',
        title: st('chatRunner.trace.mcpTitle'),
        content: st('chatRunner.trace.mcpNoTools'),
        status: 'skipped',
        startedAt,
      })],
    }
  }
  const connected = selected.filter((item) => item.server.status === 'connected')
  const offline = selected.filter((item) => item.server.status !== 'connected')
  return {
    prompt: buildMcpContextPrompt(connected, input.toolCallTag),
    tools: connected,
    traces: [buildMcpManifestTrace(connected, offline, startedAt, input.completeTrace, input.traceId)],
  }
}
