import type { AIProvider, ReasoningEffort } from '@/types'
import { getModelConfig } from '@/types'
import { isClaudeThinkingModel } from '@/utils/modelReasoning'
import { clampMaxTokens } from '@/services/ai/providerRequestParameters'
import { providerCompatibilityCapabilityCanBeSentForProvider, providerCompatibilityReasoningExplicitlyDeclaredForModel } from '@/services/ai/providerCompatibilityContract'

export interface AnthropicThinkingInput {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
}

export interface AnthropicThinkingConfig {
  thinking?: Record<string, unknown>
  outputConfig?: Record<string, unknown>
}

export function supportsAnthropicAdaptiveThinking(modelId: string): boolean {
  const normalized = modelId.toLowerCase()
  return /claude-(mythos-preview|opus-4-8|opus-4-7|opus-4-6|sonnet-4-6)/.test(normalized)
}

export function usesAnthropicOutputConfigOnlyThinking(modelId: string): boolean {
  const normalized = modelId.toLowerCase()
  return /claude-(fable-5|mythos-5)/.test(normalized)
}

export function normalizeAnthropicEffort(modelId: string, effort: ReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  if (effort === 'max') return 'max'
  if (effort === 'low') return 'low'
  if (effort === 'medium') return 'medium'
  if (effort === 'xhigh') return /claude-(fable-5|mythos-5|opus-4-[78])/i.test(modelId) ? 'xhigh' : 'max'
  return 'high'
}

export function normalizeAnthropicThinking(req: AnthropicThinkingInput): AnthropicThinkingConfig | undefined {
  if (!req.reasoningEffort || req.reasoningEffort === 'none' || req.reasoningEffort === 'minimal') return undefined
  const config = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (!providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'reasoning', providerCompatibilityReasoningExplicitlyDeclaredForModel(req.provider, config))) return undefined
  if (config.reasoningMode !== 'anthropic-thinking' && !isClaudeThinkingModel(req.provider, req.model)) return undefined
  if (usesAnthropicOutputConfigOnlyThinking(req.model)) {
    return {
      outputConfig: { effort: normalizeAnthropicEffort(req.model, req.reasoningEffort) },
    }
  }
  if (supportsAnthropicAdaptiveThinking(req.model)) {
    return {
      thinking: { type: 'adaptive', display: 'summarized' },
      outputConfig: { effort: normalizeAnthropicEffort(req.model, req.reasoningEffort) },
    }
  }
  const maxTokens = clampMaxTokens(req)
  const floor = Math.min(1024, Math.max(128, maxTokens - 1))
  const preferred = (() => {
    switch (req.reasoningEffort) {
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
  })()
  const budget = Math.min(Math.max(floor, preferred), Math.max(1, maxTokens - 1))
  return budget > 0 ? { thinking: { type: 'enabled', budget_tokens: budget } } : undefined
}
