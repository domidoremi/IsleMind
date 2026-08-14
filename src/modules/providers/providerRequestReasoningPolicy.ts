import type { AIProvider } from '@/types/providerContracts'
import type { AnthropicRequestReasoningPolicy } from './providerAnthropicRequest'
import type { OpenAIChatReasoningPolicy } from './providerOpenAIChatRequest'
import type { OpenAIResponsesReasoningPolicy } from './providerOpenAIResponsesRequest'
import type { ProviderResolvedRequestParameters } from './providerRequestParameterPolicy'

export interface ProviderRequestReasoningRequest {
  provider: AIProvider
  model: string
}

export function createProviderRequestReasoningPolicy<Request extends ProviderRequestReasoningRequest>(dependencies: {
  normalizeDeepSeekThinking(request: Request): OpenAIChatReasoningPolicy['deepSeekThinking']
  normalizeDashScopeThinking(request: Request): OpenAIChatReasoningPolicy['dashScopeThinking']
  normalizeSiliconFlowThinking(request: Request): OpenAIChatReasoningPolicy['siliconFlowThinking']
  normalizeKimiThinking(request: Request): OpenAIChatReasoningPolicy['kimiThinking']
  normalizeKimiPreservedThinking(request: Request, thinking: OpenAIChatReasoningPolicy['kimiThinking']): OpenAIChatReasoningPolicy['kimiPreservedThinking']
  normalizeMiniMaxThinking(request: Request): OpenAIChatReasoningPolicy['miniMaxThinking']
  shouldRequestMiniMaxReasoningSplit(request: Request, thinking: OpenAIChatReasoningPolicy['miniMaxThinking']): boolean
  normalizeOpenAIReasoningEffort(request: Request): string | undefined
  normalizeXiaomiMimoThinking(request: Request): OpenAIChatReasoningPolicy['mimoThinking']
  isKimiSamplingLocked(request: Request): boolean
  isXiaomiMimoThinkingActive(request: Request): boolean
  normalizeAnthropicThinking(request: Request): AnthropicRequestReasoningPolicy['thinkingConfig']
  modelDisallowsAnthropicSampling(model: string): boolean
  normalizeGoogleThinkingConfig(request: Request): Record<string, unknown> | undefined
  buildOpenAIResponsesReasoning(effort: string | undefined, provider: AIProvider): OpenAIResponsesReasoningPolicy['reasoning']
  shouldIncludeOpenAIResponsesEncryptedReasoning(request: Request, effort: string | undefined): boolean
  resolveParameters(request: Request, options: {
    omitSampling?: boolean
    includeDefaultTopP?: boolean
    maxTokenParameterNames: string[]
    endpoint?: 'openai-chat' | 'openai-responses' | 'anthropic' | 'google'
    maxTokensRequired?: boolean
  }): ProviderResolvedRequestParameters
}) {
  function openAIChatReasoning(request: Request): OpenAIChatReasoningPolicy {
    const deepSeekThinking = dependencies.normalizeDeepSeekThinking(request)
    const dashScopeThinking = dependencies.normalizeDashScopeThinking(request)
    const siliconFlowThinking = dependencies.normalizeSiliconFlowThinking(request)
    const kimiThinking = dependencies.normalizeKimiThinking(request)
    const miniMaxThinking = dependencies.normalizeMiniMaxThinking(request)
    return {
      deepSeekThinking, dashScopeThinking, siliconFlowThinking, kimiThinking,
      kimiPreservedThinking: dependencies.normalizeKimiPreservedThinking(request, kimiThinking),
      miniMaxThinking,
      miniMaxReasoningSplit: dependencies.shouldRequestMiniMaxReasoningSplit(request, miniMaxThinking),
      openAIReasoningEffort: dependencies.normalizeOpenAIReasoningEffort(request),
      mimoThinking: dependencies.normalizeXiaomiMimoThinking(request),
      omitSampling: Boolean(deepSeekThinking?.type === 'enabled' || dashScopeThinking?.enabled || siliconFlowThinking || kimiThinking?.type === 'enabled' || dependencies.isKimiSamplingLocked(request) || dependencies.isXiaomiMimoThinkingActive(request)),
    }
  }
  function anthropicReasoning(request: Request): AnthropicRequestReasoningPolicy {
    const thinkingConfig = dependencies.normalizeAnthropicThinking(request)
    return { thinkingConfig, miniMaxThinking: dependencies.normalizeMiniMaxThinking(request), mimoThinking: dependencies.normalizeXiaomiMimoThinking(request), omitSampling: Boolean(thinkingConfig) || dependencies.isXiaomiMimoThinkingActive(request) || dependencies.modelDisallowsAnthropicSampling(request.model) }
  }
  function openAIResponsesReasoning(request: Request): OpenAIResponsesReasoningPolicy {
    const effort = dependencies.normalizeOpenAIReasoningEffort(request)
    return { reasoning: dependencies.buildOpenAIResponsesReasoning(effort, request.provider), includeEncryptedReasoning: dependencies.shouldIncludeOpenAIResponsesEncryptedReasoning(request, effort) }
  }
  return {
    openAIChatReasoning,
    anthropicReasoning,
    googleThinking: dependencies.normalizeGoogleThinkingConfig,
    openAIResponsesReasoning,
    resolveParameters: dependencies.resolveParameters,
  }
}
