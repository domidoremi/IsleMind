import { getModelConfig } from '@/types'
import type { AIProvider, ReasoningEffort } from '@/types'

export type ReasoningControlValue = ReasoningEffort | 'default'

export function getReasoningEffortOptions(provider: AIProvider | undefined, model: string | undefined): ReasoningEffort[] {
  if (!provider || !model) return []
  const config = getModelConfig(model, provider.type, provider.modelConfigs)
  if (config.reasoningMode === 'minimax-thinking') {
    return isMiniMaxThinkingModel(provider, model) ? config.reasoningEfforts ?? ['none', 'high'] : []
  }
  if (config.reasoningEfforts?.length) return config.reasoningEfforts
  if (config.reasoningMode === 'openai-effort') return ['low', 'medium', 'high']
  if (config.reasoningMode === 'deepseek-thinking') return ['none', 'low', 'medium', 'high', 'xhigh']
  if (config.reasoningMode === 'anthropic-thinking') return ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  if (config.reasoningMode === 'dashscope-thinking') return ['none', 'low', 'medium', 'high']
  if (config.reasoningMode === 'kimi-thinking') return ['none', 'high']
  if (config.reasoningMode === 'xai-reasoning-effort') return isXAIMultiAgentReasoningModel(model) ? ['low', 'medium', 'high', 'xhigh'] : ['none', 'low', 'medium', 'high']
  if (config.reasoningMode === 'gemini-thinking-level') return ['minimal', 'low', 'medium', 'high']
  if (config.reasoningMode === 'gemini-thinking-budget') return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

  if (isOpenAIReasoningModel(provider, model)) return ['low', 'medium', 'high']
  if (isClaudeThinkingModel(provider, model)) return ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  if (isGeminiThinkingModel(provider, model)) {
    return isGeminiThinkingLevelModel(model)
      ? ['minimal', 'low', 'medium', 'high']
      : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  }
  if (isDeepSeekThinkingModel(provider, model)) return ['none', 'low', 'medium', 'high', 'xhigh']
  if (isDashScopeThinkingModel(provider, model)) return ['none', 'low', 'medium', 'high']
  if (isKimiThinkingModel(provider, model)) return ['none', 'high']
  if (isMiniMaxThinkingModel(provider, model)) return ['none', 'high']
  if (isXAIReasoningModel(provider, model)) return isXAIMultiAgentReasoningModel(model) ? ['low', 'medium', 'high', 'xhigh'] : ['none', 'low', 'medium', 'high']
  if (isXiaomiMimoReasoningModel(provider, model)) return ['none', 'high']
  return []
}

export function providerSupportsReasoning(provider: AIProvider | undefined, model: string | undefined): boolean {
  if (!provider) return false
  if (!model) return false
  return getReasoningEffortOptions(provider, model).length > 0
}

export function modelSupportsSamplingControls(provider: AIProvider | undefined, model: string | undefined, reasoningEffort?: ReasoningEffort): boolean {
  if (!provider || !model) return true
  if (modelDisallowsAnthropicSampling(model)) return false
  const config = getModelConfig(model, provider.type, provider.modelConfigs)
  if (config.maxTemperature !== undefined && config.maxTemperature <= 0) return false
  if (isOpenAIReasoningModel(provider, model) || config.reasoningMode === 'openai-effort') return false
  if (isKimiThinkingModel(provider, model) || config.reasoningMode === 'kimi-thinking') return false
  if ((isDeepSeekThinkingModel(provider, model) || config.reasoningMode === 'deepseek-thinking') && reasoningEffort !== 'none' && reasoningEffort !== 'minimal') return false
  if (isXiaomiMimoReasoningModel(provider, model) && reasoningEffort !== 'none') return false

  const reasoningEnabled = Boolean(reasoningEffort && reasoningEffort !== 'none' && reasoningEffort !== 'minimal')
  if (!reasoningEnabled) return true
  return ![
    'anthropic-thinking',
    'deepseek-thinking',
    'dashscope-thinking',
  ].includes(config.reasoningMode ?? '') &&
    !isClaudeThinkingModel(provider, model) &&
    !isDeepSeekThinkingModel(provider, model) &&
    !isDashScopeThinkingModel(provider, model)
}

export function getReasoningControlOptions(options: ReasoningEffort[]): ReasoningControlValue[] {
  return options.length ? ['default', ...options] : []
}

export function getReasoningControlValue(effort: ReasoningEffort | undefined): ReasoningControlValue {
  return effort ?? 'default'
}

export function resolveReasoningControlValue(value: ReasoningControlValue): ReasoningEffort | undefined {
  return value === 'default' ? undefined : value
}

