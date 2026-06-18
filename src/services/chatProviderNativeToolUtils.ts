import type { AIModel, AIProvider, ProcessTrace } from '@/types'
import type { ChatCompletionResult, ChatRequest, ContentPart, ProviderToolCall } from '@/services/ai/base'
import {
  buildAgentToolCallTraceMetadata,
  clampAgentOutput,
  redactSensitiveText,
  type AgentProviderToolAdapterResult,
  type AgentProviderToolNameMapEntry,
} from '@/services/agent'
import { stringifyToolArguments, stripMcpCallBlocks } from '@/services/chatToolResultUtils'

export const PROVIDER_NATIVE_TOOL_OUTPUT_LIMIT = 4800
export const PROVIDER_NATIVE_TOOL_TRACE_OUTPUT_LIMIT = 1600

export interface ProviderNativeToolManifestContext {
  adapter: Pick<AgentProviderToolAdapterResult, 'target' | 'tools' | 'skipped'>
  limits: { maxToolCallsPerStep: number }
}

export interface BuildProviderNativeToolRevisionMessagesInput {
  provider: AIProvider
  messages: ChatRequest['messages']
  firstOutput: string
  firstReasoningContent?: string
  firstResponseItems?: ChatCompletionResult['responseItems']
  firstProviderContentBlocks?: ChatCompletionResult['providerContentBlocks']
  call: ProviderToolCall
  tool: AgentProviderToolNameMapEntry
  toolOutput: string
  ok: boolean
}

export function providerSupportsNativeTools(provider: AIProvider, modelConfig: AIModel): boolean {
  if (modelConfig.chatCompatible === false) return false
  if (modelConfig.supportsTools === false) return false
  if (modelConfig.supportsTools === true || provider.capabilities?.nativeTools === true) return true
  return provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google'
}

export function buildProviderNativeToolManifestTrace(
  context: ProviderNativeToolManifestContext,
  completeTrace: (trace: ProcessTrace) => ProcessTrace,
  traceId: (prefix: string) => string,
): ProcessTrace {
  return completeTrace({
    id: traceId('provider-tools'),
    type: 'tool',
    title: 'Provider native tools',
    content: `Declared ${context.adapter.tools.length} read-only IsleMind tools for ${context.adapter.target}.`,
    status: 'done',
    startedAt: Date.now(),
    metadata: {
      providerToolTarget: context.adapter.target,
      declaredToolCount: context.adapter.tools.length,
      skippedToolCount: context.adapter.skipped.length,
      permissionCeiling: 'read-only',
      maxToolCallsPerStep: context.limits.maxToolCallsPerStep,
    },
  })
}

export function safeProviderNativeToolText(
  value: string | undefined,
  fallback = '',
  limit = PROVIDER_NATIVE_TOOL_OUTPUT_LIMIT
): string {
  const text = typeof value === 'string' && value.trim() ? value : fallback
  return clampAgentOutput(redactSensitiveText(text), limit).trim()
}

export function findProviderToolNameMapEntry(
  map: AgentProviderToolNameMapEntry[],
  providerName: string
): AgentProviderToolNameMapEntry | undefined {
  return map.find((entry) => entry.providerName === providerName) ??
    map.find((entry) => entry.toolName === providerName)
}

export function buildProviderNativeToolTraceMetadata(input: {
  call: ProviderToolCall
  provider: AIProvider
  status: ProcessTrace['status']
  tool?: AgentProviderToolNameMapEntry
  errorCode?: string
  target?: AgentProviderToolAdapterResult['target']
  stepIndex?: number
  toolCallIndex?: number
  requestedToolCallCount?: number
  maxToolCallsPerStep?: number
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...buildAgentToolCallTraceMetadata({
      mode: 'native-provider',
      source: input.tool?.source ?? 'provider',
      toolName: input.tool?.toolName ?? input.call.name,
      toolId: input.tool?.toolId,
      serverId: input.tool?.serverId,
      permission: input.tool?.permission,
      status: input.status,
      errorCode: input.errorCode,
      providerType: input.provider.type,
    }),
    providerToolCallId: input.call.id,
    providerToolName: input.call.name,
    providerToolTarget: input.target,
    providerToolArgumentsComplete: input.call.argumentsComplete !== false,
  }
  if (typeof input.stepIndex === 'number') metadata.stepIndex = input.stepIndex
  if (typeof input.toolCallIndex === 'number') metadata.toolCallIndex = input.toolCallIndex
  if (typeof input.requestedToolCallCount === 'number') metadata.requestedToolCallCount = input.requestedToolCallCount
  if (typeof input.maxToolCallsPerStep === 'number') metadata.maxToolCallsPerStep = input.maxToolCallsPerStep
  return metadata
}

