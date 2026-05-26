import { getModelConfig } from '@/types'
import type { AIProvider, ReasoningEffort } from '@/types'

export function getReasoningEffortOptions(provider: AIProvider | undefined, model: string | undefined): ReasoningEffort[] {
  if (!provider || !model) return []
  const config = getModelConfig(model, provider.type, provider.modelConfigs)
  if (config.reasoningEfforts?.length) return config.reasoningEfforts
  if (config.reasoningMode === 'openai-effort') return ['low', 'medium', 'high']
  if (config.reasoningMode === 'deepseek-thinking') return ['none', 'low', 'medium', 'high', 'xhigh']
  if (config.reasoningMode === 'anthropic-thinking') return ['none', 'low', 'medium', 'high', 'xhigh']
  if (config.reasoningMode === 'gemini-thinking-level') return ['minimal', 'low', 'medium', 'high']
  if (config.reasoningMode === 'gemini-thinking-budget') return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

  if (isOpenAIReasoningModel(provider, model)) return ['low', 'medium', 'high']
  if (isClaudeThinkingModel(provider, model)) return ['none', 'low', 'medium', 'high', 'xhigh']
  if (isGeminiThinkingModel(provider, model)) {
    return /^gemini-3/i.test(normalizeModelId(model))
      ? ['minimal', 'low', 'medium', 'high']
      : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  }
  if (isDeepSeekThinkingModel(provider, model)) return ['none', 'low', 'medium', 'high', 'xhigh']
  if (isXiaomiMimoReasoningModel(provider, model)) return ['minimal', 'low', 'medium', 'high']
  return []
}

export function providerSupportsReasoning(provider: AIProvider | undefined, model: string | undefined): boolean {
  if (!provider) return false
  if (!model) return false
  return getReasoningEffortOptions(provider, model).length > 0
}

export function isOpenAIReasoningModel(provider: AIProvider, model: string): boolean {
  const normalized = normalizeModelId(model)
  if (provider.type !== 'openai') return false
  return /^(o[1-9]|gpt-5)/.test(normalized)
}

export function isClaudeThinkingModel(provider: AIProvider, model: string): boolean {
  if (provider.type !== 'anthropic' && provider.wireProtocol !== 'anthropic-compatible') return false
  return /claude-(3[.-]7|sonnet-3[.-]7|opus-4|sonnet-4|haiku-4|mythos)/.test(normalizeModelId(model))
}

export function isGeminiThinkingModel(provider: AIProvider, model: string): boolean {
  if (provider.type !== 'google') return false
  return /^gemini-(2\.5|3)/i.test(normalizeModelId(model))
}

export function isDeepSeekThinkingModel(provider: AIProvider, model: string): boolean {
  const normalized = normalizeModelId(model)
  if (provider.presetId === 'deepseek' || provider.detectedPresetId === 'deepseek') return true
  if ((provider.baseUrl ?? '').toLowerCase().includes('deepseek')) return true
  return provider.modelConfigs?.some((config) =>
    config.id === model &&
    config.source === 'remote' &&
    config.reasoningMode === 'deepseek-thinking' &&
    (normalized.includes('reasoner') || normalized.includes('thinking'))
  ) ?? false
}

export function isXiaomiMimoReasoningModel(provider: AIProvider, model: string): boolean {
  if (provider.type !== 'xiaomi-mimo') return false
  if (!provider.capabilities?.reasoningEffort) return false
  const normalized = normalizeModelId(model)
  if (normalized.includes('tts')) return false
  return /^mimo-v(2|2\.5)/.test(normalized)
}

export function normalizeModelId(model: string): string {
  return (model.toLowerCase().split('/').at(-1) ?? model.toLowerCase()).trim()
}
