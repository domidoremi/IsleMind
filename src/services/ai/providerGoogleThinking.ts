import type { AIModel, AIProvider, ReasoningEffort } from '@/types'
import { getModelConfig } from '@/types'
import { isGeminiThinkingLevelModel, isGeminiThinkingModel } from '@/utils/modelReasoning'

export interface GoogleThinkingRequestLike {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
}

export function normalizeGoogleThinkingConfig(req: GoogleThinkingRequestLike): Record<string, unknown> | undefined {
  if (!req.reasoningEffort) return undefined
  const config = getModelConfig(req.model, 'google', req.provider.modelConfigs)
  if (config.reasoningMode === 'gemini-thinking-level' || isGeminiThinkingLevelModel(req.model)) {
    const level = normalizeGeminiThinkingLevel(req.reasoningEffort, config)
    return level ? withGoogleThoughtSummaries({ thinkingLevel: level }, req.reasoningEffort) : undefined
  }
  if (config.reasoningMode === 'gemini-thinking-budget' || isGeminiThinkingModel(req.provider, req.model)) {
    return withGoogleThoughtSummaries({ thinkingBudget: normalizeGeminiThinkingBudget(req.model, req.reasoningEffort) }, req.reasoningEffort)
  }
  return undefined
}

export function withGoogleThoughtSummaries(config: Record<string, unknown>, effort: ReasoningEffort): Record<string, unknown> {
  if (effort === 'none' || effort === 'minimal') return config
  return { ...config, includeThoughts: true }
}

export function normalizeGeminiThinkingLevel(effort: ReasoningEffort, config: AIModel): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  const requested = effort === 'none' ? 'minimal' : effort === 'xhigh' || effort === 'max' ? 'high' : effort
  const allowed = config.reasoningEfforts ?? ['minimal', 'low', 'medium', 'high']
  if (requested === 'minimal' && !allowed.includes('minimal')) return 'low'
  if (['minimal', 'low', 'medium', 'high'].includes(requested) && allowed.includes(requested as ReasoningEffort)) {
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
