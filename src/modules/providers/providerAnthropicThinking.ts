import type { ReasoningEffort } from '@/core'
import type { AIModel, AIProvider } from '@/types/providerContracts'

export interface AnthropicThinkingRequest {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
}

export interface AnthropicThinkingConfig {
  thinking?: Record<string, unknown>
  outputConfig?: Record<string, unknown>
}

export interface AnthropicThinkingPolicyDependencies {
  resolveModelConfig(model: string, provider: AIProvider): AIModel
  isClaudeThinkingModel(provider: AIProvider, model: string): boolean
  clampMaxTokens(request: AnthropicThinkingRequest): number
  reasoningExplicitlyDeclaredForModel(provider: AIProvider, modelConfig: AIModel): boolean
  reasoningCanBeSentForProvider(
    provider: AIProvider,
    capability: 'reasoning',
    explicitDeclaration?: boolean,
  ): boolean
}

export interface AnthropicThinkingPolicy {
  normalizeAnthropicThinking(request: AnthropicThinkingRequest): AnthropicThinkingConfig | undefined
}

export function createAnthropicThinkingPolicy(
  dependencies: AnthropicThinkingPolicyDependencies,
): AnthropicThinkingPolicy {
  return {
    normalizeAnthropicThinking(request) {
      if (
        !request.reasoningEffort ||
        request.reasoningEffort === 'none' ||
        request.reasoningEffort === 'minimal'
      ) {
        return undefined
      }

      const config = dependencies.resolveModelConfig(request.model, request.provider)
      const explicitlyDeclared = dependencies.reasoningExplicitlyDeclaredForModel(
        request.provider,
        config,
      )
      if (
        !dependencies.reasoningCanBeSentForProvider(
          request.provider,
          'reasoning',
          explicitlyDeclared,
        )
      ) {
        return undefined
      }
      if (
        config.reasoningMode !== 'anthropic-thinking' &&
        !dependencies.isClaudeThinkingModel(request.provider, request.model)
      ) {
        return undefined
      }

      if (usesAnthropicOutputConfigOnlyThinking(request.model)) {
        return {
          outputConfig: {
            effort: normalizeAnthropicEffort(request.model, request.reasoningEffort),
          },
        }
      }
      if (supportsAnthropicAdaptiveThinking(request.model)) {
        return {
          thinking: { type: 'adaptive', display: 'summarized' },
          outputConfig: {
            effort: normalizeAnthropicEffort(request.model, request.reasoningEffort),
          },
        }
      }

      const maxTokens = dependencies.clampMaxTokens(request)
      const floor = Math.min(1024, Math.max(128, maxTokens - 1))
      const preferred = preferredAnthropicThinkingBudget(request.reasoningEffort)
      const budget = Math.min(Math.max(floor, preferred), Math.max(1, maxTokens - 1))
      return budget > 0
        ? { thinking: { type: 'enabled', budget_tokens: budget } }
        : undefined
    },
  }
}

export function supportsAnthropicAdaptiveThinking(modelId: string): boolean {
  return /claude-(mythos-preview|opus-4-8|opus-4-7|opus-4-6|sonnet-4-6)/.test(
    modelId.toLowerCase(),
  )
}

export function usesAnthropicOutputConfigOnlyThinking(modelId: string): boolean {
  return /claude-(fable-5|mythos-5)/.test(modelId.toLowerCase())
}

export function normalizeAnthropicEffort(
  modelId: string,
  effort: ReasoningEffort,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  if (effort === 'max') return 'max'
  if (effort === 'low') return 'low'
  if (effort === 'medium') return 'medium'
  if (effort === 'xhigh') {
    return /claude-(fable-5|mythos-5|opus-4-[78])/i.test(modelId) ? 'xhigh' : 'max'
  }
  return 'high'
}

function preferredAnthropicThinkingBudget(effort: ReasoningEffort): number {
  switch (effort) {
    case 'low':
      return 1024
    case 'high':
      return 4096
    case 'xhigh':
    case 'max':
      return 8192
    case 'medium':
    default:
      return 2048
  }
}
