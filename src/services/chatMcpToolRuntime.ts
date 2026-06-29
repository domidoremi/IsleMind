import type { AIProvider, Conversation, ProcessTrace } from '@/types'
import { streamChat, type ChatCompletionResult, type ChatRequest } from '@/services/ai/base'
import { buildAgentToolCallTraceMetadata } from '@/services/agent/agentToolCallTrace'
import type { ResolvedMcpTool } from '@/services/chatMcpContextUtils'
import { buildMcpToolRevisionMessages, buildMcpToolRevisionSystemPrompt } from '@/services/chatMcpRevisionUtils'
import { findMcpTool, formatToolBlocks, sanitizeToolRevisionAnswerText } from '@/services/chatToolResultUtils'
import { st } from '@/i18n/service'
import { callMcpTool, truncateToolBlocks } from '@/services/mcp'
import { parseMcpToolRequest, type McpToolRequest } from '@/services/mcpToolRequest'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { resolveConversationGenerationParameterRequest } from '@/services/ai/conversationGenerationParameters'

type TraceCompleter = (trace: ProcessTrace) => ProcessTrace
type TraceIdFactory = (prefix: string) => string

export interface ResolveMcpToolRevisionInput {
  conversationId: string
  assistantMessageId: string
  provider: AIProvider
  conversation: Conversation
  systemPrompt: string
  messages: ChatRequest['messages']
  baseContextPrompt: string
  firstOutput: string
  tools: ResolvedMcpTool[]
  signal: AbortSignal
  completeTrace: TraceCompleter
  traceId: TraceIdFactory
  upsertTrace: (trace: ProcessTrace) => void
}

export interface GenerateMcpToolRevisionAnswerInput {
  provider: AIProvider
  conversation: Conversation
  systemPrompt: string
  messages: ChatRequest['messages']
  baseContextPrompt: string
  firstOutput: string
  request: McpToolRequest
  tool: ResolvedMcpTool
  toolOutput: string
  ok: boolean
  signal: AbortSignal
}

export async function resolveMcpToolRevision(
  input: ResolveMcpToolRevisionInput
): Promise<{ text: string; usage?: ChatCompletionResult['usage'] } | null> {
  const request = parseMcpToolRequest(input.firstOutput)
  if (!request) return null
  const resolved = findMcpTool(input.tools, request)
  if (!resolved) {
    input.upsertTrace(input.completeTrace({
      id: input.traceId('mcp-unmatched'),
      type: 'tool',
      title: st('chatRunner.trace.mcpToolRequestTitle'),
      content: st('chatRunner.trace.mcpToolUnavailable', { tool: request.toolName }),
      status: 'error',
      startedAt: Date.now(),
      metadata: {
        requestedTool: request.toolName,
        ...buildAgentToolCallTraceMetadata({
          mode: 'tagged-json-fallback',
          source: 'mcp',
          serverId: request.serverId,
          toolName: request.toolName,
          status: 'error',
          errorCode: 'tool_unavailable',
        }),
      },
    }))
    return { text: st('mcpRuntime.toolUnavailable', { tool: request.toolName }) }
  }

  input.upsertTrace({
    id: input.traceId('mcp-call-start'),
    type: 'tool',
    title: st('chatRunner.trace.mcpToolRequestTitle'),
    content: st('chatRunner.trace.mcpToolRequested', { server: resolved.server.name, tool: resolved.tool.name }),
    status: 'running',
    startedAt: Date.now(),
    metadata: {
      tool: resolved.tool.name,
      ...buildAgentToolCallTraceMetadata({
        mode: 'tagged-json-fallback',
        source: 'mcp',
        serverId: resolved.server.id,
        toolName: resolved.tool.name,
        permission: resolved.tool.permission,
        status: 'running',
      }),
    },
  })

  const result = await callMcpTool(resolved.server, resolved.tool.name, request.arguments, undefined, { signal: input.signal })
  input.upsertTrace(result.trace)
  if (input.signal.aborted) return null

  const blocks = truncateToolBlocks(result.content)
  const toolOutput = formatToolBlocks(blocks)
  if (!toolOutput.trim()) {
    return { text: result.error ?? st('mcpRuntime.emptyOutput') }
  }

  try {
    const revision = await generateAnswerWithMcpToolResult({
      provider: input.provider,
      conversation: input.conversation,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      baseContextPrompt: input.baseContextPrompt,
      firstOutput: input.firstOutput,
      request,
      tool: resolved,
      toolOutput,
      ok: result.ok,
      signal: input.signal,
    })
    if (revision.text.trim()) return revision
  } catch (error) {
    input.upsertTrace(input.completeTrace({
      id: input.traceId('mcp-revise-error'),
      type: 'tool',
      title: st('chatRunner.trace.mcpToolResultTitle'),
      content: error instanceof Error ? error.message : st('mcpRuntime.callFailed'),
      status: 'error',
      startedAt: Date.now(),
      metadata: {
        tool: resolved.tool.name,
        ...buildAgentToolCallTraceMetadata({
          mode: 'tagged-json-fallback',
          source: 'mcp',
          serverId: resolved.server.id,
          toolName: resolved.tool.name,
          permission: resolved.tool.permission,
          status: 'error',
          errorCode: 'execution_failed',
        }),
      },
    }))
  }

  return {
    text: [
      st('chatRunner.trace.mcpToolResultTitle'),
      '',
      toolOutput,
    ].join('\n'),
  }
}

export async function generateAnswerWithMcpToolResult(
  input: GenerateMcpToolRevisionAnswerInput
): Promise<{ text: string; usage?: ChatCompletionResult['usage'] }> {
  let text = ''
  let usage: ChatCompletionResult['usage']
  let failure: Error | null = null
  const settings = useSettingsStore.getState().settings
  const requestParameters = resolveConversationGenerationParameterRequest({
    provider: input.provider,
    conversation: input.conversation,
    settings,
    model: resolveProviderModelAlias(input.provider, input.conversation.model),
    temperatureCap: 0.4,
  })
  const handle = await streamChat(
    {
      provider: input.provider,
      model: input.conversation.model,
      systemPrompt: buildMcpToolRevisionSystemPrompt(input.systemPrompt),
      messages: buildMcpToolRevisionMessages(input),
      contextPrompt: input.baseContextPrompt,
      temperature: requestParameters.temperature,
      topP: requestParameters.topP,
      topK: requestParameters.topK,
      reasoningEffort: input.conversation.reasoningEffort,
      maxTokens: requestParameters.maxTokens,
      stream: false,
      signal: input.signal,
      conversationId: input.conversation.id,
      sessionId: input.conversation.id,
      settings,
      remoteCompactEligible: false,
    },
    (chunk) => {
      text += chunk
    },
    (result) => {
      text = result.text || text
      usage = result.usage
    },
    (error) => {
      failure = error
    }
  )
  await handle.done
  if (failure) throw failure
  return { text: sanitizeToolRevisionAnswerText(text), usage }
}
