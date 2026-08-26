import type { ReasoningEffort } from '@/core'
import type { AIModel, AIProvider } from '@/types/providerContracts'

export interface OpenAICompatibleThinkingRequestLike {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  messages?: {
    role: 'user' | 'assistant' | 'tool'
    reasoningContent?: string
  }[]
}

export interface OpenAICompatibleThinkingPolicyDependencies {
  resolveModelConfig(model: string, provider: AIProvider): AIModel
  isDashScopeThinkingModel(provider: AIProvider, model: string): boolean
  isDeepSeekThinkingModel(provider: AIProvider, model: string): boolean
  isKimiThinkingModel(provider: AIProvider, model: string): boolean
  isMiniMaxThinkingModel(provider: AIProvider, model: string): boolean
  isSiliconFlowReasoningModel(provider: AIProvider, model: string): boolean
  isModelScopeProvider(provider: AIProvider): boolean
  isSiliconFlowProvider(provider: AIProvider): boolean
  reasoningExplicitlyDeclaredForModel(provider: AIProvider, modelConfig: AIModel): boolean
  reasoningCanBeSentForProvider(
    provider: AIProvider,
    capability: 'reasoning',
    explicitDeclaration?: boolean,
  ): boolean
}

export interface OpenAICompatibleThinkingPolicy {
  normalizeDeepSeekThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { type: 'enabled' | 'disabled'; effort?: 'high' | 'max' } | undefined
  normalizeDashScopeThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { enabled: boolean; budget?: number } | undefined
  normalizeSiliconFlowThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { budget: number } | undefined
  normalizeKimiThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { type: 'enabled' | 'disabled' } | undefined
  normalizeKimiPreservedThinking(
    request: OpenAICompatibleThinkingRequestLike,
    thinking: { type: 'enabled' | 'disabled' } | undefined,
  ): { type: 'enabled'; keep: 'all' } | undefined
  isKimiSamplingLocked(request: OpenAICompatibleThinkingRequestLike): boolean
  normalizeMiniMaxThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { type: 'adaptive' | 'disabled' } | undefined
  shouldRequestMiniMaxReasoningSplit(
    request: OpenAICompatibleThinkingRequestLike,
    thinking: { type: 'adaptive' | 'disabled' } | undefined,
  ): boolean
}

