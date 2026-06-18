import type { AIProvider, ReasoningEffort } from '@/types'
import { getModelConfig } from '@/types'
import {
  isDashScopeThinkingModel,
  isDeepSeekThinkingModel,
  isKimiThinkingModel,
  isMiniMaxThinkingModel,
} from '@/utils/modelReasoning'

export interface OpenAICompatibleThinkingRequestLike {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  messages?: {
    role: 'user' | 'assistant' | 'tool'
    reasoningContent?: string
  }[]
}

export function normalizeDeepSeekThinking(req: OpenAICompatibleThinkingRequestLike): { type: 'enabled' | 'disabled'; effort?: 'high' | 'max' } | undefined {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (modelConfig.reasoningMode !== 'deepseek-thinking' && !isDeepSeekThinkingModel(req.provider, req.model)) return undefined
  const effort = req.reasoningEffort ?? 'medium'
  if (effort === 'none' || effort === 'minimal') return { type: 'disabled' }
  return { type: 'enabled', effort: effort === 'xhigh' || effort === 'max' ? 'max' : 'high' }
}

export function normalizeDashScopeThinking(req: OpenAICompatibleThinkingRequestLike): { enabled: boolean; budget?: number } | undefined {
  if (!req.reasoningEffort) return undefined
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (modelConfig.reasoningMode !== 'dashscope-thinking' && !isDashScopeThinkingModel(req.provider, req.model)) return undefined
  if (req.reasoningEffort === 'none' || req.reasoningEffort === 'minimal') return { enabled: false }
  return { enabled: true, budget: normalizeDashScopeThinkingBudget(req.model, req.reasoningEffort) }
}

export function normalizeDashScopeThinkingBudget(modelId: string, effort: ReasoningEffort): number {
  const maxBudget = getDashScopeThinkingBudgetMax(modelId)
  if (effort === 'low') return Math.min(maxBudget, 8192)
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return maxBudget
  return Math.min(maxBudget, 65536)
}

export function normalizeKimiThinking(req: OpenAICompatibleThinkingRequestLike): { type: 'enabled' | 'disabled' } | undefined {
  if (!req.reasoningEffort) return undefined
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (modelConfig.reasoningMode !== 'kimi-thinking' && !isKimiThinkingModel(req.provider, req.model)) return undefined
  return {
    type: req.reasoningEffort === 'none' || req.reasoningEffort === 'minimal' ? 'disabled' : 'enabled',
  }
}

export function normalizeKimiPreservedThinking(
  req: OpenAICompatibleThinkingRequestLike,
  thinking: { type: 'enabled' | 'disabled' } | undefined
): { type: 'enabled'; keep: 'all' } | undefined {
  if (!isKimiThinkingModel(req.provider, req.model)) return undefined
  if (!req.messages?.some((msg) => msg.role === 'assistant' && typeof msg.reasoningContent === 'string' && msg.reasoningContent.trim())) return undefined
  if (thinking?.type === 'disabled') return undefined
  return { type: 'enabled', keep: 'all' }
}

export function isKimiSamplingLocked(req: OpenAICompatibleThinkingRequestLike): boolean {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  return modelConfig.reasoningMode === 'kimi-thinking' || isKimiThinkingModel(req.provider, req.model)
}

export function normalizeMiniMaxThinking(req: OpenAICompatibleThinkingRequestLike): { type: 'adaptive' | 'disabled' } | undefined {
  if (!req.reasoningEffort) return undefined
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (modelConfig.reasoningMode !== 'minimax-thinking' || !isMiniMaxThinkingModel(req.provider, req.model)) return undefined
  return { type: req.reasoningEffort === 'none' || req.reasoningEffort === 'minimal' ? 'disabled' : 'adaptive' }
}

export function shouldRequestMiniMaxReasoningSplit(
  req: OpenAICompatibleThinkingRequestLike,
  thinking: { type: 'adaptive' | 'disabled' } | undefined
): boolean {
  return req.provider.wireProtocol !== 'anthropic-compatible' && isMiniMaxThinkingModel(req.provider, req.model) && thinking?.type !== 'disabled'
}

function getDashScopeThinkingBudgetMax(modelId: string): number {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  if (/^qwen3\.7(?:-|$)/.test(normalized)) return 262144
  if (/^qwen3\.6-(?:flash|max-preview)(?:-|$)/.test(normalized)) return 131072
  if (/^qwen3\.6-plus(?:-|$)/.test(normalized)) return 81920
  if (/^qwen3\.5(?:-|$)/.test(normalized)) return 81920
  return 8192
}
