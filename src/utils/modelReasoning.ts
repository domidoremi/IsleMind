import { getModelConfig } from '@/types'
import type { AIProvider, ReasoningEffort } from '@/types'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/services/ai/providerCompatibilityContract'

export type ReasoningControlValue = ReasoningEffort | 'default'

export function getReasoningEffortOptions(provider: AIProvider | undefined, model: string | undefined): ReasoningEffort[] {
  if (!provider || !model) return []
  const config = getModelConfig(model, provider.type, provider.modelConfigs)
  if (!providerAllowsReasoningControls(provider, config)) return []
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
  if (config.reasoningMode === 'groq-reasoning-effort') return groqReasoningEffortOptions(model)
  if (config.reasoningMode === 'together-reasoning-effort') return togetherReasoningEffortOptions(model)
  if (config.reasoningMode === 'fireworks-reasoning-effort') return getFireworksReasoningEffortOptions(model)
  if (config.reasoningMode === 'perplexity-reasoning-effort') return ['minimal', 'low', 'medium', 'high']
  if (config.reasoningMode === 'cohere-reasoning-effort') return ['none', 'high']
  if (config.reasoningMode === 'cerebras-reasoning-effort') return cerebrasReasoningEffortOptions(model)
  if (config.reasoningMode === 'sambanova-reasoning-effort') return sambanovaReasoningEffortOptions(model)
  if (config.reasoningMode === 'huggingface-reasoning-effort') return huggingFaceReasoningEffortOptions(model)
  if (config.reasoningMode === 'deepinfra-reasoning-effort') return deepInfraReasoningEffortOptions(model)
  if (config.reasoningMode === 'siliconflow-thinking-budget') return siliconFlowThinkingBudgetOptions(model)
  if (config.reasoningMode === 'gemini-thinking-level') return ['minimal', 'low', 'medium', 'high']
  if (config.reasoningMode === 'gemini-thinking-budget') return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

  if (isSiliconFlowReasoningModel(provider, model)) return siliconFlowThinkingBudgetOptions(model)
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
  if (isGroqReasoningModel(provider, model)) return groqReasoningEffortOptions(model)
  if (isTogetherReasoningModel(provider, model)) return togetherReasoningEffortOptions(model)
  if (isFireworksReasoningModel(provider, model)) return getFireworksReasoningEffortOptions(model)
  if (isPerplexityReasoningModel(provider, model)) return ['minimal', 'low', 'medium', 'high']
  if (isCohereReasoningModel(provider, model)) return ['none', 'high']
  if (isCerebrasReasoningModel(provider, model)) return cerebrasReasoningEffortOptions(model)
  if (isSambaNovaReasoningModel(provider, model)) return sambanovaReasoningEffortOptions(model)
  if (isHuggingFaceReasoningModel(provider, model)) return huggingFaceReasoningEffortOptions(model)
  if (isDeepInfraReasoningModel(provider, model)) return deepInfraReasoningEffortOptions(model)
  if (isXiaomiMimoReasoningModel(provider, model)) return ['none', 'high']
  return []
}

export function providerSupportsReasoning(provider: AIProvider | undefined, model: string | undefined): boolean {
  if (!provider) return false
  if (!model) return false
  return getReasoningEffortOptions(provider, model).length > 0
}

function providerAllowsReasoningControls(provider: AIProvider, config: ReturnType<typeof getModelConfig>): boolean {
  const explicitDeclaration = provider.capabilities?.reasoningEffort === true ||
    (config.source === 'remote' && Boolean(config.reasoningMode || config.reasoningEfforts?.length))
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, 'reasoning', explicitDeclaration)
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
  if (provider.presetId === 'siliconflow' || provider.detectedPresetId === 'siliconflow') return false
  if (provider.presetId === 'modelscope' || provider.detectedPresetId === 'modelscope') return false
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

export function isGroqReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'groq', /groq|api\.groq\.com/i)) return false
  const normalized = normalizeModelId(model)
  return /^qwen3(?:[-.]|$)/.test(normalized) || /^gpt-oss(?:[-.]|$)/.test(normalized)
}

export function isTogetherReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'together', /together|api\.together\.(ai|xyz)/i)) return false
  return /^gpt-oss(?:[-.]|$)/.test(normalizeModelId(model))
}

export function isFireworksReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'fireworks', /fireworks|api\.fireworks\.ai/i)) return false
  return fireworksReasoningProfile(model) !== undefined
}

export function isPerplexityReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'perplexity', /perplexity|sonar|api\.perplexity\.ai/i)) return false
  return /^sonar-(?:reasoning-pro|deep-research)$/.test(normalizeModelId(model))
}

export function isCohereReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'cohere', /cohere|api\.cohere\.(ai|com)/i)) return false
  const normalized = normalizeModelId(model)
  return /^command-a-(?:plus|reasoning)(?:[-.]|$)/.test(normalized)
}

export function isCerebrasReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'cerebras', /cerebras|api\.cerebras\.ai/i)) return false
  return cerebrasReasoningEffortOptions(model).length > 0
}

export function isSambaNovaReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'sambanova', /sambanova|api\.sambanova\.ai/i)) return false
  return sambanovaReasoningEffortOptions(model).length > 0
}

export function isHuggingFaceReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'huggingface', /hugging\s*face|huggingface|router\.huggingface\.co|api-inference\.huggingface\.co|hf\.co/i)) return false
  return huggingFaceReasoningEffortOptions(model).length > 0
}

export function isDeepInfraReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'deepinfra', /deepinfra|api\.deepinfra\.com/i)) return false
  return deepInfraReasoningEffortOptions(model).length > 0
}

