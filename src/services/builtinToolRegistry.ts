import type { McpToolManifest, ProcessTrace, ToolContentBlock } from '@/types'
import { searchExternalWeb } from '@/services/searchAdapters'
import { executeAppAction, type AppActionName } from '@/services/appActionPolicy'
import { st } from '@/i18n/service'

export const BUILTIN_SERVER_ID = 'islemind-builtins'

export interface BuiltinToolCallResult {
  ok: boolean
  content: ToolContentBlock[]
  trace: ProcessTrace
  error?: string
}

interface BuiltinToolDefinition {
  name: string
  description: string
  permission: McpToolManifest['permission']
  inputSchema?: Record<string, unknown>
  action?: AppActionName
}

const BUILTIN_TOOLS: BuiltinToolDefinition[] = [
  {
    name: 'app_info',
    description: 'Read IsleMind app/runtime information.',
    permission: 'read-only',
  },
  {
    name: 'search_web',
    description: 'Search configured web provider adapters.',
    permission: 'read-only',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_settings',
    description: 'Read current IsleMind app settings that are safe to show in chat.',
    permission: 'read-only',
    action: 'get_settings',
  },
  {
    name: 'set_theme_mode',
    description: 'Set theme mode to light, dark, or system.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['light', 'dark', 'system'] },
      },
      required: ['mode'],
    },
    action: 'set_theme_mode',
  },
  {
    name: 'set_theme_family',
    description: 'Set theme family to minimal, glass, or cartoon. Legacy island requests map to cartoon.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: {
        themeId: { type: 'string', enum: ['minimal', 'glass', 'cartoon', 'island'] },
      },
      required: ['themeId'],
    },
    action: 'set_theme_family',
  },
  {
    name: 'set_language',
    description: 'Set app language to zh-CN, en, or ja.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['zh-CN', 'en', 'ja'] },
      },
      required: ['language'],
    },
    action: 'set_language',
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
    action: 'set_feature_flag',
  },
]

export function listBuiltinToolManifests(): McpToolManifest[] {
  return BUILTIN_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    permission: tool.permission,
    serverId: BUILTIN_SERVER_ID,
    enabled: true,
  }))
}

export async function callBuiltinTool(toolName: string, args: Record<string, unknown>, startedAt: number): Promise<BuiltinToolCallResult> {
  if (toolName === 'app_info') {
    const content = [{ type: 'text' as const, text: 'IsleMind mobile runtime. MCP stdio is disabled; Streamable HTTP/SSE is supported for user-configured servers.' }]
    return { ok: true, content, trace: completeBuiltinTrace('app-info', 'MCP app_info', content[0].text, startedAt) }
  }

  if (toolName === 'search_web') {
    const query = typeof args.query === 'string' ? args.query : ''
    const limit = typeof args.limit === 'number' ? args.limit : 5
    const result = await searchExternalWeb(query, limit)
    const content = truncateBuiltinToolBlocks(result.sources.map((source) => ({
      type: 'text' as const,
      text: `${source.title}\n${source.url ?? ''}\n${source.excerpt ?? source.content}`,
    })))
    const hasOutput = content.some((block) => block.type === 'text' && (block.text ?? '').trim())
    if (!result.ok || !hasOutput) {
      const message = result.message || st('search.noResults')
      return {
        ok: false,
        content: [{ type: 'text', text: message }],
        error: message,
        trace: completeBuiltinTrace('search', 'MCP search_web', message, startedAt, {
          count: result.sources.length,
          mode: result.mode,
          code: result.code ?? 'no_output',
        }, 'error'),
      }
    }
    return {
      ok: true,
      content,
      trace: completeBuiltinTrace('search', 'MCP search_web', result.message, startedAt, { count: result.sources.length, mode: result.mode }),
    }
  }

  const definition = BUILTIN_TOOLS.find((tool) => tool.name === toolName)
  if (definition?.action) {
    return await executeAppAction({ name: definition.action, arguments: args, source: 'builtin-tool' })
  }

  return failureTrace(toolName, st('mcpRuntime.unknownBuiltinTool'), startedAt)
}

function truncateBuiltinToolBlocks(blocks: ToolContentBlock[], tokenBudget = 1200): ToolContentBlock[] {
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

function completeBuiltinTrace(idPart: string, title: string, content: string, startedAt: number, metadata?: Record<string, unknown>, status: ProcessTrace['status'] = 'done'): ProcessTrace {
  const completedAt = Date.now()
  return {
    id: `mcp-builtin-${idPart}-${startedAt}`,
    type: 'tool',
    title,
    content,
    status,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    metadata,
  }
}

function failureTrace(toolName: string, message: string, startedAt: number, status: ProcessTrace['status'] = 'error'): BuiltinToolCallResult {
  const completedAt = Date.now()
  return {
    ok: false,
    content: [{ type: 'text', text: message }],
    error: message,
    trace: {
      id: `mcp-builtin-failed-${toolName}-${startedAt}`,
      type: 'tool',
      title: `MCP ${toolName}`,
      content: message,
      status,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    },
  }
}