export function buildProviderNativeToolRevisionMessages(
  input: BuildProviderNativeToolRevisionMessagesInput,
  assistantContent: string
): ChatRequest['messages'] {
  if (usesOpenAICompatibleToolResultMessages(input.provider)) {
    const toolCallId = input.call.callId || input.call.id || `islemind-tool-${input.call.index ?? 0}`
    return [
      ...input.messages,
      {
        role: 'assistant',
        content: stripMcpCallBlocks(input.firstOutput).trim(),
        ...(input.firstReasoningContent ? { reasoningContent: input.firstReasoningContent } : {}),
        ...(input.firstResponseItems?.length ? { responseItems: input.firstResponseItems } : {}),
        toolCalls: [{
          ...input.call,
          id: input.call.id || toolCallId,
          callId: toolCallId,
          rawArguments: input.call.rawArguments ?? stringifyToolArguments(input.call.arguments),
        }],
      },
      {
        role: 'tool',
        name: input.call.name,
        toolCallId,
        content: input.toolOutput,
      },
    ]
  }

  if (usesAnthropicCompatibleToolResultMessages(input.provider)) {
    const toolUseId = input.call.id || `islemind-tool-${input.call.index ?? 0}`
    const assistantParts: ContentPart[] = []
    const assistantText = stripMcpCallBlocks(input.firstOutput).trim()
    if (assistantText) assistantParts.push({ type: 'text', text: assistantText })
    assistantParts.push({
      type: 'tool_use',
      text: '',
      toolUse: {
        id: toolUseId,
        name: input.call.name,
        input: input.call.arguments,
      },
    })
    return [
      ...input.messages,
      {
        role: 'assistant',
        content: assistantParts,
        ...(input.firstProviderContentBlocks?.length ? { providerContentBlocks: input.firstProviderContentBlocks } : {}),
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          text: '',
          toolResult: {
            tool_use_id: toolUseId,
            content: input.toolOutput,
            ...(input.ok ? {} : { is_error: true }),
          },
        }],
      },
    ]
  }

  if (input.provider.type !== 'google') {
    return [
      ...input.messages,
      { role: 'assistant', content: assistantContent },
      {
        role: 'user',
        content: [
          `IsleMind 工具：${input.tool.source}/${input.tool.toolName}`,
          '调用模式：native-provider',
          `调用状态：${input.ok ? 'ok' : 'failed'}`,
          `请求参数：${stringifyToolArguments(input.call.arguments)}`,
          '',
          '工具输出：',
          input.toolOutput,
          '',
          '请生成最终回复。',
        ].join('\n'),
      },
    ]
  }

  const assistantParts: ContentPart[] = []
  const assistantText = stripMcpCallBlocks(input.firstOutput).trim()
  if (assistantText) assistantParts.push({ type: 'text', text: assistantText })
  assistantParts.push({
    type: 'function_call',
    text: '',
    functionCall: {
      name: input.call.name,
      args: input.call.arguments,
    },
    ...(input.call.thoughtSignature ? { thoughtSignature: input.call.thoughtSignature } : {}),
  })

  return [
    ...input.messages,
    { role: 'assistant', content: assistantParts },
    {
      role: 'user',
      content: [{
        type: 'function_response',
        text: '',
        functionResponse: {
          name: input.call.name,
          response: {
            ok: input.ok,
            result: input.toolOutput,
          },
        },
      }],
    },
  ]
}

export function usesOpenAICompatibleToolResultMessages(provider: AIProvider): boolean {
  return (
    provider.type === 'openai' ||
    provider.type === 'openai-compatible' ||
    provider.type === 'xiaomi-mimo'
  ) && provider.wireProtocol !== 'anthropic-compatible'
}

export function usesAnthropicCompatibleToolResultMessages(provider: AIProvider): boolean {
  return provider.type === 'anthropic' || provider.wireProtocol === 'anthropic-compatible'
}