export function isSiliconFlowReasoningModel(provider: AIProvider, model: string): boolean {
  if (!isProviderFamily(provider, 'siliconflow', /siliconflow|silicon\s*flow|api\.siliconflow\.(cn|com)|硅基流动/i)) return false
  return siliconFlowThinkingBudgetOptions(model).length > 0
}

function cerebrasReasoningEffortOptions(model: string): ReasoningEffort[] {
  const normalized = normalizeModelId(model)
  if (normalized === 'gpt-oss-120b') return ['low', 'medium', 'high']
  if (normalized === 'zai-glm-4.7') return ['none']
  return []
}

function sambanovaReasoningEffortOptions(model: string): ReasoningEffort[] {
  return normalizeModelId(model) === 'gpt-oss-120b' ? ['low', 'medium', 'high'] : []
}

function huggingFaceReasoningEffortOptions(model: string): ReasoningEffort[] {
  return /^gpt-oss(?:[-.]|$)/.test(normalizeModelId(model)) ? ['low', 'medium', 'high'] : []
}

function deepInfraReasoningEffortOptions(model: string): ReasoningEffort[] {
  const normalized = normalizeModelId(model)
  if (/^qwen3(?:[-.]|$)/.test(normalized)) return ['none', 'low', 'medium', 'high']
  if (/^deepseek-v3\.?1(?:[-.]|$)|^deepseek-v4(?:[-.]|$)/.test(normalized)) return ['none', 'low', 'medium', 'high']
  if (/^claude-sonnet-4-6(?:[-.]|$)/.test(normalized)) return ['none', 'low', 'medium', 'high']
  if (/^gemini-3\.1-pro(?:[-.]|$)/.test(normalized)) return ['none', 'low', 'medium', 'high']
  return []
}

function siliconFlowThinkingBudgetOptions(model: string): ReasoningEffort[] {
  const normalized = normalizeModelId(model)
  if (/^(qwen3|qwq)(?:[-.]|$)/.test(normalized)) return ['none', 'low', 'medium', 'high']
  if (/^deepseek-r1(?:[-.]|$)/.test(normalized)) return ['none', 'low', 'medium', 'high']
  return []
}

function groqReasoningEffortOptions(model: string): ReasoningEffort[] {
  return /^qwen3(?:[-.]|$)/.test(normalizeModelId(model))
    ? ['none', 'low', 'medium', 'high']
    : ['low', 'medium', 'high']
}

function togetherReasoningEffortOptions(_model: string): ReasoningEffort[] {
  return ['low', 'medium', 'high']
}

type FireworksReasoningProfile =
  | 'qwen3'
  | 'minimax-m2'
  | 'deepseek-binary'
  | 'deepseek-v4'
  | 'glm-binary'
  | 'glm-5.2'
  | 'gpt-oss'

export function getFireworksReasoningEffortOptions(model: string): ReasoningEffort[] {
  const profile = fireworksReasoningProfile(model)
  if (profile === 'gpt-oss' || profile === 'minimax-m2') return ['low', 'medium', 'high']
  if (profile === 'deepseek-v4') return ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  if (profile === 'glm-5.2') return ['none', 'high', 'max']
  if (profile === 'qwen3' || profile === 'deepseek-binary' || profile === 'glm-binary') return ['none', 'low', 'medium', 'high']
  return []
}

export function normalizeFireworksReasoningEffort(model: string, effort: ReasoningEffort): ReasoningEffort | undefined {
  const profile = fireworksReasoningProfile(model)
  if (!profile) return undefined
  if (profile === 'gpt-oss' || profile === 'minimax-m2') {
    if (effort === 'none') return undefined
    if (effort === 'minimal') return 'low'
    if (effort === 'xhigh' || effort === 'max') return 'high'
    return ['low', 'medium', 'high'].includes(effort) ? effort : 'medium'
  }
  if (profile === 'deepseek-v4') {
    if (effort === 'minimal') return 'low'
    if (effort === 'xhigh' || effort === 'max') return 'max'
    return ['none', 'low', 'medium', 'high'].includes(effort) ? effort : 'high'
  }
  if (profile === 'glm-5.2') {
    if (effort === 'none') return 'none'
    if (effort === 'xhigh' || effort === 'max') return 'max'
    return 'high'
  }
  if (effort === 'minimal') return 'low'
  if (effort === 'xhigh' || effort === 'max') return 'high'
  return ['none', 'low', 'medium', 'high'].includes(effort) ? effort : 'medium'
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

function fireworksReasoningProfile(model: string): FireworksReasoningProfile | undefined {
  const normalized = normalizeModelId(model)
  const compact = normalized.replace(/[._-]/g, '')
  if (/^gpt-oss(?:[-.]|$)/.test(normalized)) return 'gpt-oss'
  if (/^qwen3(?:p5)?(?:[-.]|$)/.test(normalized) || /^qwen3\.5(?:[-.]|$)/.test(normalized)) return 'qwen3'
  if (/^minimax-m2(?:[-.]|$)/.test(normalized)) return 'minimax-m2'
  if (/^deepseek/.test(normalized)) {
    if (/v4/.test(compact)) return 'deepseek-v4'
    if (/v3p?[12]/.test(compact)) return 'deepseek-binary'
  }
  if (/^glm/.test(normalized)) {
    if (/glm52/.test(compact)) return 'glm-5.2'
    if (/glm4[567]|glm51/.test(compact)) return 'glm-binary'
  }
  return undefined
}

export function normalizeModelId(model: string): string {
  return (model.toLowerCase().split('/').at(-1) ?? model.toLowerCase()).trim()
}
