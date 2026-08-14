import type { ReasoningEffort } from '@/core'
import type { AIModel, AIProvider } from '@/types/providerContracts'

export interface GoogleThinkingRequest {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
}

export interface GoogleThinkingPolicyDependencies {
  resolveModelConfig(model: string, provider: AIProvider): AIModel
  isGeminiThinkingLevelModel(model: string): boolean
  isGeminiThinkingModel(provider: AIProvider, model: string): boolean
}

export interface GoogleThinkingPolicy {
  normalizeGoogleThinkingConfig(request: GoogleThinkingRequest): Record<string, unknown> | undefined
}

export function createGoogleThinkingPolicy(
  dependencies: GoogleThinkingPolicyDependencies,
): GoogleThinkingPolicy {
  return {
    normalizeGoogleThinkingConfig(request) {
      if (!request.reasoningEffort) return undefined
      const config = dependencies.resolveModelConfig(request.model, request.provider)
      if (
        config.reasoningMode === 'gemini-thinking-level' ||
        dependencies.isGeminiThinkingLevelModel(request.model)
      ) {
        const level = normalizeGeminiThinkingLevel(request.reasoningEffort, config)
        return level
          ? withGoogleThoughtSummaries({ thinkingLevel: level }, request.reasoningEffort)
          : undefined
      }
      if (
        config.reasoningMode === 'gemini-thinking-budget' ||
        dependencies.isGeminiThinkingModel(request.provider, request.model)
      ) {
        return withGoogleThoughtSummaries(
          { thinkingBudget: normalizeGeminiThinkingBudget(request.model, request.reasoningEffort) },
          request.reasoningEffort,
        )
      }
      return undefined
    },
  }
}

export function withGoogleThoughtSummaries(
  config: Record<string, unknown>,
  effort: ReasoningEffort,
): Record<string, unknown> {
  if (effort === 'none' || effort === 'minimal') return config
  return { ...config, includeThoughts: true }
}

export function normalizeGeminiThinkingLevel(
  effort: ReasoningEffort,
  config: AIModel,
): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  const requested = effort === 'none'
    ? 'minimal'
    : effort === 'xhigh' || effort === 'max'
      ? 'high'
      : effort
  const allowed = config.reasoningEfforts ?? ['minimal', 'low', 'medium', 'high']
  if (requested === 'minimal' && !allowed.includes('minimal')) return 'low'
  if (
    ['minimal', 'low', 'medium', 'high'].includes(requested) &&
    allowed.includes(requested as ReasoningEffort)
  ) {
    return requested as 'minimal' | 'low' | 'medium' | 'high'
  }
  return allowed.includes('medium') ? 'medium' : 'high'
}

export function normalizeGeminiThinkingBudget(modelId: string, effort: ReasoningEffort): number {
  const normalized = modelId.toLowerCase()
  const max = normalized.includes('flash') ? 24576 : 32768
  const canDisable = normalized.includes('flash')
  switch (effort) {
    case 'none':
    case 'minimal':
      return canDisable ? 0 : normalized.includes('flash-lite') ? 512 : 128
    case 'low':
      return normalized.includes('flash') ? 1024 : 2048
    case 'high':
      return Math.min(max, 8192)
    case 'xhigh':
    case 'max':
      return max
    case 'medium':
    default:
      return -1
  }
}
