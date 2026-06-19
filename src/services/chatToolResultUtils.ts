import type { ChatCompletionResult } from '@/services/ai/base'
import type { McpToolRequest } from '@/services/mcpToolRequest'
import { MCP_TOOL_CALL_TAG } from '@/services/mcpToolRequest'
import { stripAgentToolRequestBlocks, redactSensitiveText } from '@/services/agent'
import { stripProviderTextToolCallBlocks } from '@/services/ai/providerToolCalls'
import type { McpServerConfig, McpToolManifest, ToolContentBlock } from '@/types'
import { resolveMcpToolIdentity } from '@/services/chatMcpToolIdentityUtils'

export interface ResolvedMcpToolLike {
  server: Pick<McpServerConfig, 'id' | 'name'>
  tool: Pick<McpToolManifest, 'name'>
}

export function stringifyToolArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args)
  } catch {
    return '{}'
  }
}

export function stripMcpCallBlocks(output: string): string {
  return stripProviderTextToolCallBlocks(stripAgentToolRequestBlocks(output, MCP_TOOL_CALL_TAG))
}

export function sanitizeToolRevisionAnswerText(output: string): string {
  return redactSensitiveText(stripMcpCallBlocks(output)).trim()
}

export function findMcpTool<T extends ResolvedMcpToolLike>(tools: T[], request: McpToolRequest): T | undefined {
  return resolveMcpToolIdentity(tools, request)
}

export function formatToolBlocks(blocks: ToolContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text ?? ''
    if (block.type === 'resource') return [block.uri, block.text].filter(Boolean).join('\n')
    if (block.type === 'image') return block.mimeType ? `[image:${block.mimeType}]` : '[image]'
    return ''
  }).filter(Boolean).join('\n\n')
}

export function mergeUsage(base: ChatCompletionResult['usage'], extra: ChatCompletionResult['usage']): ChatCompletionResult['usage'] {
  if (!base) return extra
  if (!extra) return base
  return {
    source: base.source === 'provider' && extra.source === 'provider' ? 'provider' : 'estimated',
    inputTokens: addOptionalNumbers(base.inputTokens, extra.inputTokens),
    outputTokens: addOptionalNumbers(base.outputTokens, extra.outputTokens),
    reasoningTokens: addOptionalNumbers(base.reasoningTokens, extra.reasoningTokens),
    totalTokens: addOptionalNumbers(base.totalTokens, extra.totalTokens) ?? addOptionalNumbers(addOptionalNumbers(base.inputTokens, base.outputTokens), addOptionalNumbers(extra.inputTokens, extra.outputTokens)),
  }
}

export function addOptionalNumbers(a?: number, b?: number): number | undefined {
  if (typeof a !== 'number') return b
  if (typeof b !== 'number') return a
  return a + b
}
