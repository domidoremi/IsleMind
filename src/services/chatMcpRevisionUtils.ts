import type { ProviderRuntimeChatRequest } from '@/modules/providers'
import type { McpToolRequest, ResolvedMcpConversationTool } from '@/modules/integrations'
import { stripMcpCallBlocks } from '@/services/chatToolResultUtils'
import type { McpServerConfig } from '@/types/mcpContracts'

type ResolvedMcpTool = ResolvedMcpConversationTool<McpServerConfig>
export function buildMcpToolRevisionSystemPrompt(systemPrompt: string): string {
  return [
    systemPrompt,
    '你正在根据 MCP 工具结果生成最终回复。不要暴露工具请求 JSON；只基于工具输出和已有上下文回答用户。如果工具失败，请明确说明失败状态和可继续的下一步。',
  ].filter(Boolean).join('\n\n')
}

export function buildMcpToolRevisionMessages(input: {
  messages: ProviderRuntimeChatRequest['messages']
  firstOutput: string
  request: McpToolRequest
  tool: ResolvedMcpTool
  toolOutput: string
  ok: boolean
}): ProviderRuntimeChatRequest['messages'] {
  return [
    ...input.messages,
    { role: 'assistant', content: stripMcpCallBlocks(input.firstOutput) },
    {
      role: 'user',
      content: [
        `MCP 工具：${input.tool.server.name}/${input.tool.tool.name}`,
        `调用状态：${input.ok ? 'ok' : 'failed'}`,
        `请求参数：${JSON.stringify(input.request.arguments)}`,
        '',
        '工具输出：',
        input.toolOutput,
        '',
        '请生成最终回复。',
      ].join('\n'),
    },
  ]
}