export function createOpenAICompatibleThinkingPolicy(
  dependencies: OpenAICompatibleThinkingPolicyDependencies,
): OpenAICompatibleThinkingPolicy {
  function providerReasoningCanBeSent(
    request: OpenAICompatibleThinkingRequestLike,
    modelConfig: AIModel,
  ): boolean {
    const explicitDeclaration = dependencies.reasoningExplicitlyDeclaredForModel(
      request.provider,
      modelConfig,
    )
    return dependencies.reasoningCanBeSentForProvider(
      request.provider,
      'reasoning',
      explicitDeclaration,
    )
  }

  function normalizeDeepSeekThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { type: 'enabled' | 'disabled'; effort?: 'high' | 'max' } | undefined {
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    if (!providerReasoningCanBeSent(request, modelConfig)) return undefined
    if (
      modelConfig.reasoningMode !== 'deepseek-thinking' &&
      !dependencies.isDeepSeekThinkingModel(request.provider, request.model)
    ) {
      return undefined
    }
    const effort = request.reasoningEffort ?? 'medium'
    if (effort === 'none' || effort === 'minimal') return { type: 'disabled' }
    return {
      type: 'enabled',
      effort: effort === 'xhigh' || effort === 'max' ? 'max' : 'high',
    }
  }

  function normalizeDashScopeThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { enabled: boolean; budget?: number } | undefined {
    if (dependencies.isSiliconFlowProvider(request.provider)) return undefined
    if (dependencies.isModelScopeProvider(request.provider)) return undefined
    if (!request.reasoningEffort) return undefined
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    if (!providerReasoningCanBeSent(request, modelConfig)) return undefined
    if (
      modelConfig.reasoningMode !== 'dashscope-thinking' &&
      !dependencies.isDashScopeThinkingModel(request.provider, request.model)
    ) {
      return undefined
    }
    if (request.reasoningEffort === 'none' || request.reasoningEffort === 'minimal') {
      return { enabled: false }
    }
    return {
      enabled: true,
      budget: normalizeDashScopeThinkingBudget(request.model, request.reasoningEffort),
    }
  }

  function normalizeSiliconFlowThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { budget: number } | undefined {
    if (!request.reasoningEffort) return undefined
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    if (!providerReasoningCanBeSent(request, modelConfig)) return undefined
    if (
      modelConfig.reasoningMode !== 'siliconflow-thinking-budget' &&
      !dependencies.isSiliconFlowReasoningModel(request.provider, request.model)
    ) {
      return undefined
    }
    if (request.reasoningEffort === 'none' || request.reasoningEffort === 'minimal') {
      return undefined
    }
    return { budget: normalizeSiliconFlowThinkingBudget(request.reasoningEffort) }
  }

  function normalizeKimiThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { type: 'enabled' | 'disabled' } | undefined {
    if (!request.reasoningEffort) return undefined
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    if (!providerReasoningCanBeSent(request, modelConfig)) return undefined
    if (
      modelConfig.reasoningMode !== 'kimi-thinking' &&
      !dependencies.isKimiThinkingModel(request.provider, request.model)
    ) {
      return undefined
    }
    return {
      type:
        request.reasoningEffort === 'none' || request.reasoningEffort === 'minimal'
          ? 'disabled'
          : 'enabled',
    }
  }

  function normalizeKimiPreservedThinking(
    request: OpenAICompatibleThinkingRequestLike,
    thinking: { type: 'enabled' | 'disabled' } | undefined,
  ): { type: 'enabled'; keep: 'all' } | undefined {
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    if (!providerReasoningCanBeSent(request, modelConfig)) return undefined
    if (!dependencies.isKimiThinkingModel(request.provider, request.model)) return undefined
    if (
      !request.messages?.some(
        (message) =>
          message.role === 'assistant' &&
          typeof message.reasoningContent === 'string' &&
          message.reasoningContent.trim(),
      )
    ) {
      return undefined
    }
    if (thinking?.type === 'disabled') return undefined
    return { type: 'enabled', keep: 'all' }
  }

  function isKimiSamplingLocked(request: OpenAICompatibleThinkingRequestLike): boolean {
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    if (!providerReasoningCanBeSent(request, modelConfig)) return false
    return (
      modelConfig.reasoningMode === 'kimi-thinking' ||
      dependencies.isKimiThinkingModel(request.provider, request.model) ||
      (modelConfig.reasoningMode === 'openai-effort' &&
        (request.provider.presetId === 'moonshot' || request.provider.detectedPresetId === 'moonshot'))
    )
  }

  function normalizeMiniMaxThinking(
    request: OpenAICompatibleThinkingRequestLike,
  ): { type: 'adaptive' | 'disabled' } | undefined {
    if (!request.reasoningEffort) return undefined
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    if (!providerReasoningCanBeSent(request, modelConfig)) return undefined
    if (
      modelConfig.reasoningMode !== 'minimax-thinking' ||
      !dependencies.isMiniMaxThinkingModel(request.provider, request.model)
    ) {
      return undefined
    }
    return {
      type:
        request.reasoningEffort === 'none' || request.reasoningEffort === 'minimal'
          ? 'disabled'
          : 'adaptive',
    }
  }

  function shouldRequestMiniMaxReasoningSplit(
    request: OpenAICompatibleThinkingRequestLike,
    thinking: { type: 'adaptive' | 'disabled' } | undefined,
  ): boolean {
    const modelConfig = dependencies.resolveModelConfig(request.model, request.provider)
    return (
      providerReasoningCanBeSent(request, modelConfig) &&
      request.provider.wireProtocol !== 'anthropic-compatible' &&
      dependencies.isMiniMaxThinkingModel(request.provider, request.model) &&
      thinking?.type !== 'disabled'
    )
  }

  return {
    normalizeDeepSeekThinking,
    normalizeDashScopeThinking,
    normalizeSiliconFlowThinking,
    normalizeKimiThinking,
    normalizeKimiPreservedThinking,
    isKimiSamplingLocked,
    normalizeMiniMaxThinking,
    shouldRequestMiniMaxReasoningSplit,
  }
}

export function normalizeDashScopeThinkingBudget(
  modelId: string,
  effort: ReasoningEffort,
): number {
  const maxBudget = getDashScopeThinkingBudgetMax(modelId)
  if (effort === 'low') return Math.min(maxBudget, 8192)
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return maxBudget
  return Math.min(maxBudget, 65536)
}

export function normalizeSiliconFlowThinkingBudget(effort: ReasoningEffort): number {
  if (effort === 'low') return 1024
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 8192
  return 4096
}

function getDashScopeThinkingBudgetMax(modelId: string): number {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  if (/^qwen3\.7(?:-|$)/.test(normalized)) return 262144
  if (/^qwen3\.6-(?:flash|max-preview)(?:-|$)/.test(normalized)) return 131072
  if (/^qwen3\.6-plus(?:-|$)/.test(normalized)) return 81920
  if (/^qwen3\.5(?:-|$)/.test(normalized)) return 81920
  return 8192
}