export function getReasoningDisplayEffort(effort: ReasoningEffort | undefined, options: ReasoningEffort[]): ReasoningEffort {
  if (effort && options.includes(effort)) return effort
  if (options.includes('medium')) return 'medium'
  return options.find((option) => option !== 'none' && option !== 'minimal') ?? options[0] ?? 'none'
}

export function getNextReasoningEffort(effort: ReasoningEffort | undefined, options: ReasoningEffort[]): ReasoningEffort | undefined {
  const controlOptions = getReasoningControlOptions(options)
  if (!controlOptions.length) return effort
  const currentValue = effort && options.includes(effort) ? effort : 'default'
  const currentIndex = controlOptions.indexOf(currentValue)
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % controlOptions.length : 0
  return resolveReasoningControlValue(controlOptions[nextIndex])
}

export function isOpenAIReasoningModel(provider: AIProvider, model: string): boolean {
  const normalized = normalizeModelId(model)
  if (provider.type !== 'openai') return false
  return /^(o[1-9]|gpt-5)/.test(normalized)
}

export function isClaudeThinkingModel(provider: AIProvider, model: string): boolean {
  if (provider.type !== 'anthropic' && provider.wireProtocol !== 'anthropic-compatible') return false
  return /claude-(3[.-]7|sonnet-3[.-]7|fable-5|opus-4|sonnet-4|haiku-4|mythos)/.test(normalizeModelId(model))
}

export function modelDisallowsAnthropicSampling(model: string): boolean {
  const normalized = normalizeModelId(model)
  if (/^claude-(fable-5|mythos-5|mythos-preview)/.test(normalized)) return true
  const opusMatch = normalized.match(/^claude-opus-4-(\d+)/)
  return opusMatch ? Number(opusMatch[1]) >= 7 : false
}

export function isGeminiThinkingModel(provider: AIProvider, model: string): boolean {
  if (provider.type !== 'google') return false
  return /^gemini-(2\.5|3)/i.test(normalizeModelId(model))
}

export function isGeminiThinkingLevelModel(model: string): boolean {
  return /^gemini-3/i.test(normalizeModelId(model))
}

export function isDeepSeekThinkingModel(provider: AIProvider, model: string): boolean {
  const normalized = normalizeModelId(model)
  const remoteThinking = provider.modelConfigs?.some((config) =>
    config.id === model &&
    config.source === 'remote' &&
    config.reasoningMode === 'deepseek-thinking'
  ) ?? false
  if (remoteThinking) return true
  if (normalized === 'deepseek-chat') return false
  if (provider.presetId !== 'deepseek' && provider.detectedPresetId !== 'deepseek' && !(provider.baseUrl ?? '').toLowerCase().includes('deepseek')) return false
  return /^deepseek-v4(?:-|$)/.test(normalized) || normalized.includes('reasoner') || normalized.includes('thinking')
}

export function isDashScopeThinkingModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'dashscope', /dashscope|qwen|qwq|qvq|tongyi|aliyun|alibaba|百炼|阿里/i)) return false
  const normalized = normalizeModelId(model)
  return /^(qwen3|qwq|qvq)/.test(normalized)
}

export function isKimiThinkingModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'moonshot', /moonshot|kimi/i)) return false
  return /^kimi-k2(?:[.-]|$)/.test(normalizeModelId(model))
}

export function isMiniMaxThinkingModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'minimax', /minimax|mini[-_ ]?max|minimaxi|海螺/i)) return false
  return normalizeModelId(model) === 'minimax-m3'
}

export function isXAIReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'xai', /(^|[-_./])xai($|[-_./])|grok|api\.x\.ai/i)) return false
  const normalized = normalizeModelId(model)
  if (normalized === 'grok-4.3') return true
  if (normalized.includes('non-reasoning')) return false
  return /^grok-4\.20(?:[.-]|$)/.test(normalized)
}

export function isXAIMultiAgentReasoningModel(model: string): boolean {
  return /^grok-4\.20(?:[.-])multi(?:[.-])agent(?:[.-]|$)/.test(normalizeModelId(model))
}

export function isXiaomiMimoReasoningModel(provider: AIProvider, model: string): boolean {
  if (provider.type !== 'xiaomi-mimo') return false
  if (!provider.capabilities?.reasoningEffort) return false
  const normalized = normalizeModelId(model)
  if (normalized.includes('tts')) return false
  return /^mimo-v(2|2\.5)/.test(normalized)
}

function isProviderFamily(provider: AIProvider, presetId: string, pattern: RegExp): boolean {
  if (provider.presetId === presetId || provider.detectedPresetId === presetId) return true
  const text = [provider.id, provider.name, provider.baseUrl, provider.models?.join(' ')].filter(Boolean).join(' ')
  return pattern.test(text)
}

export function normalizeModelId(model: string): string {
  return (model.toLowerCase().split('/').at(-1) ?? model.toLowerCase()).trim()
}
