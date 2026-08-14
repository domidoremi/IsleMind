import type { ProviderRuntimeCompletionResult } from '@/modules/providers'
import {
  MCP_TOOL_CALL_TAG,
  resolveMcpConversationToolIdentity,
  type McpToolRequest,
} from '@/modules/integrations'
import { stripWorkflowToolRequestBlocks } from '@/bootstrap/workflowToolCallTrace'
import { redactSensitiveText } from '@/core'
import { stripProviderTextToolCallBlocks } from '@/modules/providers'
import type { McpServerConfig, McpToolManifest } from '@/types/mcpContracts'
import type { ToolContentBlock } from '@/core'
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
  return stripProviderTextToolCallBlocks(stripWorkflowToolRequestBlocks(output, MCP_TOOL_CALL_TAG))
}

export function sanitizeToolRevisionAnswerText(output: string): string {
  return redactSensitiveText(stripMcpCallBlocks(output)).trim()
}

export function findMcpTool<T extends ResolvedMcpToolLike>(tools: T[], request: McpToolRequest): T | undefined {
  return resolveMcpConversationToolIdentity(tools, request)
}

export function formatToolBlocks(blocks: ToolContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text ?? ''
    if (block.type === 'resource') return [block.uri, block.text].filter(Boolean).join('\n')
    if (block.type === 'image') return block.mimeType ? `[image:${block.mimeType}]` : '[image]'
    return ''
  }).filter(Boolean).join('\n\n')
}

export function mergeUsage(base: ProviderRuntimeCompletionResult['usage'], extra: ProviderRuntimeCompletionResult['usage']): ProviderRuntimeCompletionResult['usage'] {
  if (!base) return extra
  if (!extra) return base
  const cacheCreationInputTokens = addOptionalNumbers(base.cacheCreationInputTokens, extra.cacheCreationInputTokens)
  const cacheReadInputTokens = addOptionalNumbers(base.cacheReadInputTokens, extra.cacheReadInputTokens)
  const cachedInputTokens = addOptionalNumbers(base.cachedInputTokens, extra.cachedInputTokens)
  const reasoningTokens = addOptionalNumbers(base.reasoningTokens, extra.reasoningTokens)
  return {
    source: base.source === 'provider' && extra.source === 'provider' ? 'provider' : 'estimated',
    inputTokens: addOptionalNumbers(base.inputTokens, extra.inputTokens),
    outputTokens: addOptionalNumbers(base.outputTokens, extra.outputTokens),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    totalTokens: addOptionalNumbers(base.totalTokens, extra.totalTokens) ?? addOptionalNumbers(addOptionalNumbers(base.inputTokens, base.outputTokens), addOptionalNumbers(extra.inputTokens, extra.outputTokens)),
  }
}

export function addOptionalNumbers(a?: number, b?: number): number | undefined {
  if (typeof a !== 'number') return b
  if (typeof b !== 'number') return a
  return a + b
}
