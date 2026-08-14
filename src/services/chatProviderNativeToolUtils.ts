import type { AIModel, AIProvider } from '@/types/providerContracts'
import type { ProcessTrace } from '@/core'
import {
  createProviderToolCapabilityPolicy,
  type ProviderContentPart,
  type ProviderNativeToolSupportDecision,
  type ProviderNativeToolDeclarationResult,
  type ProviderNativeToolNameMapEntry,
  type ProviderRuntimeChatRequest,
  type ProviderRuntimeCompletionResult,
  type ProviderToolCall,
} from '@/modules/providers'
export type { ProviderNativeToolSupportDecision } from '@/modules/providers'
import {
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  resolveProviderCompatibilityCapabilityStatus,
} from '@/modules/providers'
import type { ConversationToolCatalogSource as ConversationToolSource } from '@/modules/integrations'
import {
  buildWorkflowToolCallTraceMetadata,
} from '@/bootstrap/workflowToolCallTrace'
import { clampTraceText, redactSensitiveText } from '@/core'
import { stringifyToolArguments, stripMcpCallBlocks } from '@/services/chatToolResultUtils'
export const PROVIDER_NATIVE_TOOL_OUTPUT_LIMIT = 4800
export const PROVIDER_NATIVE_TOOL_TRACE_OUTPUT_LIMIT = 1600

type AgentProviderToolDeclarationResult = ProviderNativeToolDeclarationResult<ConversationToolSource>
type AgentProviderToolNameMapEntry = ProviderNativeToolNameMapEntry<ConversationToolSource>

export interface ProviderNativeToolManifestContext {
  adapter: Pick<AgentProviderToolDeclarationResult, 'target' | 'tools' | 'skipped'>
  limits: { maxToolCallsPerStep: number }
}

export interface BuildProviderNativeToolRevisionMessagesInput {
  provider: AIProvider
  messages: ProviderRuntimeChatRequest['messages']
  firstOutput: string
  firstReasoningContent?: string
  firstResponseItems?: ProviderRuntimeCompletionResult['responseItems']
  firstProviderContentBlocks?: ProviderRuntimeCompletionResult['providerContentBlocks']
  call: ProviderToolCall
  tool: AgentProviderToolNameMapEntry
  toolOutput: string
  ok: boolean
}

const PROVIDER_TOOL_CAPABILITY_POLICY = createProviderToolCapabilityPolicy({
  compatibilityCapabilityCanBeSent(provider, capability, explicitDeclaration) {
    if (capability === 'audio') return false
    return providerCompatibilityCapabilityCanBeSentForProvider(provider, capability, explicitDeclaration)
  },
})
export function resolveProviderNativeToolSupport(provider: AIProvider, modelConfig: AIModel): ProviderNativeToolSupportDecision {
  const compatibility = getProviderCompatibilityEvidenceForProvider(provider)
  const toolsStatus = resolveProviderCompatibilityCapabilityStatus(compatibility.id, 'tools')
  return PROVIDER_TOOL_CAPABILITY_POLICY.resolveProviderNativeToolSupport(provider, modelConfig, {
    id: compatibility.id,
    auditState: compatibility.auditState,
    behaviorDocs: compatibility.behaviorDocs,
    toolsStatus,
  })
}

export function providerSupportsVisionInput(provider: AIProvider, modelConfig: AIModel): boolean {
  return PROVIDER_TOOL_CAPABILITY_POLICY.providerSupportsVisionInput(
    provider,
    modelConfig,
    getProviderCompatibilityEvidenceForProvider(provider).id,
  )
}

export function providerSupportsFileInput(provider: AIProvider, modelConfig: AIModel): boolean {
  return PROVIDER_TOOL_CAPABILITY_POLICY.providerSupportsFileInput(
    provider,
    modelConfig,
    getProviderCompatibilityEvidenceForProvider(provider).id,
  )
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

export function buildProviderNativeToolSkippedTrace(
  decision: ProviderNativeToolSupportDecision,
  completeTrace: (trace: ProcessTrace) => ProcessTrace,
  traceId: (prefix: string) => string,
): ProcessTrace {
  return completeTrace({
    id: traceId('provider-tools-skip'),
    type: 'tool',
    title: 'Provider native tools',
    content: providerNativeToolSkipContent(decision),
    status: 'skipped',
    startedAt: Date.now(),
    metadata: {
      providerToolReason: decision.reason,
      providerId: decision.providerId,
      providerType: decision.providerType,
      model: decision.modelId,
      compatibilityId: decision.compatibilityId,
      auditState: decision.auditState,
      behaviorDocs: decision.behaviorDocs,
      toolsStatus: decision.toolsStatus,
      explicitNativeTools: decision.explicitNativeTools,
      modelSupportsTools: decision.modelSupportsTools,
    },
  })
}

export function safeProviderNativeToolText(
  value: string | undefined,
  fallback = '',
  limit = PROVIDER_NATIVE_TOOL_OUTPUT_LIMIT
): string {
  const text = typeof value === 'string' && value.trim() ? value : fallback
  return clampTraceText(redactSensitiveText(text), limit).trim()
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
  target?: AgentProviderToolDeclarationResult['target']
  stepIndex?: number
  toolCallIndex?: number
  requestedToolCallCount?: number
  maxToolCallsPerStep?: number
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...buildWorkflowToolCallTraceMetadata({
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

function providerNativeToolSkipContent(decision: ProviderNativeToolSupportDecision): string {
  switch (decision.reason) {
    case 'blocked_contract_tools_unclaimed':
      return `Skipped provider-native IsleMind tool declarations because compatibility evidence ${decision.compatibilityId} does not claim tools.`
    case 'blocked_model_tools_disabled':
      return `Skipped provider-native IsleMind tool declarations because model ${decision.modelId} disables tools.`
    case 'blocked_model_chat_incompatible':
      return `Skipped provider-native IsleMind tool declarations because model ${decision.modelId} is not chat-compatible.`
    case 'blocked_model_tools_unclaimed':
      return `Skipped provider-native IsleMind tool declarations because model ${decision.modelId} does not claim tool support.`
    default:
      return 'Skipped provider-native IsleMind tool declarations for this request.'
  }
}

export function buildProviderNativeToolRevisionMessages(
  input: BuildProviderNativeToolRevisionMessagesInput,
  assistantContent: string
): ProviderRuntimeChatRequest['messages'] {
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
    const assistantParts: ProviderContentPart[] = []
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

  const assistantParts: ProviderContentPart[] = []
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
