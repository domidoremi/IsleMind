import type { AIProvider, ReasoningEffort } from '@/types'
import { getModelConfig } from '@/types'
import {
  getReasoningEffortOptions,
  isOpenAIReasoningModel as isKnownOpenAIReasoningModel,
  providerSupportsReasoning,
} from '@/utils/modelReasoning'

export interface ProviderModelTestRequestLike {
  provider: AIProvider
  model: string
  reasoningEffort?: ReasoningEffort
}

export function getModelTestReasoningEffort(provider: AIProvider, model: string): ReasoningEffort | undefined {
  if (provider.type !== 'google') return undefined
  const options = getReasoningEffortOptions(provider, model)
  if (options.includes('medium')) return 'medium'
  return options.find((effort) => effort !== 'none' && effort !== 'minimal')
}

export function getModelTestMaxTokens(provider: AIProvider, model: string, reasoningEffort?: ReasoningEffort): number {
  const config = getModelConfig(model, provider.type, provider.modelConfigs)
  const normalized = model.toLowerCase().split('/').at(-1) ?? model.toLowerCase()
  const needsReasoningRoom =
    Boolean(reasoningEffort && reasoningEffort !== 'none' && reasoningEffort !== 'minimal') ||
    provider.type === 'xiaomi-mimo' ||
    isOpenAIReasoningModel(model) ||
    normalized.includes('reasoner') ||
    normalized.includes('thinking')
  const target = needsReasoningRoom ? 128 : 32
  return Math.max(1, Math.min(config.maxOutputTokens, target))
}

export function supportsReasoningEffort(req: ProviderModelTestRequestLike): boolean {
  return providerSupportsReasoning(req.provider, req.model)
}

export function reduceModelTestBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body }
  delete next.temperature
  delete next.top_p
  delete next.topP
  delete next.reasoning
  delete next.reasoning_effort
  delete next.thinking
  delete next.output_config
  const generationConfig = next.generationConfig as Record<string, unknown> | undefined
  if (generationConfig) {
    const reduced = { ...generationConfig }
    delete reduced.temperature
    delete reduced.topP
    delete reduced.thinkingConfig
    next.generationConfig = reduced
  }
  return next
}

function isOpenAIReasoningModel(modelId: string): boolean {
  return isKnownOpenAIReasoningModel({
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    apiKey: '',
    models: [],
    enabled: true,
  }, modelId)
}
